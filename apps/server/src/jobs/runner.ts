import { ctx } from '../ctx.ts';
import { uuid } from '../lib/crypto.ts';

/**
 * Durable job queue on Postgres (the self-hosted stand-in for Cloudflare Workflows / Temporal).
 * Jobs survive restarts, retry with backoff, and are claimed with SKIP LOCKED so several
 * server processes can share one database.
 */
type Handler = (payload: any) => Promise<void>;
const handlers = new Map<string, Handler>();
let timer: NodeJS.Timeout | null = null;
let running = 0;
/** Only processes that called startJobs() claim work; web-only instances just enqueue. */
let active = false;
const MAX_CONCURRENCY = Number(process.env.JOB_CONCURRENCY ?? 2);

export function registerJob(type: string, fn: Handler) {
  handlers.set(type, fn);
}

export async function enqueue(type: string, payload: object = {}, delayMs = 0): Promise<string> {
  const id = uuid();
  await ctx.db.query(`insert into jobs (id, type, payload, run_at) values ($1, $2, $3::jsonb, now() + ($4 || ' milliseconds')::interval)`, [id, type, payload, String(delayMs)]);
  setImmediate(tick);
  return id;
}

/** Enqueue unless an identical job type is already waiting (used by cron). */
export async function enqueueOnce(type: string, payload: object = {}) {
  const exists = await ctx.db.one(`select 1 from jobs where type = $1 and status in ('queued', 'running') limit 1`, [type]);
  if (!exists) await enqueue(type, payload);
}

async function claim() {
  return ctx.db.tx((t) =>
    t.one<{ id: string; type: string; payload: any; attempts: number }>(
      `update jobs set status = 'running', attempts = attempts + 1, updated_at = now()
        where id = (select id from jobs where status = 'queued' and run_at <= now() order by run_at limit 1 for update skip locked)
        returning id, type, payload, attempts`,
    ),
  );
}

async function tick() {
  while (active && running < MAX_CONCURRENCY) {
    const job = await claim().catch((e) => {
      console.error('[jobs] claim failed', e.message);
      return undefined;
    });
    if (!job) return;
    running++;
    void execute(job).finally(() => {
      running--;
      setImmediate(tick);
    });
  }
}

async function execute(job: { id: string; type: string; payload: any; attempts: number }) {
  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    await handler(job.payload);
    await ctx.db.query(`update jobs set status = 'done', updated_at = now(), last_error = null where id = $1`, [job.id]);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[jobs] ${job.type} failed (attempt ${job.attempts}):`, msg);
    const retry = job.attempts < 3;
    await ctx.db.query(
      `update jobs set status = $2, last_error = $3, updated_at = now(), run_at = now() + ($4 || ' seconds')::interval where id = $1`,
      [job.id, retry ? 'queued' : 'failed', msg, String(job.attempts * 20)],
    );
  }
}

export async function startJobs(cron: { everyMs: number; run: () => Promise<void> }[]) {
  await ctx.db.query(`update jobs set status = 'queued' where status = 'running' and updated_at < now() - interval '10 minutes'`);
  await ctx.db.query(`delete from jobs where status = 'done' and updated_at < now() - interval '7 days'`);
  active = true;
  timer = setInterval(tick, 1000);
  for (const c of cron) setInterval(() => c.run().catch((e) => console.error('[cron]', e.message)), c.everyMs);
  setImmediate(tick);
}

export function stopJobs() {
  active = false;
  if (timer) clearInterval(timer);
}

/** Wait (up to timeoutMs) for in-flight jobs to finish, for graceful shutdown on deploys. */
export async function drainJobs(timeoutMs = 20_000) {
  stopJobs();
  const end = Date.now() + timeoutMs;
  while (running > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
}
