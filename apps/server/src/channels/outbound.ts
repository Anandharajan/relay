import { config } from '../config.ts';
import { decrypt } from '../lib/crypto.ts';
import { getOrg } from '../services/orgs.ts';

interface ConvLike {
  org_id: string;
  channel: string;
  visitor_id: string;
}

/** Deliver an agent/AI reply on the conversation's channel. Web chat is delivered via SSE instead. */
export async function sendChannelMessage(conv: ConvLike, text: string): Promise<void> {
  if (conv.channel !== 'whatsapp') return;
  const org = await getOrg(conv.org_id);
  const phoneNumberId = org?.settings.whatsapp?.phoneNumberId;
  const tokenEnc = org?.secrets.whatsappToken;
  if (!phoneNumberId || !tokenEnc) throw new Error('WhatsApp is not configured for this workspace');
  const res = await fetch(`https://graph.facebook.com/${config.whatsapp.graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${decrypt(tokenEnc)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: conv.visitor_id, type: 'text', text: { body: text.slice(0, 4000), preview_url: true } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
