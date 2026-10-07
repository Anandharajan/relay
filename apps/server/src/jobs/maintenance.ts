import { ctx } from '../ctx.ts';
import { enqueue } from './runner.ts';
import { getOrg } from '../services/orgs.ts';
import { resolve, type Conversation } from '../services/conversations.ts';

/** Conversations the AI answered, with no reply or escalation for `idleResolveMinutes`, count as AI resolutions. */
export async function autoResolveIdle() {
  const rows = await ctx.db.query<Conversation & { idle: number }>(
    `select c.*, coalesce((o.settings->>'idleResolveMinutes')::int, 30) as idle
       from conversations c join orgs o on o.id = c.org_id
      where c.status = 'ai'
        and c.last_message_at < now() - (coalesce((o.settings->>'idleResolveMinutes')::int, 30) || ' minutes')::interval
        and exists (select 1 from messages m where m.conversation_id = c.id and m.role = 'ai')
        and (select role from messages m where m.conversation_id = c.id and m.role in ('customer', 'ai', 'human') order by created_at desc limit 1) = 'ai'
      limit 200`,
  );
  for (const conv of rows) await resolve(conv, 'ai');
  if (rows.length) console.log(`[cron] auto-resolved ${rows.length} idle conversations`);
}

/** DPDP: delete conversations past the workspace's retention window. */
export async function retentionPurge() {
  const orgs = await ctx.db.query<{ id: string }>('select id from orgs');
  for (const { id } of orgs) {
    const org = await getOrg(id);
    if (!org) continue;
    const days = Math.max(1, org.settings.retentionDays);
    const res = await ctx.db.query(`delete from conversations where org_id = $1 and last_message_at < now() - ($2 || ' days')::interval returning id`, [id, String(days)]);
    if (res.length) console.log(`[cron] retention purged ${res.length} conversations for org ${id}`);
  }
  await ctx.db.query(`delete from answer_cache where created_at < now() - interval '2 days'`);
}

/** Re-crawl website sources weekly so answers track the live help center. */
export async function resyncStaleSources() {
  const stale = await ctx.db.query<{ id: string }>(
    `select id from knowledge_sources where type = 'url' and status in ('ready', 'error') and coalesce(last_synced_at, created_at) < now() - interval '7 days' limit 20`,
  );
  for (const s of stale) await enqueue('ingest', { sourceId: s.id });
}
