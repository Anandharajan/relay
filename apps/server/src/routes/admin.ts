import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { body, fail, requireUser, type AppEnv } from '../http.ts';
import { plans } from '../services/orgs.ts';

/**
 * Platform admin console API. Only emails listed in PLATFORM_ADMIN_EMAILS may call it; everyone else
 * (workspace owners included) gets a 404 so the console's existence is not revealed.
 */
export const admin = new Hono<AppEnv>();
admin.use(requireUser, async (c, next) => {
  if (!config.platformAdmins.includes(c.get('user').email.toLowerCase())) fail(404, 'Not found');
  await next();
});

const days = (c: any) => Math.min(365, Math.max(1, Number(c.req.query('days') ?? 30)));
const since = (n: number) => new Date(Date.now() - n * 86400_000);

admin.get('/overview', async (c) => {
  const n = days(c);
  const from = since(n);
  const [orgs, users, convs, runs, leads, failuresByDay, runsByDay, ratings, csat] = await Promise.all([
    ctx.db.one<{ total: number; active: number; healthcare: number }>(
      `select count(*)::int as total,
              count(*) filter (where exists (select 1 from agent_runs r where r.org_id = o.id and r.created_at > $1))::int as active,
              count(*) filter (where o.settings->>'vertical' = 'healthcare')::int as healthcare
         from orgs o`,
      [from],
    ),
    ctx.db.one<{ c: number }>('select count(*)::int as c from users'),
    ctx.db.one<{ c: number; resolved_ai: number }>(`select count(*)::int as c, count(*) filter (where resolved_by = 'ai')::int as resolved_ai from conversations where created_at > $1`, [from]),
    ctx.db.one<{ total: number; ok: number; handoff: number; failed: number; tokens: number; cost: number; responses: number; latency: number }>(
      `select count(*)::int as total, count(*) filter (where status = 'ok')::int as ok, count(*) filter (where status = 'handoff')::int as handoff,
              count(*) filter (where status = 'failed')::int as failed, coalesce(sum(input_tokens + output_tokens), 0)::int as tokens,
              coalesce(sum(cost_inr), 0)::float as cost, count(*) filter (where agent in ('frontdesk','booking','safety','actions'))::int as responses,
              coalesce(avg(latency_ms), 0)::float as latency
         from agent_runs where created_at > $1`,
      [from],
    ),
    ctx.db.one<{ total: number; fresh: number; early: number }>(`select count(*)::int as total, count(*) filter (where status = 'new')::int as fresh, count(*) filter (where status = 'early_access')::int as early from leads`),
    ctx.db.query(`select date_trunc('day', created_at)::date as day, count(*)::int as failed from agent_runs where status = 'failed' and created_at > $1 group by 1 order by 1`, [from]),
    ctx.db.query(
      `select date_trunc('day', created_at)::date as day, count(*)::int as runs, count(*) filter (where status = 'ok')::int as ok, count(*) filter (where status = 'handoff')::int as handoff,
              count(*) filter (where status = 'failed')::int as failed, coalesce(sum(cost_inr), 0)::float as cost
         from agent_runs where created_at > $1 group by 1 order by 1`,
      [from],
    ),
    ctx.db.one<{ staff: number | null; ai: number | null; n: number }>(`select avg(rating)::float as staff, avg(ai_rating)::float as ai, count(*)::int as n from visit_ratings where created_at > $1`, [from]),
    ctx.db.one<{ avg: number | null; n: number }>(`select avg(csat)::float as avg, count(csat)::int as n from conversations where created_at > $1`, [from]),
  ]);
  return c.json({
    days: n,
    orgs,
    users: users?.c ?? 0,
    conversations: convs,
    runs,
    costPerResponseInr: runs && runs.responses ? runs.cost / runs.responses : 0,
    leads,
    ratings: { staffAvg: ratings?.staff ?? null, aiAvg: ratings?.ai ?? null, visits: ratings?.n ?? 0, csatAvg: csat?.avg ?? null, csatCount: csat?.n ?? 0 },
    runsByDay,
    failuresByDay,
  });
});

