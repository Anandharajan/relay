import { Hono } from 'hono';
import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { hmacHex, safeEqual } from '../lib/crypto.ts';
import { getOrg } from '../services/orgs.ts';
import { createConversation, handleCustomerMessage, type Conversation } from '../services/conversations.ts';

/**
 * WhatsApp Cloud API webhook. One Meta app can serve many workspaces: each workspace stores its
 * phone_number_id, and inbound messages are routed by metadata.phone_number_id.
 */
export const whatsapp = new Hono();

whatsapp.get('/', async (c) => {
  const mode = c.req.query('hub.mode');
  const verify = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge') ?? '';
  if (mode !== 'subscribe' || !verify) return c.text('bad request', 400);
  const org = await ctx.db.one(`select id from orgs where settings->'whatsapp'->>'verifyToken' = $1`, [verify]);
  return org ? c.text(challenge) : c.text('forbidden', 403);
});

whatsapp.post('/', async (c) => {
  const raw = await c.req.text();
  if (config.whatsapp.appSecret) {
    const sig = c.req.header('x-hub-signature-256') ?? '';
    if (!safeEqual(sig, `sha256=${hmacHex(config.whatsapp.appSecret, raw)}`)) return c.text('invalid signature', 401);
  }
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text('bad json', 400);
  }
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId || !value.messages) continue;
      const row = await ctx.db.one<{ id: string }>(`select id from orgs where settings->'whatsapp'->>'phoneNumberId' = $1`, [phoneNumberId]);
      const org = row && (await getOrg(row.id));
      if (!org || org.settings.whatsapp?.enabled === false) continue;
      const names: Record<string, string> = Object.fromEntries((value.contacts ?? []).map((ct: any) => [ct.wa_id, ct.profile?.name]));
      for (const m of value.messages) {
        const text = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive' ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title) : null;
        if (!text) continue;
        const waId: string = m.from;
        let conv = await ctx.db.one<Conversation>(
          `select * from conversations where org_id = $1 and channel = 'whatsapp' and visitor_id = $2 and (status <> 'resolved' or resolved_at > now() - interval '1 day') order by created_at desc limit 1`,
          [org.id, waId],
        );
        if (!conv) conv = await createConversation(org, waId, 'whatsapp', { name: names[waId], contact: `+${waId}` });
        await handleCustomerMessage(org, conv, text);
      }
    }
  }
  // Meta retries non-200s aggressively; always ack.
  return c.text('ok');
});
