import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { encrypt, uuid } from '../lib/crypto.ts';
import { body, fail, requireOrg, requireRole, requireUser, type AppEnv } from '../http.ts';
import { detectDrift, executeAction, loadActions, renderTemplate } from '../engine/actions.ts';
import { audit, plans } from '../services/orgs.ts';

export const actionsApi = new Hono<AppEnv>();
actionsApi.use(requireUser, requireOrg);

const paramSchema = z.object({
  name: z.string().regex(/^\w+$/, 'letters, digits, underscore').max(40),
  description: z.string().max(200).default(''),
  required: z.boolean().default(true),
  pattern: z.string().max(200).optional().nullable().transform((v) => v || undefined),
});

const actionSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  keywords: z.array(z.string().max(60)).max(40).default([]),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  url: z.string().url().max(1000),
  headers: z.record(z.string()).optional(),
  params: z.array(paramSchema).max(10).default([]),
  bodyTemplate: z.string().max(5000).optional().nullable(),
  responseTemplate: z.string().max(2000).default(''),
  sensitive: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

function present(a: any) {
  const { headers_enc, ...rest } = a;
  let drift = null;
  if (a.health === 'drift' && a.last_error) {
    try {
      drift = JSON.parse(a.last_error);
    } catch {
      /* not drift JSON */
    }
  }
  return { ...rest, hasHeaders: Boolean(headers_enc), drift };
}

actionsApi.get('/', async (c) => {
  const rows = await loadActions(c.get('org').id, false);
  return c.json(rows.map(present));
});

actionsApi.get('/:id/runs', async (c) => {
  const rows = await ctx.db.query('select * from action_runs where action_id = $1 and org_id = $2 order by created_at desc limit 50', [c.req.param('id'), c.get('org').id]);
  return c.json(rows);
});

function checkPlan(c: any) {
  const org = c.get('org');
  if (config.mode === 'cloud' && !plans[org.plan as keyof typeof plans]?.actions) fail(403, 'Actions are available on the Starter and Growth plans');
}

actionsApi.post('/', requireRole('admin'), async (c) => {
  checkPlan(c);
  const org = c.get('org');
  const b = await body(c, actionSchema);
  const id = uuid();
  await ctx.db.query(
    `insert into actions (id, org_id, name, description, keywords, method, url, headers_enc, params, body_template, response_template, sensitive, enabled)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)`,
    [id, org.id, b.name, b.description, b.keywords, b.method, b.url, b.headers && Object.keys(b.headers).length ? encrypt(JSON.stringify(b.headers)) : null, b.params, b.bodyTemplate ?? null, b.responseTemplate, b.sensitive, b.enabled],
  );
  await audit(org.id, c.get('user').id, 'action.created', id, { name: b.name, sensitive: b.sensitive });
  return c.json({ id });
});

actionsApi.put('/:id', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const b = await body(c, actionSchema);
  const existing = await ctx.db.one('select headers_enc from actions where id = $1 and org_id = $2', [c.req.param('id'), org.id]);
  if (!existing) fail(404, 'Action not found');
  const headersEnc = b.headers === undefined ? existing.headers_enc : Object.keys(b.headers).length ? encrypt(JSON.stringify(b.headers)) : null;
  await ctx.db.query(
    `update actions set name = $3, description = $4, keywords = $5::jsonb, method = $6, url = $7, headers_enc = $8, params = $9::jsonb,
            body_template = $10, response_template = $11, sensitive = $12, enabled = $13, health = 'unknown', last_error = null
      where id = $1 and org_id = $2`,
    [c.req.param('id'), org.id, b.name, b.description, b.keywords, b.method, b.url, headersEnc, b.params, b.bodyTemplate ?? null, b.responseTemplate, b.sensitive, b.enabled],
  );
  await audit(org.id, c.get('user').id, 'action.updated', c.req.param('id'), { name: b.name });
  return c.json({ ok: true });
});

actionsApi.delete('/:id', requireRole('admin'), async (c) => {
  await ctx.db.query('delete from actions where id = $1 and org_id = $2', [c.req.param('id'), c.get('org').id]);
  await audit(c.get('org').id, c.get('user').id, 'action.deleted', c.req.param('id'));
  return c.json({ ok: true });
});

