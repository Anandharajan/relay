import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { encrypt, hint, token } from '../lib/crypto.ts';
import { body, fail, requireOrg, requireRole, requireUser, type AppEnv } from '../http.ts';
import { createLlm, providerCatalog } from '../adapters/llm.ts';
import { audit, getModelSettings } from '../services/orgs.ts';

export const workspace = new Hono<AppEnv>();
workspace.use(requireUser, requireOrg);

// ---------- Settings ----------
const settingsSchema = z
  .object({
    name: z.string().min(1).max(100),
    botName: z.string().min(1).max(40),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    greeting: z.string().max(300),
    allowedOrigins: z.array(z.string().max(200)).max(50),
    confidenceThreshold: z.number().min(0).max(1),
    mode: z.enum(['auto', 'draft']),
    idleResolveMinutes: z.number().int().min(5).max(1440),
    retentionDays: z.number().int().min(1).max(3650),
    consentText: z.string().max(400),
  })
  .partial();

workspace.patch('/settings', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const b = await body(c, settingsSchema);
  const { name, ...rest } = b;
  const settings = { ...org.settings, ...rest };
  await ctx.db.query('update orgs set settings = $2::jsonb, name = coalesce($3, name) where id = $1', [org.id, settings, name ?? null]);
  await audit(org.id, c.get('user').id, 'settings.updated', org.id, b);
  return c.json({ ok: true, settings });
});

workspace.post('/rotate-site-key', requireRole('owner'), async (c) => {
  const org = c.get('org');
  const siteKey = `pk_${token(12)}`;
  await ctx.db.query('update orgs set site_key = $2 where id = $1', [org.id, siteKey]);
  await audit(org.id, c.get('user').id, 'site_key.rotated', org.id);
  return c.json({ siteKey });
});

// ---------- Team ----------
workspace.get('/team', async (c) => {
  const org = c.get('org');
  const members = await ctx.db.query(
    'select u.id, u.email, u.name, m.role, m.created_at from members m join users u on u.id = m.user_id where m.org_id = $1 order by m.created_at',
    [org.id],
  );
  const invites = await ctx.db.query('select token, email, role, created_at from invites where org_id = $1 and accepted_at is null order by created_at desc', [org.id]);
  return c.json({ members, invites: invites.map((i) => ({ ...i, url: `${config.publicUrl}/invite/${i.token}` })) });
});

workspace.post('/team/invites', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const b = await body(c, z.object({ email: z.string().email(), role: z.enum(['admin', 'agent']) }));
  const t = token(18);
  await ctx.db.query('insert into invites (token, org_id, email, role, created_by) values ($1, $2, $3, $4, $5)', [t, org.id, b.email.toLowerCase(), b.role, c.get('user').id]);
  await audit(org.id, c.get('user').id, 'member.invited', b.email, { role: b.role });
  return c.json({ url: `${config.publicUrl}/invite/${t}` });
});

workspace.delete('/team/invites/:token', requireRole('admin'), async (c) => {
  await ctx.db.query('delete from invites where token = $1 and org_id = $2', [c.req.param('token'), c.get('org').id]);
  return c.json({ ok: true });
});

workspace.patch('/team/:userId', requireRole('owner'), async (c) => {
  const b = await body(c, z.object({ role: z.enum(['owner', 'admin', 'agent']) }));
  await ctx.db.query('update members set role = $3 where org_id = $1 and user_id = $2', [c.get('org').id, c.req.param('userId'), b.role]);
  await audit(c.get('org').id, c.get('user').id, 'member.role_changed', c.req.param('userId'), b);
  return c.json({ ok: true });
});

workspace.delete('/team/:userId', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const target = c.req.param('userId');
  const owners = await ctx.db.query(`select user_id from members where org_id = $1 and role = 'owner'`, [org.id]);
  if (owners.length === 1 && owners[0]!.user_id === target) fail(400, 'Cannot remove the last owner');
  await ctx.db.query('delete from members where org_id = $1 and user_id = $2', [org.id, target]);
  await audit(org.id, c.get('user').id, 'member.removed', target);
  return c.json({ ok: true });
});

// ---------- Model / BYOK ----------
workspace.get('/model', async (c) => {
  const s = await getModelSettings(c.get('org').id);
  return c.json({
    provider: s.provider,
    model: s.model,
    baseUrl: s.base_url,
    keyHint: s.key_hint,
    monthlyBudgetInr: s.monthly_budget_inr,
    providers: providerCatalog,
    platformDefault: config.defaultLlm.provider === 'extractive' ? 'Extractive (no LLM)' : `${config.defaultLlm.provider}${config.defaultLlm.model ? ` · ${config.defaultLlm.model}` : ''}`,
  });
});

const modelSchema = z.object({
  provider: z.string().refine((p) => providerCatalog.some((x) => x.id === p), 'Unknown provider'),
  model: z.string().max(100).optional().nullable(),
  baseUrl: z.string().url().optional().nullable().or(z.literal('')),
  apiKey: z.string().max(500).optional().nullable(),
  monthlyBudgetInr: z.number().min(0).optional().nullable(),
});

