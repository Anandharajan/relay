import { parse, type HTMLElement } from 'node-html-parser';
import { ctx } from '../ctx.ts';
import { uuid } from '../lib/crypto.ts';
import { publish } from '../lib/events.ts';
import { safeFetch } from '../lib/net.ts';
import { chunkDocument, detectLanguage } from '../lib/text.ts';
import { getBlobStore } from '../adapters/blob.ts';
import { getEmbedder, toVectorLiteral } from '../adapters/embed.ts';

interface Doc {
  title: string;
  url?: string;
  text: string;
}

const DROP = 'script, style, noscript, svg, iframe, form, nav, footer, header, aside, [aria-hidden="true"], .cookie, #cookie-banner';

export function htmlToDoc(html: string, url?: string): Doc & { links: string[] } {
  const root = parse(html);
  const title = (root.querySelector('title')?.text || root.querySelector('h1')?.text || url || 'Page').trim();
  const links = root.querySelectorAll('a[href]').map((a) => a.getAttribute('href')!).filter(Boolean);
  root.querySelectorAll(DROP).forEach((n) => n.remove());
  const main = root.querySelector('main') ?? root.querySelector('article') ?? root.querySelector('body') ?? root;
  const lines: string[] = [];
  const walk = (el: HTMLElement) => {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) continue;
      const child = node as HTMLElement;
      const tag = child.tagName?.toLowerCase();
      if (!tag) continue;
      if (/^h[1-4]$/.test(tag)) lines.push(`\n${'#'.repeat(Number(tag[1]))} ${child.text.trim()}\n`);
      else if (['p', 'li', 'dt', 'dd', 'blockquote', 'td', 'th', 'summary', 'pre'].includes(tag)) {
        const text = child.text.replace(/\s+/g, ' ').trim();
        if (text) lines.push(tag === 'li' ? `- ${text}` : text, tag === 'p' || tag === 'dd' ? '' : '');
      } else walk(child);
    }
  };
  walk(main);
  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 80) text = main.text.replace(/\s+/g, ' ').trim();
  return { title, url, text, links };
}

async function crawl(start: string, maxPages: number): Promise<Doc[]> {
  const origin = new URL(start).origin;
  const queue = [start];
  const seen = new Set<string>();
  const docs: Doc[] = [];
  while (queue.length && docs.length < maxPages) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await safeFetch(url, { headers: { 'user-agent': 'RelayBot/0.1 (+https://github.com/Anandharajan/relay)' } });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('html')) continue;
      const doc = htmlToDoc(await res.text(), url);
      if (doc.text.length > 40) docs.push({ title: doc.title, url, text: doc.text });
      for (const href of doc.links) {
        try {
          const next = new URL(href, url);
          next.hash = '';
          if (next.origin === origin && !seen.has(next.href) && !/\.(png|jpe?g|gif|svg|webp|zip|mp4|css|js|ico|pdf)$/i.test(next.pathname)) queue.push(next.href);
        } catch {
          /* bad href */
        }
      }
    } catch (e) {
      if (docs.length === 0 && url === start) throw e;
    }
  }
  return docs;
}

export async function parseFile(name: string, data: Uint8Array): Promise<string> {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(data);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join('\n\n') : text;
  }
  if (ext === 'docx') {
    const mammoth = (await import('mammoth')).default;
    return (await mammoth.extractRawText({ buffer: Buffer.from(data) })).value;
  }
  const text = new TextDecoder().decode(data);
  if (ext === 'html' || ext === 'htm') return htmlToDoc(text).text;
  return text;
}

export async function ingestSource({ sourceId }: { sourceId: string }) {
  const src = await ctx.db.one<{ id: string; org_id: string; type: string; title: string; uri: string | null; blob_key: string | null; content: string | null; options: any }>(
    'select * from knowledge_sources where id = $1',
    [sourceId],
  );
  if (!src || src.type === 'learned') return;
  const setStatus = async (status: string, extra: { error?: string | null; chunks?: number } = {}) => {
    await ctx.db.query(
      `update knowledge_sources set status = $2, error = $3, chunk_count = coalesce($4, chunk_count), last_synced_at = case when $2 = 'ready' then now() else last_synced_at end where id = $1`,
      [sourceId, status, extra.error ?? null, extra.chunks ?? null],
    );
    publish(`org:${src.org_id}`, 'knowledge.updated', { id: sourceId, status, error: extra.error, chunk_count: extra.chunks });
  };
  await setStatus('processing');
  try {
    let docs: Doc[] = [];
    if (src.type === 'url') {
      docs = src.options?.crawl ? await crawl(src.uri!, Math.min(Number(src.options.maxPages) || 20, 200)) : await crawl(src.uri!, 1);
    } else if (src.type === 'file') {
      const data = await getBlobStore().get(src.blob_key!);
      if (!data) throw new Error('Uploaded file is missing from storage');
      docs = [{ title: src.title, text: await parseFile(src.title, data) }];
    } else if (src.type === 'faq') {
      docs = [{ title: src.title, text: src.content ?? '' }];
    }
    const chunks = docs.flatMap((d) => chunkDocument(d.text, { title: d.title, url: d.url }));
    if (!chunks.length) throw new Error('No readable text found in this source');

    const embedder = getEmbedder();
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += 32) {
      vectors.push(...(await embedder.embed(chunks.slice(i, i + 32).map((c) => `${c.title}\n${c.content}`))));
    }
    await ctx.db.tx(async (t) => {
      await t.query('delete from chunks where source_id = $1', [sourceId]);
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]!;
        await t.query(
          `insert into chunks (id, org_id, source_id, position, title, url, content, lang, embedding, embed_model) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)`,
          [uuid(), src.org_id, sourceId, i, c.title, c.url ?? null, c.content, detectLanguage(c.content), toVectorLiteral(vectors[i]!), embedder.id],
        );
      }
      if (src.type === 'url' && docs[0]?.title && (!src.title || src.title === src.uri)) {
        await t.query('update knowledge_sources set title = $2 where id = $1', [sourceId, docs[0].title]);
      }
    });
    await ctx.db.query('delete from answer_cache where org_id = $1', [src.org_id]);
    await setStatus('ready', { chunks: chunks.length });
  } catch (e) {
    await setStatus('error', { error: (e as Error).message });
  }
}
