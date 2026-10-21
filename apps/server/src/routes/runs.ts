import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ctx } from '../ctx.ts';
import { subscribe, type RelayEvent } from '../lib/events.ts';
import { rateLimit } from '../lib/ratelimit.ts';
import { fail, requireOrg, requireUser, type AppEnv } from '../http.ts';
import { getOrg, type Org } from '../services/orgs.ts';
import { textFromBytes } from '../services/records.ts';
import { DEMO_ORG_NAME } from '../seed.ts';
import { classify, getRun, latestForConversation, recentRuns, snapshot, startPipeline } from '../engine/pipeline.ts';

const MAX_TEXT = 8000;

/** Text from the request: JSON {text} or multipart {text?, file?}. */
async function readInput(c: Context): Promise<{ text: string; hasFile: boolean }> {
  if ((c.req.header('content-type') ?? '').includes('multipart')) {
    const form = await c.req.parseBody();
    let text = typeof form.text === 'string' ? form.text : '';
    const file = form.file;
    if (file instanceof File) {
      if (file.size > 8 * 1024 * 1024) fail(400, 'Max file size is 8 MB');
      const extracted = await textFromBytes(new Uint8Array(await file.arrayBuffer()), file.name).catch(() => null);
      if (!extracted?.trim()) fail(400, 'Could not read text from this file. Upload a PDF, Word or text file (photos need OCR).');
      text = `${text}\n${extracted}`.trim();
      return { text: text.slice(0, MAX_TEXT), hasFile: true };
    }
    if (!text.trim()) fail(400, 'Type something or attach a file');
    return { text: text.slice(0, MAX_TEXT), hasFile: false };
  }
  let b: any;
  try {
    b = await c.req.json();
  } catch {
    fail(400, 'Expected a JSON body');
  }
  const text = String(b?.text ?? '').trim();
  if (!text) fail(400, 'Type something or attach a file');
  return { text: text.slice(0, MAX_TEXT), hasFile: false };
}

function stream(c: Context, id: string) {
  return streamSSE(c, async (s) => {
    const queue: RelayEvent[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = subscribe(`run:${id}`, (e) => {
      queue.push(e);
      wake?.();
    });
    let open = true;
    s.onAbort(() => {
      open = false;
      unsubscribe();
      wake?.();
    });
    const first = getRun(id);
    if (first) await s.writeSSE({ event: 'run', data: JSON.stringify(snapshot(first)) });
    if (!first || first.status !== 'running') {
      unsubscribe();
      return;
    }
    while (open) {
      while (queue.length) {
        const e = queue.shift()!;
        await s.writeSSE({ event: e.type, data: JSON.stringify(e.data) });
        if ((e.data as any)?.status && (e.data as any).status !== 'running') {
          open = false;
          break;
        }
      }
      if (!open) break;
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, 20_000);
      });
      wake = null;
      if (!queue.length && open) await s.writeSSE({ event: 'ping', data: '{}' });
    }
    unsubscribe();
  });
}

/** Signed-in workspaces. */
export const runsApi = new Hono<AppEnv>();
runsApi.use(requireUser, requireOrg);

runsApi.get('/', (c) => {
  const conversationId = c.req.query('conversationId');
  if (conversationId) return c.json(latestForConversation(c.get('org').id, conversationId));
  return c.json(recentRuns(c.get('org').id));
});

runsApi.post('/', async (c) => {
  const org = c.get('org');
  if (!rateLimit(`runs:${org.id}`, 120, 10 * 60_000).ok) fail(429, 'Too many runs, try again in a few minutes');
  const { text, hasFile } = await readInput(c);
  const kind = classify(text, hasFile, c.get('role') !== 'viewer');
  return c.json(startPipeline(org, { text, kind, isPublic: c.get('role') === 'viewer' }));
});

runsApi.get('/:id', (c) => {
  const r = getRun(c.req.param('id'));
  if (!r || r.orgId !== c.get('org').id) fail(404, 'Not found');
  return c.json(snapshot(r));
});

runsApi.get('/:id/stream', (c) => {
  const r = getRun(c.req.param('id'));
  if (!r || r.orgId !== c.get('org').id) fail(404, 'Not found');
  return stream(c, r.id);
});

/** Public, no sign-up: runs against the demo hospital. Nothing is saved; rate limited per IP. */
export const publicRuns = new Hono();

async function demoOrg(): Promise<Org> {
  const row = await ctx.db.one<{ id: string }>('select id from orgs where name = $1 order by created_at limit 1', [DEMO_ORG_NAME]);
  const org = row && (await getOrg(row.id));
  if (!org) fail(404, 'The demo is not available on this server');
  return org;
}

publicRuns.post('/', async (c) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`pubruns:${ip}`, 20, 10 * 60_000).ok) fail(429, 'You have tried a lot of examples. Please wait a few minutes, or create a free workspace.');
  const org = await demoOrg();
  const { text, hasFile } = await readInput(c);
  return c.json(startPipeline(org, { text, kind: classify(text, hasFile, false), isPublic: true }));
});

publicRuns.get('/:id', (c) => {
  const r = getRun(c.req.param('id'));
  if (!r || !r.public) fail(404, 'Not found');
  return c.json(snapshot(r));
});

publicRuns.get('/:id/stream', (c) => {
  const r = getRun(c.req.param('id'));
  if (!r || !r.public) fail(404, 'Not found');
  return stream(c, r.id);
});
