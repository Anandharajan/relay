import { ctx } from "../../ctx.ts";
import { hashEmbedder, toVectorLiteral } from "../../adapters/embed.ts";
import { stems } from "../../engine/extractive.ts";
import type { Source } from "./catalog.ts";
import { beforeOrAfter, dayScoped, mentions, sectionsOf, topicTerms } from "./topic.ts";
/** Fixed context sizes, in characters of source text: each task gets a level, not whatever was retrieved. */
const contextLevels: Record<string, number> = { answer: 900, reply: 1500, checklist: 1800, summary: 1800 };
export const replyTokens: Record<string, number> = { answer: 400, reply: 600, checklist: 700, summary: 700 };
/**
 * Quantizes the context to its level: the sentences that mention the question's topic for an answer,
 * whole sections for tasks that need them. Citation numbers are unchanged.
 */
export function scaledExcerpts(question: string, task: string, sources: Source[]) {
  const budget = contextLevels[task] ?? contextLevels.answer!;
  const terms = topicTerms(question);
  const hits = (text: Set<string>) => terms.filter((t) => mentions(t, text)).length;
  const oneDay = dayScoped.test(question) && !beforeOrAfter.test(question);
  const ranked = sectionsOf(sources)
    .filter((section) => !oneDay || !beforeOrAfter.test(section.heading))
    .map((section) => ({
      ...section,
      scored: section.sentences.map((s) => ({ ...s, hits: hits(stems(s.text)) })),
      best: hits(stems(`${section.heading} ${section.sentences.map((s) => s.text).join(" ")}`)),
    }))
    .sort((a, b) => b.best - a.best);
  const top = ranked[0]?.best ?? 0;
  const excerpts: { n: number; text: string }[] = [];
  let used = 0;
  for (const section of ranked) {
    if (section.best < Math.max(1, top * 0.5) && excerpts.length) break;
    const matching = section.scored.filter((s) => s.hits > 0);
    const chosen = task === "answer" && matching.length ? matching : section.scored;
    for (const n of new Set(chosen.map((s) => s.n))) {
      const text = `${section.heading ? `${section.heading}: ` : ""}${chosen.filter((s) => s.n === n).map((s) => s.text).join(" ")}`;
      if (used + text.length > budget && excerpts.length) return excerpts;
      excerpts.push({ n, text: text.slice(0, budget) });
      used += text.length;
    }
  }
  return excerpts;
}
export async function searchChunks(
  orgId: string,
  clientId: string,
  queries: string[],
  documentIds: string[],
) {
  const vectors = await hashEmbedder.embed(queries);
  const best = new Map<string, Source>();
  for (const vector of vectors) {
    const rows = await ctx.db.query(
      `select c.id,c.title,c.document_id,c.content,1-(c.embedding <=> $3::vector) as score
       from voice_chunks c join voice_documents d on d.id=c.document_id
       where c.org_id=$1 and c.client_id=$2 and d.status='ready' and ($4::boolean or c.document_id=any($5::uuid[]))
       order by c.embedding <=> $3::vector limit 7`,
      [
        orgId,
        clientId,
        toVectorLiteral(vector!),
        !documentIds.length,
        `{${documentIds.join(",")}}`,
      ],
    );
    for (const row of rows as Source[])
      if (Number(row.score) > Number(best.get(row.id)?.score ?? -1))
        best.set(row.id, row);
  }
  // Hash embeddings blur a rare word among common ones, so passages naming the topic always qualify.
  const words = [...new Set(queries.flatMap(topicTerms))].filter((t) => /^[\p{L}\p{N}]+$/u.test(t));
  if (words.length) {
    const rows = await ctx.db.query(
      `select c.id,c.title,c.document_id,c.content,1-(c.embedding <=> $3::vector) as score
       from voice_chunks c join voice_documents d on d.id=c.document_id
       where c.org_id=$1 and c.client_id=$2 and d.status='ready' and ($4::boolean or c.document_id=any($5::uuid[]))
         and c.content ilike any($6::text[])
       order by c.embedding <=> $3::vector limit 7`,
      [
        orgId,
        clientId,
        toVectorLiteral(vectors[0]!),
        !documentIds.length,
        `{${documentIds.join(",")}}`,
        `{${words.map((w) => `"%${w}%"`).join(",")}}`,
      ],
    );
    for (const row of rows as Source[]) {
      const score = Number(row.score) + 0.2;
      if (score > Number(best.get(row.id)?.score ?? -1))
        best.set(row.id, { ...row, score });
    }
  }
  return [...best.values()]
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, 7);
}
