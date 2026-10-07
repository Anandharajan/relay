import { Hono } from 'hono';
import { z } from 'zod';
import { ctx } from '../ctx.ts';
import { uuid } from '../lib/crypto.ts';
import { assertFetchable } from '../lib/net.ts';
import { body, fail, requireOrg, requireRole, requireUser, type AppEnv } from '../http.ts';
import { getBlobStore } from '../adapters/blob.ts';
import { enqueue } from '../jobs/runner.ts';
import { answer } from '../engine/answer.ts';
import { audit } from '../services/orgs.ts';

export const knowledge = new Hono<AppEnv>();
knowledge.use(requireUser, requireOrg);

knowledge.get('/', async (c) => {
  const rows = await ctx.db.query(
    `select id, type, title, uri, status, error, chunk_count, last_synced_at, created_at, options from knowledge_sources where org_id = $1 order by created_at desc`,
    [c.get('org').id],
  );
  return c.json(rows);
});

async function addSource(c: any, fields: { type: string; title: string; uri?: string; blobKey?: string; content?: string; options?: object }) {
  const org = c.get('org');
  const id = uuid();
  await ctx.db.query(
    `insert into knowledge_sources (id, org_id, type, title, uri, blob_key, content, options) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [id, org.id, fields.type, fields.title, fields.uri ?? null, fields.blobKey ?? null, fields.content ?? null, fields.options ?? {}],
  );
  await enqueue('ingest', { sourceId: id });
  await audit(org.id, c.get('user').id, 'knowledge.added', id, { type: fields.type, title: fields.title });
  return id;
}

knowledge.post('/url', requireRole('admin'), async (c) => {
  const b = await body(c, z.object({ url: z.string().url(), crawl: z.boolean().default(true), maxPages: z.number().int().min(1).max(200).default(25) }));
  try {
    await assertFetchable(b.url);
  } catch (e) {
    fail(400, (e as Error).message);
  }
  const id = await addSource(c, { type: 'url', title: b.url, uri: b.url, options: { crawl: b.crawl, maxPages: b.maxPages } });
  return c.json({ id });
});

knowledge.post('/faq', requireRole('admin'), async (c) => {
  const b = await body(c, z.object({ title: z.string().min(1).max(200), content: z.string().min(10).max(200_000) }));
  const id = await addSource(c, { type: 'faq', title: b.title, content: b.content });
  return c.json({ id });
});

const allowedExt = /\.(pdf|docx|txt|md|markdown|csv|html?)$/i;

knowledge.post('/file', requireRole('admin'), async (c) => {
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) fail(400, 'Attach a file in the "file" field');
  if (!allowedExt.test(file.name)) fail(400, 'Supported: PDF, DOCX, TXT, MD, CSV, HTML');
  if (file.size > 20 * 1024 * 1024) fail(400, 'Max file size is 20 MB');
  const org = c.get('org');
  const key = `org/${org.id}/uploads/${uuid()}-${file.name.replace(/[^\w.\-]/g, '_')}`;
  await getBlobStore().put(key, new Uint8Array(await file.arrayBuffer()), file.type || 'application/octet-stream');
  const id = await addSource(c, { type: 'file', title: file.name, blobKey: key });
  return c.json({ id });
});

knowledge.post('/:id/resync', requireRole('admin'), async (c) => {
  const src = await ctx.db.one('select id from knowledge_sources where id = $1 and org_id = $2', [c.req.param('id'), c.get('org').id]);
  if (!src) fail(404, 'Source not found');
  await enqueue('ingest', { sourceId: src.id });
  return c.json({ ok: true });
});

knowledge.delete('/:id', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const src = await ctx.db.one<{ id: string; blob_key: string | null }>('select id, blob_key from knowledge_sources where id = $1 and org_id = $2', [c.req.param('id'), org.id]);
  if (!src) fail(404, 'Source not found');
  await ctx.db.query('delete from knowledge_sources where id = $1', [src.id]);
  if (src.blob_key) await getBlobStore().delete(src.blob_key);
  await ctx.db.query('delete from answer_cache where org_id = $1', [org.id]);
  await audit(org.id, c.get('user').id, 'knowledge.deleted', src.id);
  return c.json({ ok: true });
});

knowledge.get('/:id/chunks', async (c) => {
  const rows = await ctx.db.query(
    'select id, position, title, url, content, lang from chunks where source_id = $1 and org_id = $2 order by position limit 500',
    [c.req.param('id'), c.get('org').id],
  );
  return c.json(rows);
});

knowledge.delete('/:id/chunks/:chunkId', requireRole('admin'), async (c) => {
  await ctx.db.query('delete from chunks where id = $1 and source_id = $2 and org_id = $3', [c.req.param('chunkId'), c.req.param('id'), c.get('org').id]);
  await ctx.db.query('update knowledge_sources set chunk_count = (select count(*) from chunks where source_id = $1) where id = $1', [c.req.param('id')]);
  return c.json({ ok: true });
});

/** Playground: ask the AI anything and see the full decision (no conversation is created). */
knowledge.post('/ask', async (c) => {
  const b = await body(c, z.object({ question: z.string().min(1).max(2000) }));
  const out = await answer({ org: c.get('org'), question: b.question, dryRun: true });
  return c.json(out);
});
