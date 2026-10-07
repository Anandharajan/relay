import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { hmacHex, safeEqual } from '../lib/crypto.ts';
import { body, fail, requireOrg, requireRole, requireUser, type AppEnv } from '../http.ts';
import { audit, plans } from '../services/orgs.ts';

export const billing = new Hono<AppEnv>();
billing.use(requireUser, requireOrg);

function razorpayAuth() {
  return `Basic ${Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64')}`;
}

billing.get('/', async (c) => {
  const org = c.get('org');
  const sub = await ctx.db.one('select * from subscriptions where org_id = $1', [org.id]);
  const usage = await ctx.db.one(
    `select coalesce(sum(conversations), 0)::int as conversations, coalesce(sum(resolutions), 0)::int as resolutions, coalesce(sum(cost_inr), 0)::float as cost_inr
       from usage_daily where org_id = $1 and day >= date_trunc('month', current_date)`,
    [org.id],
  );
  return c.json({
    mode: config.mode,
    enabled: Boolean(config.razorpay.keyId && config.razorpay.keySecret),
    keyId: config.razorpay.keyId || null,
    plan: org.plan,
    plans,
    subscription: sub ?? null,
    usage,
  });
});

/** Create a Razorpay subscription and return what checkout.js needs. UPI Autopay is supported by Razorpay subscriptions. */
billing.post('/subscribe', requireRole('owner'), async (c) => {
  const org = c.get('org');
  const user = c.get('user');
  const b = await body(c, z.object({ plan: z.enum(['starter', 'growth']) }));
  if (!config.razorpay.keyId || !config.razorpay.keySecret) fail(400, 'Billing is not configured on this server');
  const planId = config.razorpay.plans[b.plan];
  if (!planId) fail(400, `Razorpay plan id for "${b.plan}" is not configured (RAZORPAY_PLAN_${b.plan.toUpperCase()})`);
  const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
    method: 'POST',
    headers: { authorization: razorpayAuth(), 'content-type': 'application/json' },
    body: JSON.stringify({ plan_id: planId, total_count: 120, customer_notify: 1, notes: { org_id: org.id, plan: b.plan } }),
  });
  const data = (await res.json()) as any;
  if (!res.ok) fail(400, data?.error?.description ?? 'Razorpay error');
  await ctx.db.query(
    `insert into subscriptions (org_id, provider, external_id, plan, status) values ($1, 'razorpay', $2, $3, 'created')
     on conflict (org_id) do update set external_id = excluded.external_id, plan = excluded.plan, status = 'created', updated_at = now()`,
    [org.id, data.id, b.plan],
  );
  await audit(org.id, user.id, 'billing.subscription_created', data.id, { plan: b.plan });
  return c.json({ subscriptionId: data.id, shortUrl: data.short_url, keyId: config.razorpay.keyId, prefill: { email: user.email, name: user.name }, orgName: org.name });
});

/** Razorpay webhook: signature = HMAC-SHA256(raw body, webhook secret). */
export const razorpayWebhook = new Hono();
razorpayWebhook.post('/', async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header('x-razorpay-signature') ?? '';
  if (!config.razorpay.webhookSecret || !safeEqual(sig, hmacHex(config.razorpay.webhookSecret, raw))) return c.text('invalid signature', 401);
  const evt = JSON.parse(raw) as any;
  const sub = evt.payload?.subscription?.entity;
  if (!sub) return c.json({ ok: true });
  const row = await ctx.db.one<{ org_id: string; plan: string }>('select org_id, plan from subscriptions where external_id = $1', [sub.id]);
  const orgId = row?.org_id ?? sub.notes?.org_id;
  if (!orgId) return c.json({ ok: true });
  const plan = row?.plan ?? sub.notes?.plan ?? 'starter';
  const periodEnd = sub.current_end ? new Date(sub.current_end * 1000) : null;
  const active = ['subscription.activated', 'subscription.charged', 'subscription.resumed'].includes(evt.event);
  const ended = ['subscription.cancelled', 'subscription.completed', 'subscription.halted', 'subscription.paused'].includes(evt.event);
  await ctx.db.query(
    `insert into subscriptions (org_id, provider, external_id, plan, status, current_period_end) values ($1, 'razorpay', $2, $3, $4, $5)
     on conflict (org_id) do update set status = excluded.status, current_period_end = coalesce(excluded.current_period_end, subscriptions.current_period_end), updated_at = now()`,
    [orgId, sub.id, plan, sub.status ?? evt.event, periodEnd],
  );
  if (active) await ctx.db.query('update orgs set plan = $2 where id = $1', [orgId, plan]);
  if (ended) await ctx.db.query(`update orgs set plan = 'free' where id = $1`, [orgId]);
  await audit(orgId, 'razorpay', `billing.${evt.event}`, sub.id, { status: sub.status });
  return c.json({ ok: true });
});