actionsApi.post('/:id/test', requireRole('admin'), async (c) => {
  const action = (await loadActions(c.get('org').id, false)).find((a) => a.id === c.req.param('id'));
  if (!action) fail(404, 'Action not found');
  const b = await body(c, z.object({ params: z.record(z.string()).default({}) }));
  const result = await executeAction(action, b.params);
  return c.json({ ...result, rendered: result.ok ? renderTemplate(action.response_template, result.data) : null });
});

/** Self-healing: apply the proposed field mapping after the merchant API changed shape. */
actionsApi.post('/:id/heal', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const b = await body(c, z.object({ mapping: z.record(z.string()) }));
  const action = await ctx.db.one<{ response_template: string }>('select response_template from actions where id = $1 and org_id = $2', [c.req.param('id'), org.id]);
  if (!action) fail(404, 'Action not found');
  let tpl = action.response_template;
  for (const [from, to] of Object.entries(b.mapping)) {
    if (!/^[\w.]+$/.test(to)) fail(400, 'Invalid field path');
    tpl = tpl.replace(new RegExp(`\\{\\{\\s*${from.replace(/\./g, '\\.')}\\s*\\}\\}`, 'g'), `{{${to}}}`);
  }
  await ctx.db.query(`update actions set response_template = $3, health = 'ok', last_error = null where id = $1 and org_id = $2`, [c.req.param('id'), org.id, tpl]);
  await audit(org.id, c.get('user').id, 'action.healed', c.req.param('id'), { mapping: b.mapping });
  return c.json({ ok: true, responseTemplate: tpl });
});

/** Propose Actions from an OpenAPI 3 document, or a response template from a sample JSON payload. */
actionsApi.post('/import', requireRole('admin'), async (c) => {
  const b = await body(c, z.object({ openapi: z.string().max(500_000).optional(), sample: z.string().max(100_000).optional() }));
  if (b.sample) {
    let data: unknown;
    try {
      data = JSON.parse(b.sample);
    } catch {
      fail(400, 'Sample is not valid JSON');
    }
    const fields = Object.keys(flattenPrimitives(data)).slice(0, 8);
    return c.json({ responseTemplate: fields.map((f) => `${f.split('.').pop()!.replace(/_/g, ' ')}: {{${f}}}`).join('\n'), fields, check: detectDrift(fields.map((f) => `{{${f}}}`).join(' '), data) });
  }
  if (!b.openapi) fail(400, 'Provide an OpenAPI document or a sample response');
  let doc: any;
  try {
    doc = JSON.parse(b.openapi);
  } catch {
    fail(400, 'Paste the OpenAPI document as JSON');
  }
  const server = (doc.servers?.[0]?.url ?? '').replace(/\/$/, '');
  const proposals: any[] = [];
  for (const [path, ops] of Object.entries<any>(doc.paths ?? {})) {
    for (const [method, op] of Object.entries<any>(ops)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const params = [...(ops.parameters ?? []), ...(op.parameters ?? [])].filter((p: any) => p.in === 'path' || p.in === 'query');
      const query = params.filter((p: any) => p.in === 'query').map((p: any) => `${p.name}={${p.name}}`).join('&');
      const summary: string = op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`;
      const okSchema = op.responses?.['200']?.content?.['application/json']?.schema;
      const fields = okSchema?.properties ? Object.keys(okSchema.properties).slice(0, 6) : [];
      proposals.push({
        name: summary.slice(0, 80),
        description: (op.description ?? summary).slice(0, 500),
        keywords: [...new Set(summary.toLowerCase().split(/[^a-z]+/).filter((w: string) => w.length > 3))].slice(0, 6),
        method: method.toUpperCase(),
        url: `${server}${path}${query ? `?${query}` : ''}`,
        params: params.map((p: any) => ({ name: p.name, description: p.description ?? p.name, required: Boolean(p.required ?? p.in === 'path') })),
        responseTemplate: fields.map((f) => `${f.replace(/_/g, ' ')}: {{${f}}}`).join('\n'),
        sensitive: method !== 'get',
        enabled: true,
      });
    }
  }
  return c.json({ proposals: proposals.slice(0, 50) });
});

function flattenPrimitives(obj: any, prefix = '', out: Record<string, unknown> = {}) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const [k, v] of Object.entries(obj)) flattenPrimitives(v, prefix ? `${prefix}.${k}` : k, out);
  else if (prefix && (obj === null || typeof obj !== 'object')) out[prefix] = obj;
  return out;
}
