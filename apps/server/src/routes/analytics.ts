import { Hono } from 'hono';
import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { requireOrg, requireUser, type AppEnv } from '../http.ts';

export const analytics = new Hono<AppEnv>();
analytics.use(requireUser, requireOrg);

analytics.get('/', async (c) => {
  const org = c.get('org');
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 30), 1), 365);
  const since = `now() - interval '${days} days'`;

  const totals = await ctx.db.one(
    `select count(*)::int as conversations,
            count(*) filter (where status = 'resolved')::int as resolved,
            count(*) filter (where resolved_by = 'ai')::int as ai_resolved,
            count(*) filter (where resolved_by = 'human')::int as human_resolved,
            count(*) filter (where status = 'escalated')::int as escalated_open,
            count(*) filter (where not exists (select 1 from messages m where m.conversation_id = c.id and m.role = 'human'))::int as deflected,
            avg(csat)::float as csat_avg,
            count(csat)::int as csat_count,
            count(*) filter (where csat >= 4)::int as csat_positive
       from conversations c where org_id = $1 and created_at > ${since}`,
    [org.id],
  );
  const cost = await ctx.db.one(
    `select coalesce(sum(cost_inr), 0)::float as cost_inr, coalesce(sum(tokens), 0)::int as tokens, coalesce(sum(ai_messages), 0)::int as ai_messages
       from usage_daily where org_id = $1 and day > current_date - $2::int`,
    [org.id, days],
  );
  const daily = await ctx.db.query(
    `select to_char(d::date, 'YYYY-MM-DD') as day,
            (select count(*)::int from conversations c where c.org_id = $1 and c.created_at::date = d::date) as conversations,
            (select count(*)::int from conversations c where c.org_id = $1 and c.resolved_by = 'ai' and c.resolved_at::date = d::date) as ai_resolved,
            (select count(*)::int from conversations c where c.org_id = $1 and c.resolved_by = 'human' and c.resolved_at::date = d::date) as human_resolved
       from generate_series(current_date - ($2::int - 1), current_date, interval '1 day') d order by d`,
    [org.id, Math.min(days, 90)],
  );
  const languages = await ctx.db.query(
    `select lang, count(*)::int as n from conversations where org_id = $1 and created_at > ${since} group by lang order by n desc`,
    [org.id],
  );
  const channels = await ctx.db.query(
    `select channel, count(*)::int as n from conversations where org_id = $1 and created_at > ${since} group by channel order by n desc`,
    [org.id],
  );
  const handoffReasons = await ctx.db.query(
    `select split_part(coalesce(meta->>'reason', 'other'), ' ', 1) as reason, count(*)::int as n
       from messages where org_id = $1 and role = 'ai' and meta->>'kind' = 'handoff' and created_at > ${since}
      group by 1 order by n desc limit 8`,
    [org.id],
  );
  const unanswered = await ctx.db.query(
    `select q.content as question, count(*)::int as n
       from messages a
       join lateral (select content from messages q where q.conversation_id = a.conversation_id and q.role = 'customer' and q.created_at <= a.created_at order by q.created_at desc limit 1) q on true
      where a.org_id = $1 and a.role = 'ai' and a.meta->>'kind' = 'handoff' and a.meta->>'reason' not like 'customer_requested%' and a.created_at > ${since}
      group by q.content order by n desc limit 10`,
    [org.id],
  );
  const t = totals!;
  const resolutionRate = t.conversations ? t.ai_resolved / t.conversations : 0;
  return c.json({
    days,
    totals: t,
    resolutionRate,
    deflectionRate: t.conversations ? t.deflected / t.conversations : 0,
    csat: t.csat_count ? t.csat_positive / t.csat_count : null,
    costInr: cost!.cost_inr,
    tokens: cost!.tokens,
    aiMessages: cost!.ai_messages,
    costPerResolutionInr: t.ai_resolved ? cost!.cost_inr / t.ai_resolved : 0,
    // What the same AI resolutions would cost on Fin at $0.99 each.
    finEquivalentInr: t.ai_resolved * 0.99 * config.usdToInr,
    daily,
    languages,
    channels,
    handoffReasons,
    unanswered,
  });
});
