import { createHmac } from 'node:crypto';
import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { decrypt, safeEqual, uuid } from '../lib/crypto.ts';
import { publish } from '../lib/events.ts';
import { audit, getOrg, hasAddon, type Org } from './orgs.ts';
import { recordRun } from './agents.ts';
import { formatWhen, queueMessage, type Appointment, type Client } from './visits.ts';

/**
 * Telecalling add-on. A provider-agnostic call layer:
 *  - simulated: no telephony account needed; the dashboard plays the patient (press 1/2/3)
 *  - twilio: real outbound calls with a spoken script (Tamil, Hindi, English …) and keypad answers
 *  - exotel: interface reserved (configure via Exotel's ExoML applet, see docs/CLINIC_DEPLOYMENT.md)
 * Speech uses the provider's built-in Indian-language voices; a Sarvam/Bhashini TTS URL can replace it later.
 */

type Purpose = 'reminder' | 'followup';

const voices: Record<string, { lang: string; voice: string }> = {
  ta: { lang: 'ta-IN', voice: 'Google.ta-IN-Standard-A' },
  hi: { lang: 'hi-IN', voice: 'Google.hi-IN-Standard-A' },
  kn: { lang: 'kn-IN', voice: 'Google.kn-IN-Standard-A' },
  te: { lang: 'te-IN', voice: 'Google.te-IN-Standard-A' },
  en: { lang: 'en-IN', voice: 'Google.en-IN-Standard-A' },
};

export function callScript(purpose: Purpose, lang: string, vars: { org: string; name: string; staff?: string; when?: string }): string {
  const ta = lang === 'ta';
  const hi = lang === 'hi';
  if (purpose === 'reminder') {
    if (ta) return `வணக்கம் ${vars.name}. இது ${vars.org} மருத்துவமனையிலிருந்து அழைப்பு. ${vars.staff} அவர்களுடன் உங்கள் சந்திப்பு ${vars.when}. உறுதிப்படுத்த 1 அழுத்தவும். நேரத்தை மாற்ற 2 அழுத்தவும்.`;
    if (hi) return `नमस्ते ${vars.name}। यह ${vars.org} से कॉल है। ${vars.staff} के साथ आपकी अपॉइंटमेंट ${vars.when} को है। पुष्टि के लिए 1 दबाएँ। समय बदलने के लिए 2 दबाएँ।`;
    return `Hello ${vars.name}. This is ${vars.org}. Your appointment with ${vars.staff} is on ${vars.when}. Press 1 to confirm. Press 2 to change the time.`;
  }
  if (ta) return `வணக்கம் ${vars.name}. இது ${vars.org} மருத்துவமனையிலிருந்து. உங்கள் வருகைக்குப் பிறகு இப்போது எப்படி இருக்கிறீர்கள்? நன்றாக இருந்தால் 1, அப்படியே இருந்தால் 2, மோசமாக இருந்தால் 3 அழுத்தவும்.`;
  if (hi) return `नमस्ते ${vars.name}। यह ${vars.org} से कॉल है। आप अब कैसा महसूस कर रहे हैं? बेहतर हो तो 1, वैसा ही हो तो 2, खराब हो तो 3 दबाएँ।`;
  return `Hello ${vars.name}. This is ${vars.org}. How are you feeling since your visit? Press 1 if better, 2 if the same, 3 if worse.`;
}

