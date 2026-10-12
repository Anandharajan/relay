import { config } from '../config.ts';
import { decrypt } from '../lib/crypto.ts';
import { ctx } from '../ctx.ts';
import { getOrg } from '../services/orgs.ts';

interface ConvLike {
  id?: string;
  org_id: string;
  channel: string;
  visitor_id: string;
  customer_name?: string | null;
  lang?: string | null;
}

/** Deliver an agent/AI reply on the conversation's channel. Web chat is delivered via SSE instead. */
/**
 * WhatsApp only allows free-form messages within 24 hours of the person's last message. Outside that window
 * (reminders, follow-ups, approved findings) we send the workspace's approved utility template instead, with
 * the message as a parameter. Template body to register in Meta (Utility):
 *   "Hello {{1}}, an update from {{2}}:\n\n{{3}}\n\nReply here if you have any questions."
 */
export async function sendChannelMessage(conv: ConvLike, text: string): Promise<void> {
  if (conv.channel !== 'whatsapp') return;
  const org = await getOrg(conv.org_id);
  const phoneNumberId = org?.settings.whatsapp?.phoneNumberId;
  const tokenEnc = org?.secrets.whatsappToken;
  if (!phoneNumberId || !tokenEnc) throw new Error('WhatsApp is not configured for this workspace');
  const res = await fetch(`https://graph.facebook.com/${config.whatsapp.graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${decrypt(tokenEnc)}`, 'content-type': 'application/json' },
    body: JSON.stringify(await whatsappPayload(conv, org!, text)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function whatsappPayload(conv: ConvLike, org: NonNullable<Awaited<ReturnType<typeof getOrg>>>, text: string) {
  const last = conv.id
    ? await ctx.db.one<{ at: Date }>(`select max(created_at) as at from messages where conversation_id = $1 and role = 'customer'`, [conv.id])
    : undefined;
  const open = last?.at && Date.now() - new Date(last.at).getTime() < 23.5 * 3600_000;
  if (open) return { messaging_product: 'whatsapp', to: conv.visitor_id, type: 'text', text: { body: text.slice(0, 4000), preview_url: true } };
  const tpl = (org.settings.whatsapp as any)?.template ?? 'relay_update';
  const lang = conv.lang === 'ta' ? ((org.settings.whatsapp as any)?.templateLangTa ?? 'ta') : ((org.settings.whatsapp as any)?.templateLang ?? 'en');
  // Template parameters cannot contain newlines or more than 4 consecutive spaces.
  const clean = (s: string) => s.replace(/\s*\n+\s*/g, ' · ').replace(/ {4,}/g, ' ').slice(0, 1000);
  return {
    messaging_product: 'whatsapp',
    to: conv.visitor_id,
    type: 'template',
    template: {
      name: tpl,
      language: { code: lang },
      components: [{ type: 'body', parameters: [{ type: 'text', text: clean(conv.customer_name || 'there') }, { type: 'text', text: clean(org.name) }, { type: 'text', text: clean(text) }] }],
    },
  };
}
