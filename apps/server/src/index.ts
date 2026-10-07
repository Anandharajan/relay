import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { config } from './config.ts';
import { ctx } from './ctx.ts';
import { openDb } from './db.ts';
import { buildApp } from './app.ts';
import { initBus } from './lib/events.ts';
import { drainJobs, registerJob, startJobs, enqueueOnce } from './jobs/runner.ts';
import { ingestSource } from './jobs/ingest.ts';
import { runSimulation } from './jobs/simulate.ts';
import { autoResolveIdle, resyncStaleSources, retentionPurge } from './jobs/maintenance.ts';
import { seedDemo } from './seed.ts';

if (config.usingDevSecret) {
  const msg = 'RELAY_SECRET is not set: using an insecure development secret.';
  if (config.mode === 'cloud') throw new Error(msg);
  console.warn(`⚠️  ${msg} Set it before deploying.`);
}

ctx.db = await openDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir });
console.log(`[db] connected (${ctx.db.kind}${ctx.db.kind === 'pglite' ? ` at ${config.dataDir}` : ''})`);
if (ctx.db.kind === 'pglite' && config.role !== 'all') {
  throw new Error(`RELAY_ROLE=${config.role} needs a shared Postgres (DATABASE_URL); embedded PGlite is single-process.`);
}
await initBus(ctx.db);

registerJob('ingest', ingestSource);
registerJob('simulate', runSimulation);
registerJob('auto_resolve', autoResolveIdle);
registerJob('retention', retentionPurge);
registerJob('resync', resyncStaleSources);

if (config.role !== 'web') {
  await startJobs([
    { everyMs: 60_000, run: () => enqueueOnce('auto_resolve') },
    { everyMs: 6 * 3600_000, run: () => enqueueOnce('retention') },
    { everyMs: 3600_000, run: () => enqueueOnce('resync') },
  ]);
}

// Workers expose only a health check; web/all serve the full app.
const app =
  config.role === 'worker'
    ? new Hono().get('/healthz', async (c) => {
        await ctx.db.one('select 1 as ok');
        return c.json({ ok: true, role: 'worker' });
      })
    : buildApp();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`\n  Relay ${config.role} is running → ${config.publicUrl}  (port ${info.port}, ${config.mode} mode)\n`);
  // Seed after listening: the demo workspace's Actions call this server's mock store API.
  if (config.role !== 'worker') seedDemo().catch((e) => console.error('[seed] failed', e));
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[shutdown] draining…');
  server.close(); // stop accepting connections; open SSE streams end and clients reconnect elsewhere
  await drainJobs();
  await ctx.db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