/** Tokens, model calls and cost by provider/model and by workspace, with a month-end forecast. */
admin.get('/usage', async (c) => {
  const n = days(c);
  const from = since(n);
  const [byModel, byOrg, daily] = await Promise.all([
    ctx.db.query(
      `select coalesce(provider, 'none') as provider, coalesce(model, '') as model, count(*)::int as calls,
              coalesce(sum(input_tokens), 0)::int as input_tokens, coalesce(sum(output_tokens), 0)::int as output_tokens,
              coalesce(sum(cost_inr), 0)::float as cost, count(*) filter (where status = 'failed')::int as failed, coalesce(avg(latency_ms), 0)::float as latency
         from agent_runs where created_at > $1 group by 1, 2 order by cost desc, calls desc`,
      [from],
    ),
    ctx.db.query(
      `select o.id, o.name, o.plan, o.settings->>'vertical' as vertical,
              (select coalesce(sum(cost_inr), 0) from usage_daily u where u.org_id = o.id and u.day >= date_trunc('month', current_date))::float as mtd_cost,
              (select coalesce(sum(tokens), 0) from usage_daily u where u.org_id = o.id and u.day >= date_trunc('month', current_date))::int as mtd_tokens,
              (select coalesce(sum(ai_messages), 0) from usage_daily u where u.org_id = o.id and u.day >= date_trunc('month', current_date))::int as mtd_responses,
              (select coalesce(sum(conversations), 0) from usage_daily u where u.org_id = o.id and u.day >= date_trunc('month', current_date))::int as mtd_conversations,
              (select count(*) from agent_runs r where r.org_id = o.id and r.created_at > $1)::int as runs,
              (select provider from model_settings m where m.org_id = o.id) as model_provider
         from orgs o order by mtd_cost desc, runs desc limit 500`,
      [from],
    ),
    ctx.db.query(
      `select day, coalesce(sum(tokens), 0)::int as tokens, coalesce(sum(cost_inr), 0)::float as cost, coalesce(sum(ai_messages), 0)::int as responses
         from usage_daily where day > current_date - $1::int group by day order by day`,
      [n],
    ),
  ]);
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const forecast = byOrg.map((o: any) => {
    const projectedCost = (o.mtd_cost / dayOfMonth) * daysInMonth;
    const projectedResponses = Math.round((o.mtd_responses / dayOfMonth) * daysInMonth);
    const revenue = (plans as any)[o.plan]?.priceInr ?? 0;
    return { ...o, projectedCost, projectedResponses, costPerResponse: o.mtd_responses ? o.mtd_cost / o.mtd_responses : 0, planRevenue: revenue, margin: revenue - projectedCost };
  });
  return c.json({ days: n, byModel, workspaces: forecast, daily, monthProgress: dayOfMonth / daysInMonth });
});

/** How each agent performs, overall and by complexity, plus satisfaction signals. */
admin.get('/agents', async (c) => {
  const n = days(c);
  const from = since(n);
  const [byAgent, byComplexity, findingsFeedback, staffRatings, csatByComplexity] = await Promise.all([
    ctx.db.query(
      `select agent, count(*)::int as runs, count(*) filter (where status = 'ok')::int as ok, count(*) filter (where status = 'handoff')::int as handoff,
              count(*) filter (where status = 'failed')::int as failed, coalesce(avg(latency_ms), 0)::float as latency, coalesce(sum(cost_inr), 0)::float as cost
         from agent_runs where created_at > $1 group by agent order by runs desc`,
      [from],
    ),
    ctx.db.query(
      `select complexity, count(*)::int as runs, count(*) filter (where status = 'ok')::int as ok, count(*) filter (where status = 'handoff')::int as handoff, count(*) filter (where status = 'failed')::int as failed
         from agent_runs where created_at > $1 group by complexity order by complexity`,
      [from],
    ),
    // Doctors' verdict on the findings agent: shared/acknowledged = useful, dismissed = not useful.
    ctx.db.one<{ useful: number; dismissed: number; pending: number; urgent: number }>(
      `select count(*) filter (where status in ('acknowledged', 'shared'))::int as useful, count(*) filter (where status = 'dismissed')::int as dismissed,
              count(*) filter (where status = 'open')::int as pending, count(*) filter (where severity = 'urgent')::int as urgent
         from findings where created_at > $1`,
      [from],
    ),
    ctx.db.query(
      `select s.name, s.specialty, o.name as org_name, count(r.*)::int as ratings, avg(r.rating)::float as avg, avg(r.ai_rating)::float as ai_avg
         from staff_members s join orgs o on o.id = s.org_id left join visit_ratings r on r.staff_id = s.id and r.created_at > $1
        group by s.id, s.name, s.specialty, o.name having count(r.*) > 0 order by avg desc nulls last limit 50`,
      [from],
    ),
    ctx.db.query(
      `select x.complexity, count(*)::int as rated, avg(c.csat)::float as csat
         from conversations c join lateral (select max(complexity) as complexity from agent_runs r where r.conversation_id = c.id) x on true
        where c.csat is not null and c.created_at > $1 and x.complexity is not null group by x.complexity order by x.complexity`,
      [from],
    ),
  ]);
  const recentComplex = await ctx.db.query(
    `select r.id, r.agent, r.status, r.outcome, r.tags, r.steps, r.created_at, o.name as org_name from agent_runs r left join orgs o on o.id = r.org_id
      where r.complexity = 3 and r.created_at > $1 order by r.created_at desc limit 25`,
    [from],
  );
  return c.json({ byAgent, byComplexity, findingsFeedback, staffRatings, csatByComplexity, recentComplex });
});