function xml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function twiml(script: string, lang: string, actionUrl: string) {
  const v = voices[lang] ?? voices.en!;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="dtmf" numDigits="1" timeout="8" action="${xml(actionUrl)}" method="POST"><Say language="${v.lang}" voice="${v.voice}">${xml(script)}</Say></Gather><Say language="${v.lang}" voice="${v.voice}">${xml(script)}</Say><Gather input="dtmf" numDigits="1" timeout="8" action="${xml(actionUrl)}" method="POST"/></Response>`;
}

/** Twilio request signature: base64(HMAC-SHA1(url + sorted key/value pairs, auth token)). */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', authToken).update(data).digest('base64');
}

export function verifyTwilio(org: Org, url: string, params: Record<string, string>, signature: string) {
  const tokenEnc = org.secrets.voiceToken;
  if (!tokenEnc) return false;
  return safeEqual(twilioSignature(decrypt(tokenEnc), url, params), signature);
}

/** Job: place one call for an appointment reminder or a follow-up check-in. */
export async function placeCall(payload: { orgId: string; appointmentId?: string; followupId?: string; purpose: Purpose; clientId?: string }) {
  const org = await getOrg(payload.orgId);
  if (!org || !(await hasAddon(org, 'telecalling'))) return;
  let appt: (Appointment & { staff_name: string }) | undefined;
  let clientId = payload.clientId;
  if (payload.appointmentId) {
    appt = await ctx.db.one(`select a.*, s.name as staff_name from appointments a join staff_members s on s.id = a.staff_id where a.id = $1`, [payload.appointmentId]);
    if (!appt || appt.status !== 'booked') return;
    clientId = appt.client_id;
  }
  if (payload.followupId) {
    const f = await ctx.db.one<{ client_id: string; status: string; appointment_id: string | null }>('select client_id, status, appointment_id from followups where id = $1', [payload.followupId]);
    if (!f || f.status !== 'sent') return; // already answered in chat
    clientId = f.client_id;
  }
  const client = clientId ? await ctx.db.one<Client>('select * from clients where id = $1', [clientId]) : undefined;
  if (!client) return;
  const provider = org.settings.voice?.provider ?? 'simulated';
  const script = callScript(payload.purpose, client.lang, {
    org: org.name,
    name: client.name,
    staff: appt?.staff_name,
    when: appt ? formatWhen(appt.starts_at, org, client.lang) : undefined,
  });
  const id = uuid();
  await ctx.db.query(
    `insert into calls (id, org_id, client_id, appointment_id, followup_id, direction, purpose, provider, to_number, status, transcript) values ($1, $2, $3, $4, $5, 'outbound', $6, $7, $8, 'ringing', $9::jsonb)`,
    [id, org.id, client.id, appt?.id ?? null, payload.followupId ?? null, payload.purpose, provider, client.phone, [{ who: 'relay', text: script, at: new Date().toISOString() }]],
  );
  if (provider === 'twilio') {
    try {
      if (!client.phone) throw new Error('No phone number on file');
      const sid = org.settings.voice?.accountSid;
      const tokenEnc = org.secrets.voiceToken;
      if (!sid || !tokenEnc || !org.settings.voice?.from) throw new Error('Twilio is not configured');
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from(`${sid}:${decrypt(tokenEnc)}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: `+${client.phone}`, From: org.settings.voice.from, Twiml: twiml(script, client.lang, `${config.publicUrl}/webhooks/voice/twilio/${id}`) }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json()) as any;
      if (!res.ok) throw new Error(data?.message ?? `Twilio ${res.status}`);
      await ctx.db.query('update calls set external_id = $2 where id = $1', [id, data.sid]);
    } catch (e) {
      await ctx.db.query(`update calls set status = 'failed', outcome = 'none', transcript = transcript || $2::jsonb, updated_at = now() where id = $1`, [
        id, JSON.stringify([{ who: 'system', text: (e as Error).message }]),
      ]);
    }
  }
  publish(`org:${org.id}`, 'calls.updated', { id });
  const failed = await ctx.db.one<{ outcome: string | null; status: string }>('select status, outcome from calls where id = $1', [id]);
  await recordRun({ orgId: org.id, agent: 'telecaller', trigger: payload.purpose, clientId: client.id, status: failed?.status === 'failed' ? 'failed' : 'ok', outcome: `call placed (${provider})`, tags: failed?.status === 'failed' ? [`telephony.${provider}.failed`] : [], provider, complexity: 2, steps: [{ name: 'compose_script', detail: client.lang }, { name: 'dial', detail: provider }] });
  return id;
}