workspace.put('/model', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const b = await body(c, modelSchema);
  const current = await getModelSettings(org.id);
  const keyChanged = typeof b.apiKey === 'string' && b.apiKey.length > 0;
  const keyEnc = keyChanged ? encrypt(b.apiKey!) : b.provider === current.provider ? current.key_enc : null;
  const keyHint = keyChanged ? hint(b.apiKey!) : b.provider === current.provider ? current.key_hint : null;
  await ctx.db.query(
    `insert into model_settings (org_id, provider, model, base_url, key_enc, key_hint, monthly_budget_inr, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (org_id) do update set provider = excluded.provider, model = excluded.model, base_url = excluded.base_url,
       key_enc = excluded.key_enc, key_hint = excluded.key_hint, monthly_budget_inr = excluded.monthly_budget_inr, updated_at = now()`,
    [org.id, b.provider, b.model || null, b.baseUrl || null, keyEnc, keyHint, b.monthlyBudgetInr ?? null],
  );
  await ctx.db.query('delete from answer_cache where org_id = $1', [org.id]);
  await audit(org.id, c.get('user').id, 'model.updated', org.id, { provider: b.provider, model: b.model, keyChanged });
  return c.json({ ok: true, keyHint });
});

workspace.post('/model/test', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const s = await getModelSettings(org.id);
  const { decrypt } = await import('../lib/crypto.ts');
  try {
    const llm = createLlm({ provider: s.provider, model: s.model, baseUrl: s.base_url, apiKey: s.key_enc ? decrypt(s.key_enc) : null });
    if (!llm) return c.json({ ok: true, message: 'Extractive engine: no LLM call needed.' });
    const started = Date.now();
    const r = await llm.complete('Reply with exactly: OK', [{ role: 'user', content: 'Health check' }], { maxTokens: 1000 });
    return c.json({ ok: true, message: `${llm.provider} · ${r.model} replied "${r.text.trim().slice(0, 40)}" in ${Date.now() - started} ms` });
  } catch (e) {
    return c.json({ ok: false, message: (e as Error).message });
  }
});

// ---------- Channels ----------
workspace.put('/channels/whatsapp', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const b = await body(c, z.object({ phoneNumberId: z.string().max(64), accessToken: z.string().max(1000).optional(), enabled: z.boolean() }));
  const verifyToken = org.settings.whatsapp?.verifyToken ?? token(16);
  const settings = { ...org.settings, whatsapp: { phoneNumberId: b.phoneNumberId, verifyToken, enabled: b.enabled } };
  const secrets = { ...org.secrets };
  if (b.accessToken) secrets.whatsappToken = encrypt(b.accessToken);
  await ctx.db.query('update orgs set settings = $2::jsonb, secrets = $3::jsonb where id = $1', [org.id, settings, secrets]);
  await audit(org.id, c.get('user').id, 'channel.whatsapp.updated', org.id, { phoneNumberId: b.phoneNumberId, enabled: b.enabled, tokenChanged: Boolean(b.accessToken) });
  return c.json({ ok: true, webhookUrl: `${config.publicUrl}/webhooks/whatsapp`, verifyToken });
});

// ---------- Privacy & compliance (DPDP) ----------
workspace.get('/audit', requireRole('admin'), async (c) => {
  const rows = await ctx.db.query(
    `select a.*, coalesce(u.name, a.actor) as actor_name from audit_log a left join users u on u.id::text = a.actor where a.org_id = $1 order by a.at desc limit 200`,
    [c.get('org').id],
  );
  return c.json(rows);
});

workspace.get('/privacy/export', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const visitor = c.req.query('visitor');
  if (!visitor) fail(400, 'visitor is required');
  const conversations = await ctx.db.query('select * from conversations where org_id = $1 and (visitor_id = $2 or customer_contact = $2)', [org.id, visitor]);
  const ids = conversations.map((x) => x.id);
  const messages = ids.length ? await ctx.db.query('select conversation_id, role, content, created_at from messages where conversation_id = any($1::uuid[]) order by created_at', [`{${ids.join(',')}}`]) : [];
  const consents = await ctx.db.query('select purpose, granted_at, withdrawn_at from consents where org_id = $1 and visitor_id = $2', [org.id, visitor]);
  await audit(org.id, c.get('user').id, 'privacy.exported', visitor, { conversations: ids.length });
  c.header('content-disposition', `attachment; filename="relay-export-${visitor.replace(/[^\w-]/g, '_')}.json"`);
  return c.json({ exportedAt: new Date().toISOString(), visitor, conversations, messages, consents });
});

workspace.post('/privacy/erase', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const b = await body(c, z.object({ visitor: z.string().min(1) }));
  const rows = await ctx.db.query('delete from conversations where org_id = $1 and (visitor_id = $2 or customer_contact = $2) returning id', [org.id, b.visitor]);
  await ctx.db.query(`update consents set withdrawn_at = now() where org_id = $1 and visitor_id = $2 and withdrawn_at is null`, [org.id, b.visitor]);
  await audit(org.id, c.get('user').id, 'privacy.erased', b.visitor, { conversations: rows.length });
  return c.json({ ok: true, deleted: rows.length });
});