admin.get('/failures', async (c) => {
  const n = days(c);
  const from = since(n);
  const tag = c.req.query('tag') ?? '';
  const [byTag, runs, jobs] = await Promise.all([
    ctx.db.query(
      `select t.tag, count(*)::int as n, max(r.created_at) as last_at from agent_runs r, jsonb_array_elements_text(r.tags) as t(tag)
        where r.created_at > $1 and (r.status = 'failed' or t.tag like 'handoff.%' or t.tag like 'intake.%') group by t.tag order by n desc`,
      [from],
    ),
    ctx.db.query(
      `select r.id, r.agent, r.trigger, r.status, r.outcome, r.tags, r.steps, r.provider, r.model, r.latency_ms, r.created_at, o.name as org_name
         from agent_runs r left join orgs o on o.id = r.org_id
        where r.created_at > $1 and r.status = 'failed' and ($2 = '' or r.tags ? $2) order by r.created_at desc limit 200`,
      [from, tag],
    ),
    ctx.db.query(`select id, type, status, attempts, last_error, updated_at from jobs where status = 'failed' and updated_at > $1 order by updated_at desc limit 100`, [from]),
  ]);
  return c.json({ byTag, runs, jobs });
});

/** Which AI providers and models each workspace uses, BYOK or platform, budgets and last use. */
admin.get('/providers', async (c) => {
  const rows = await ctx.db.query(
    `select o.id, o.name, o.plan, m.provider, m.model, m.base_url, m.key_hint, (m.key_enc is not null) as byok, m.monthly_budget_inr, m.updated_at,
            (select max(created_at) from agent_runs r where r.org_id = o.id and r.provider is not null) as last_used,
            (select coalesce(sum(cost_inr), 0) from agent_runs r where r.org_id = o.id and r.created_at > now() - interval '30 days')::float as cost_30d,
            (select count(*) from agent_runs r where r.org_id = o.id and r.status = 'failed' and r.tags::text like '%llm.%' and r.created_at > now() - interval '30 days')::int as llm_failures_30d
       from orgs o left join model_settings m on m.org_id = o.id order by cost_30d desc, o.created_at desc limit 500`,
  );
  return c.json({ platformDefault: { provider: config.defaultLlm.provider, model: config.defaultLlm.model || null }, workspaces: rows });
});

admin.get('/workspaces', async (c) => {
  const rows = await ctx.db.query(
    `select o.id, o.name, o.plan, o.created_at, o.settings->>'vertical' as vertical,
            (select count(*) from members m where m.org_id = o.id)::int as members,
            (select string_agg(u.email, ', ') from members m join users u on u.id = m.user_id where m.org_id = o.id and m.role = 'owner') as owners,
            (select count(*) from conversations c where c.org_id = o.id and c.created_at > now() - interval '30 days')::int as conversations_30d,
            (select count(*) from appointments a where a.org_id = o.id and a.created_at > now() - interval '30 days')::int as appointments_30d,
            (select count(*) from staff_members s where s.org_id = o.id and s.active)::int as staff,
            (select string_agg(addon || ':' || status, ', ') from addons ad where ad.org_id = o.id) as addons,
            (select max(created_at) from agent_runs r where r.org_id = o.id) as last_active
       from orgs o order by last_active desc nulls last, o.created_at desc limit 500`,
  );
  return c.json(rows);
});

admin.get('/audit', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const rows = await ctx.db.query(
    `select a.id, a.actor, a.action, a.target, a.payload, a.at, o.name as org_name from audit_log a join orgs o on o.id = a.org_id
      where ($1 = '' or a.action ilike '%' || $1 || '%' or o.name ilike '%' || $1 || '%' or a.actor ilike '%' || $1 || '%') order by a.at desc limit 300`,
    [q],
  );
  return c.json(rows);
});

admin.get('/leads', async (c) => {
  const status = c.req.query('status') ?? '';
  return c.json(await ctx.db.query(`select * from leads where ($1 = '' or status = $1) order by created_at desc limit 500`, [status]));
});

admin.patch('/leads/:id', async (c) => {
  const b = await body(c, z.object({ status: z.enum(['new', 'contacted', 'early_access', 'converted', 'rejected']).optional(), notes: z.string().max(4000).optional() }));
  await ctx.db.query(`update leads set status = coalesce($2, status), notes = coalesce($3, notes), updated_at = now() where id = $1`, [c.req.param('id'), b.status ?? null, b.notes ?? null]);
  return c.json({ ok: true });
});

admin.get('/runs/:id', async (c) => {
  const r = await ctx.db.one(`select r.*, o.name as org_name from agent_runs r left join orgs o on o.id = r.org_id where r.id = $1`, [c.req.param('id')]);
  if (!r) fail(404, 'Not found');
  return c.json(r);
});
