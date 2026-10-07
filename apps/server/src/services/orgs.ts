import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { decrypt, token, uuid } from '../lib/crypto.ts';
import { createLlm, type Llm } from '../adapters/llm.ts';

export interface OrgSettings {
  botName: string;
  brandColor: string;
  greeting: string;
  allowedOrigins: string[];
  confidenceThreshold: number;
  /** auto = AI replies directly; draft = AI drafts, a human approves every reply. */
  mode: 'auto' | 'draft';
  idleResolveMinutes: number;
  retentionDays: number;
  consentText: string;
  whatsapp?: { phoneNumberId?: string; verifyToken?: string; enabled?: boolean };
}

export const defaultSettings: OrgSettings = {
  botName: 'Relay',
  brandColor: '#4f46e5',
  greeting: 'Hi! 👋 Ask me anything — I reply in your language.',
  allowedOrigins: [],
  confidenceThreshold: 0.45,
  mode: 'auto',
  idleResolveMinutes: 30,
  retentionDays: 365,
  consentText: 'Chats are processed by AI to help you faster. Personal data is redacted before AI processing.',
};

export interface Org {
  id: string;
  name: string;
  plan: string;
  site_key: string;
  settings: OrgSettings;
  secrets: Record<string, string>;
  created_at: Date;
}

export async function getOrg(id: string): Promise<Org | undefined> {
  const org = await ctx.db.one<Org>('select * from orgs where id = $1', [id]);
  if (org) org.settings = { ...defaultSettings, ...org.settings };
  return org;
}

export async function getOrgBySiteKey(siteKey: string): Promise<Org | undefined> {
  const row = await ctx.db.one<{ id: string }>('select id from orgs where site_key = $1', [siteKey]);
  return row ? getOrg(row.id) : undefined;
}

export async function createOrg(name: string, ownerId: string, settings: Partial<OrgSettings> = {}): Promise<Org> {
  const id = uuid();
  const siteKey = `pk_${token(12)}`;
  await ctx.db.query('insert into orgs (id, name, site_key, settings) values ($1, $2, $3, $4::jsonb)', [id, name, siteKey, { ...settings }]);
  await ctx.db.query(`insert into members (org_id, user_id, role) values ($1, $2, 'owner')`, [id, ownerId]);
  await ctx.db.query(`insert into model_settings (org_id, provider) values ($1, 'default')`, [id]);
  await audit(id, ownerId, 'org.created', id, { name });
  return (await getOrg(id))!;
}

export async function audit(orgId: string, actor: string, action: string, target?: string | null, payload: object = {}) {
  await ctx.db.query('insert into audit_log (id, org_id, actor, action, target, payload) values ($1, $2, $3, $4, $5, $6::jsonb)', [
    uuid(), orgId, actor, action, target ?? null, payload,
  ]);
}

type UsageField = 'conversations' | 'ai_messages' | 'resolutions' | 'tokens' | 'cost_inr';

export async function addUsage(orgId: string, delta: Partial<Record<UsageField, number>>) {
  const fields = Object.entries(delta).filter(([, v]) => v) as [UsageField, number][];
  if (!fields.length) return;
  const cols = fields.map(([k]) => k);
  const vals = fields.map(([, v]) => v);
  await ctx.db.query(
    `insert into usage_daily (org_id, day, ${cols.join(', ')}) values ($1, current_date, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     on conflict (org_id, day) do update set ${cols.map((c) => `${c} = usage_daily.${c} + excluded.${c}`).join(', ')}`,
    [orgId, ...vals],
  );
}

export interface ModelSettings {
  provider: string;
  model: string | null;
  base_url: string | null;
  key_enc: string | null;
  key_hint: string | null;
  monthly_budget_inr: number | null;
}

export async function getModelSettings(orgId: string): Promise<ModelSettings> {
  return (
    (await ctx.db.one<ModelSettings>('select * from model_settings where org_id = $1', [orgId])) ?? {
      provider: 'default', model: null, base_url: null, key_enc: null, key_hint: null, monthly_budget_inr: null,
    }
  );
}

/** Resolve the org's model. Returns null when the extractive engine should answer. */
export async function llmForOrg(orgId: string): Promise<{ llm: Llm | null; byok: boolean; budgetExceeded: boolean }> {
  const s = await getModelSettings(orgId);
  const byok = s.provider !== 'default' && s.provider !== 'extractive';
  let budgetExceeded = false;
  if (s.monthly_budget_inr) {
    const spent = await ctx.db.one<{ c: number }>(
      `select coalesce(sum(cost_inr), 0)::float as c from usage_daily where org_id = $1 and day >= date_trunc('month', current_date)`,
      [orgId],
    );
    budgetExceeded = (spent?.c ?? 0) >= s.monthly_budget_inr;
  }
  if (budgetExceeded) return { llm: null, byok, budgetExceeded };
  const llm = createLlm({ provider: s.provider, model: s.model, baseUrl: s.base_url, apiKey: s.key_enc ? decrypt(s.key_enc) : null });
  return { llm, byok, budgetExceeded };
}

export const plans = {
  free: { label: 'Cloud Free', priceInr: 0, aiConversations: 100, seats: 2, actions: false, simulations: true },
  starter: { label: 'Starter', priceInr: 999, aiConversations: 1000, seats: 3, actions: true, simulations: true },
  growth: { label: 'Growth', priceInr: 3999, aiConversations: 5000, seats: 5, actions: true, simulations: true },
} as const;

/** Plan limits only apply in cloud mode, and never to BYOK conversations. */
export async function withinPlan(org: Org, byok: boolean): Promise<boolean> {
  if (config.mode !== 'cloud' || byok) return true;
  const plan = plans[org.plan as keyof typeof plans] ?? plans.free;
  const used = await ctx.db.one<{ c: number }>(
    `select coalesce(sum(conversations), 0)::int as c from usage_daily where org_id = $1 and day >= date_trunc('month', current_date)`,
    [org.id],
  );
  return (used?.c ?? 0) < plan.aiConversations;
}
