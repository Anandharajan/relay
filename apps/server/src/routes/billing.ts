import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { hmacHex, safeEqual } from '../lib/crypto.ts';
import { body, fail, requireOrg, requireRole, requireUser, type AppEnv } from '../http.ts';
import { addonCatalog, addonStatus, audit, plans, TRIAL_DAYS, type AddonKey } from '../services/orgs.ts';

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
    addons: await addonStatus(org),
    trialDays: TRIAL_DAYS,
    subscription: sub ?? null,
    usage,
  });
});

/** Create a Razorpay subscription and return what checkout.js needs. UPI Autopay is supported by Razorpay subscriptions. */
billing.post('/subscribe', requireRole('owner'), async (c) => {
  const org = c.get('org');
  const user = c.get('user');
  const b = await body(c, z.object({ plan: z.enum(['starter', 'growth', 'institution']) }));
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

/** Free trial of a paid add-on (once per workspace). */
billing.post('/addons/:addon/trial', requireRole('owner'), async (c) => {
  const org = c.get('org');
  const addon = c.req.param('addon') as AddonKey;
  if (!(addon in addonCatalog)) fail(404, 'Unknown add-on');
  if (config.mode !== 'cloud') return c.json({ ok: true, status: 'included' });
  const existing = await ctx.db.one('select 1 from addons where org_id = $1 and addon = $2', [org.id, addon]);
  if (existing) fail(409, 'The free trial for this add-on has already been used. Subscribe to keep using it.');
  await ctx.db.query(`insert into addons (org_id, addon, status, expires_at) values ($1, $2, 'trial', now() + ($3 || ' days')::interval)`, [org.id, addon, String(TRIAL_DAYS)]);
  await audit(org.id, c.get('user').id, 'billing.addon_trial', addon, {});
  return c.json({ ok: true, status: 'trial' });
});

/** Subscribe to an add-on through Razorpay (UPI Autopay supported). */
billing.post('/addons/:addon/subscribe', requireRole('owner'), async (c) => {
  const org = c.get('org');
  const user = c.get('user');
  const addon = c.req.param('addon') as AddonKey;
  if (!(addon in addonCatalog)) fail(404, 'Unknown add-on');
  if (!config.razorpay.keyId || !config.razorpay.keySecret) fail(400, 'Billing is not configured on this server');
  const planId = config.razorpay.plans[addon];
  if (!planId) fail(400, `Razorpay plan id for the ${addon} add-on is not configured`);
  const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
    method: 'POST',
    headers: { authorization: razorpayAuth(), 'content-type': 'application/json' },
    body: JSON.stringify({ plan_id: planId, total_count: 120, customer_notify: 1, notes: { org_id: org.id, addon } }),
  });
  const data = (await res.json()) as any;
  if (!res.ok) fail(400, data?.error?.description ?? 'Razorpay error');
  await ctx.db.query(
    `insert into addons (org_id, addon, status, external_id) values ($1, $2, 'created', $3) on conflict (org_id, addon) do update set external_id = excluded.external_id, updated_at = now()`,
    [org.id, addon, data.id],
  );
  await audit(org.id, user.id, 'billing.addon_subscription_created', data.id, { addon });
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
  const activeEvt = ['subscription.activated', 'subscription.charged', 'subscription.resumed'].includes(evt.event);
  const endedEvt = ['subscription.cancelled', 'subscription.completed', 'subscription.halted', 'subscription.paused'].includes(evt.event);
  // Add-on subscriptions carry notes.addon and update entitlements only.
  const addonRow = await ctx.db.one<{ org_id: string; addon: string }>('select org_id, addon from addons where external_id = $1', [sub.id]);
  if (addonRow || sub.notes?.addon) {
    const orgId = addonRow?.org_id ?? sub.notes?.org_id;
    const addon = addonRow?.addon ?? sub.notes?.addon;
    if (orgId && addon && (activeEvt || endedEvt)) {
      await ctx.db.query(
        `insert into addons (org_id, addon, status, expires_at, external_id) values ($1, $2, $3, $4, $5)
         on conflict (org_id, addon) do update set status = excluded.status, expires_at = excluded.expires_at, external_id = excluded.external_id, updated_at = now()`,
        [orgId, addon, activeEvt ? 'active' : 'cancelled', sub.current_end ? new Date((sub.current_end + 3 * 86400) * 1000) : null, sub.id],
      );
      await audit(orgId, 'razorpay', `billing.addon.${evt.event}`, sub.id, { addon });
    }
    return c.json({ ok: true });
  }
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