/** A keypad answer from the callee (real webhook or the dashboard simulator). */
export async function handleDigit(callId: string, digit: string) {
  const call = await ctx.db.one<{ id: string; org_id: string; client_id: string | null; appointment_id: string | null; followup_id: string | null; purpose: Purpose; status: string; transcript: any[] }>(
    'select * from calls where id = $1',
    [callId],
  );
  if (!call || call.status === 'completed') return { reply: '' };
  const org = (await getOrg(call.org_id))!;
  const client = call.client_id ? await ctx.db.one<Client>('select * from clients where id = $1', [call.client_id]) : undefined;
  const ta = client?.lang === 'ta';
  let outcome = 'none';
  let reply = ta ? 'நன்றி.' : 'Thank you.';
  if (call.purpose === 'reminder') {
    if (digit === '1') {
      outcome = 'confirmed';
      reply = ta ? 'நன்றி, உங்கள் சந்திப்பு உறுதிசெய்யப்பட்டது.' : 'Thank you, your appointment is confirmed.';
    } else if (digit === '2') {
      outcome = 'reschedule';
      reply = ta ? 'சரி, எங்கள் வரவேற்பாளர் உங்களை அழைப்பார்.' : 'Okay, our front desk will call you to change the time.';
      if (client) await queueMessage(org, client.id, 'custom', ta ? 'நேரத்தை மாற்ற எங்கள் குழு உங்களைத் தொடர்புகொள்ளும்.' : 'Our team will contact you to change your appointment time.', { appointmentId: call.appointment_id ?? undefined });
      publish(`org:${org.id}`, 'attention', { reason: 'call_reschedule', clientId: call.client_id });
    }
  } else {
    const map: Record<string, string> = { '1': 'better', '2': 'same', '3': 'worse' };
    outcome = map[digit] ?? 'none';
    const followupId = call.followup_id;
    if (followupId && outcome !== 'none') await ctx.db.query('update followups set status = $2, reply = $3 where id = $1', [followupId, outcome, `call: pressed ${digit}`]);
    if (outcome === 'worse') {
      reply = ta ? 'கேட்க வருத்தமாக உள்ளது. உங்கள் மருத்துவர் குழு விரைவில் அழைக்கும்.' : "We're sorry to hear that. Your doctor's team will call you shortly.";
      publish(`org:${org.id}`, 'attention', { reason: 'followup_worse', clientId: call.client_id, urgent: true });
    }
  }
  await ctx.db.query(`update calls set status = 'completed', outcome = $2, transcript = transcript || $3::jsonb, updated_at = now() where id = $1`, [
    call.id, outcome, JSON.stringify([{ who: 'callee', text: `pressed ${digit}`, at: new Date().toISOString() }, { who: 'relay', text: reply, at: new Date().toISOString() }]),
  ]);
  await audit(org.id, 'telecalling', `call.${outcome}`, call.id, { purpose: call.purpose });
  await recordRun({ orgId: org.id, agent: 'telecaller', trigger: 'keypad', clientId: call.client_id, status: outcome === 'worse' || outcome === 'reschedule' ? 'handoff' : 'ok', outcome: `${call.purpose}: ${outcome}`, tags: outcome === 'worse' ? ['handoff.followup_worse'] : outcome === 'reschedule' ? ['handoff.reschedule'] : [], complexity: outcome === 'worse' ? 3 : 2, steps: [{ name: 'gather_dtmf', detail: digit }, { name: 'act', detail: outcome }] });
  publish(`org:${org.id}`, 'calls.updated', { id: call.id });
  return { reply, lang: client?.lang ?? 'en' };
}

export function sayTwiml(text: string, lang: string) {
  const v = voices[lang] ?? voices.en!;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${v.lang}" voice="${v.voice}">${xml(text)}</Say></Response>`;
}

/** Inbound calls: a small IVR. 1 = next appointment details, 2 = transfer to the front desk. */
export function inboundMenu(org: Org, actionUrl: string) {
  const text = `Welcome to ${org.name}. For your next appointment, press 1. To speak to the front desk, press 2. ${org.name} க்கு வரவேற்கிறோம். உங்கள் அடுத்த சந்திப்புக்கு 1, வரவேற்பாளருடன் பேச 2 அழுத்தவும்.`;
  return twiml(text, 'en', actionUrl);
}

export async function inboundChoice(org: Org, from: string, digit: string) {
  if (digit === '2' && org.settings.voice?.transferTo) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${xml(org.settings.voice.transferTo)}</Dial></Response>`;
  }
  const phone = from.replace(/\D/g, '');
  const appt = await ctx.db.one<Appointment & { staff_name: string; lang: string }>(
    `select a.*, s.name as staff_name, c.lang from appointments a join clients c on c.id = a.client_id join staff_members s on s.id = a.staff_id
      where a.org_id = $1 and c.phone = $2 and a.status in ('booked', 'checked_in') and a.starts_at > now() - interval '3 hours' order by a.starts_at limit 1`,
    [org.id, phone],
  );
  await ctx.db.query(`insert into calls (id, org_id, direction, purpose, provider, to_number, status, outcome) values ($1, $2, 'inbound', 'inbound', 'twilio', $3, 'completed', $4)`, [
    uuid(), org.id, phone, appt ? 'appointment_read' : 'none',
  ]);
  if (!appt) return sayTwiml(`We could not find an upcoming appointment for this number. Please message us on WhatsApp to book.`, 'en');
  const text =
    appt.lang === 'ta'
      ? `உங்கள் சந்திப்பு ${appt.staff_name} அவர்களுடன் ${formatWhen(appt.starts_at, org, 'ta')}. டோக்கன் ${appt.token_no}.`
      : `Your appointment is with ${appt.staff_name} on ${formatWhen(appt.starts_at, org, 'en')}. Token ${appt.token_no}.`;
  return sayTwiml(text, appt.lang);
}
