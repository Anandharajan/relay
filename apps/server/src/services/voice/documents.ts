import { ctx } from "../../ctx.ts";
import { uuid, decrypt } from "../../lib/crypto.ts";
import { parseFile } from "../../jobs/ingest.ts";
import { hashEmbedder, toVectorLiteral } from "../../adapters/embed.ts";
import { PermanentError } from "../../lib/permanent-error.ts";
import { chunkDocument, splitSentences } from "../../lib/text.ts";
import { voiceChanged } from "./catalog.ts";
import { isHeading } from "./topic.ts";
/**
 * Sentence-aware chunks split at headings. Each chunk names its section and repeats the previous
 * chunk's last sentence from that section, so facts keep their context.
 */
export function chunkVoiceDocument(text: string) {
  const marked = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (isHeading(line) ? `## ${line.replace(/^#+\s*/, "").trim()}` : line))
    .join("\n");
  const chunks = chunkDocument(marked, { maxChars: 1200 }).flatMap((c) =>
    (c.content.match(/[\s\S]{1,1500}/g) ?? []).map((content) => ({
      title: c.title,
      content,
    })),
  );
  return chunks.map(({ title, content }, i) => {
    const previous = chunks[i - 1];
    const carried =
      previous?.title === title ? splitSentences(previous.content).at(-1)! : "";
    const body =
      carried && carried.length < 300 && !content.startsWith(carried)
        ? `${carried}\n${content}`
        : content;
    return title ? `## ${title}\n${body}` : body;
  });
}
export async function processVoiceDocument({
  documentId,
  orgId,
}: {
  documentId: string;
  orgId: string;
}) {
  const row = await ctx.db.one(
    "select * from voice_documents where id=$1 and org_id=$2",
    [documentId, orgId],
  );
  if (!row) return;
  try {
    await ctx.db.query(
      "update voice_documents set status='processing',error=null where id=$1",
      [row.id],
    );
    voiceChanged(orgId);
    const text = (
      await parseFile(
        row.name,
        new Uint8Array(Buffer.from(decrypt(row.raw_enc), "base64")),
      )
    ).trim();
    if (text.length < 10)
      throw new PermanentError(
        "No readable text found. Scanned PDFs need OCR before upload.",
      );
    if (text.length > 500000)
      throw new PermanentError(
        "Extracted text exceeds 500,000 characters. Split the document.",
      );
    const chunks = chunkVoiceDocument(text);
    const vectors = await hashEmbedder.embed(chunks);
    await ctx.db.tx(async (db) => {
      const exists = await db.one(
        "select id from voice_documents where id=$1 and org_id=$2 for update",
        [row.id, orgId],
      );
      if (!exists) return;
      await db.query("delete from voice_chunks where document_id=$1", [row.id]);
      for (let i = 0; i < chunks.length; i++)
        await db.query(
          "insert into voice_chunks(id,org_id,client_id,document_id,title,content,embedding) values($1,$2,$3,$4,$5,$6,$7::vector)",
          [
            uuid(),
            orgId,
            row.client_id,
            row.id,
            row.name,
            chunks[i],
            toVectorLiteral(vectors[i]!),
          ],
        );
      await db.query(
        "update voice_documents set status='ready',error=null where id=$1",
        [row.id],
      );
    });
  } catch (e) {
    await ctx.db.query(
      "update voice_documents set status='failed',error=$2 where id=$1",
      [row.id, (e as Error).message.slice(0, 300)],
    );
    throw e;
  } finally {
    voiceChanged(orgId);
  }
}
