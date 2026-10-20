import { ctx } from '../ctx.ts';
import type { Org } from '../services/orgs.ts';
import {
  bookAppointment, checkIn, dayBounds, etaFor, findOrCreateClient, formatWhen, freeSlots, listStaff, visitLink, type Appointment, type Staff,
} from '../services/visits.ts';
import { t } from './i18n.ts';

/**
 * Deterministic conversational flows for visits. Work identically with or without an LLM:
 * numbered choices, short replies, every language the canned strings cover.
 */

export interface FlowResult {
  text: string;
  metaPatch: Record<string, unknown>;
  handoff?: string;
}

interface BookingState {
  step: 'staff' | 'slot' | 'name';
  staffIds?: string[];
  staffId?: string;
  slots?: string[];
  slot?: string;
  reason?: string;
  /** Language the booking started in: short replies like "2" must not switch it to English. */
  lang?: string;
}

const bookRe =
  /\b(book|booking|appointment|appoinment|apointment|appt|schedule (a |an )?(visit|consult\w*|session)|see (a |the )?(doctor|dr)|meet (a |the )?(doctor|dr)|slot|token|check-?up|consultation with|visit (dr|doctor))\b|\bwith dr\.? [a-z]|அப்பாயின்ட்மென்ட்|அப்பாய்ண்ட்மெண்ட்|அப்பாயிண்ட்மென்ட்|முன்பதிவு|டாக்டர[ைை]? ?(பார்க்க|பாக்க|சந்திக்க)|டாக்டர் பார்|டாக்டரைப் பார்|மருத்துவரை (பார்க்க|சந்திக்க)|அபாயின்ட்மென்ட்|अपॉइंटमेंट|अपॉइंटमेंट|बुक कर|डॉक्टर से मिल|ಅಪಾಯಿಂಟ್ಮೆಂಟ್|ಬುಕ್ ಮಾಡ|అపాయింట్‌మెంట్|బుక్ చేయ/i;
const changeRe = /\b(cancel|reschedul\w*|postpone|change (my )?(appointment|time|slot))\b|ரத்து|மாற்ற|रद्द|बदल|ರದ್ದು|రద్దు/i;
const arrivedRe =
  /\b(i('?m| am) (here|at the (clinic|hospital|reception|centre|center))|i (have )?(arrived|reached)|i('?ve)? reached|just (arrived|reached)|reached (the )?(clinic|hospital))\b|வந்துவிட்டேன்|வந்து விட்டேன்|வந்துட்டேன்|பहुँच गया|पहुँच गया|पहुंच गया|पहुँच गई|पहुंच गई|ತಲುಪಿದ್ದೇನೆ|ಬಂದಿದ್ದೇನೆ|చేరుకున్నాను|వచ్చాను/i;
const queueRe =
  /\b(how long|waiting time|wait time|how much (more )?time|my turn|queue|token (status|number|no)|eta|when will (i|my turn))\b|எவ்வளவு நேரம்|காத்திருப்பு|எப்போது என் முறை|டோக்கன்|कितना समय|कितनी देर|मेरी बारी|ಎಷ್ಟು ಸಮಯ|ನನ್ನ ಸರದಿ|ఎంత సమయం|నా వంతు/i;
const stopRe = /^\s*(stop|cancel|no|exit|quit|nevermind|never mind|வேண்டாம்|நிறுத்து|नहीं|रुको|ಬೇಡ|వద్దు)\s*[.!]*\s*$/i;

/** Specialty synonyms in English, Tamil and Hindi. */
const synonyms: [RegExp, string][] = [
  [/heart|cardi|bp|chest|இதய|இருதய|हृदय|दिल/i, 'cardio'],
  [/child|\bkids?\b|baby|infant|paediatric|pediatric|my (son|daughter)|குழந்தை|बच्च|ಮಕ್ಕಳ/i, 'paediatr'],
  [/skin|derma|hair|rash|acne|தோல்|त्वचा/i, 'derma'],
  [/sugar|diabet|thyroid|hormone|endocrin|சர்க்கரை|நீரிழிவு|शुगर|मधुमेह/i, 'diabet'],
  [/bone|joint|knee|back pain|fracture|ortho|எலும்பு|மூட்டு|हड्डी|जोड़/i, 'ortho'],
  [/women|pregnan|\bperiods?\b|gyn|obst|antenatal|மகப்பேறு|கர்ப்ப|பெண்கள்|गर्भ|स्त्री/i, 'gyn'],
  [/anaesth|anesth|pre-?op|surgery|operation|மயக்க/i, 'anaesth'],
  [/eye|vision|ophth|கண்|आँख/i, 'ophth'],
  [/\bears?\b|\bnose\b|throat|\bent\b|காது|மூக்கு|தொண்டை|कान|गला/i, 'ent'],
  [/fever|cold|cough|general|physician|காய்ச்சல்|சளி|बुखार|सामान्य/i, 'general'],
  [/teeth|tooth|dental|\bdentist|பல் வலி|दांत/i, 'dent'],
];

function pickByNumber(text: string, n: number): number | null {
  const m = text.trim().match(/^\D*(\d{1,2})\D*$/);
  if (!m) return null;
  const i = Number(m[1]) - 1;
  return i >= 0 && i < n ? i : null;
}

export function matchStaff(text: string, staff: Staff[]): Staff[] {
  const lower = text.toLowerCase();
  const byName = staff.filter((s) => {
    const last = s.name.replace(/^dr\.?\s*/i, '').split(/\s+/).filter((w) => w.length > 2);
    return last.some((w) => lower.includes(w.toLowerCase()));
  });
  if (byName.length) return byName;
  const keys = synonyms.filter(([re]) => re.test(text)).map(([, k]) => k);
  if (!keys.length) return [];
  return staff.filter((s) => keys.some((k) => s.specialty.toLowerCase().includes(k)));
}

export async function todaysAppointment(org: Org, conversationId: string): Promise<Appointment | undefined> {
  const { start, end } = dayBounds(new Date(), org.settings.utcOffsetMin);
  return ctx.db.one<Appointment>(
    `select a.* from appointments a join clients c on c.id = a.client_id
      where c.conversation_id = $1 and a.org_id = $2 and a.starts_at >= $3 and a.starts_at < $4 and a.status in ('booked', 'checked_in', 'in_progress')
      order by a.starts_at limit 1`,
    [conversationId, org.id, start, end],
  );
}

/** Returns a reply when the message belongs to a visit flow, otherwise null so normal Q&A runs. */
export async function visitFlow(org: Org, text: string, detected: string, meta: Record<string, any> | undefined, conversationId: string | undefined): Promise<FlowResult | null> {
  if (!conversationId) return null;
  const state = meta?.booking as BookingState | undefined;
  const lang = state?.lang && detected === 'en' ? state.lang : detected;
  const staff = await listStaff(org.id);
  if (!staff.length) return null;

  // Continue an active booking.
  if (state) {
    if (stopRe.test(text)) return { text: t('bookingCancelled', lang), metaPatch: { booking: null } };
    if (state.step === 'staff') {
      const list = (state.staffIds ?? []).map((id) => staff.find((s) => s.id === id)).filter(Boolean) as Staff[];
      const i = pickByNumber(text, list.length);
      const chosen = i !== null ? list[i] : matchStaff(text, list)[0];
      if (!chosen) return { text: t('pickNumber', lang), metaPatch: {} };
      return offerSlots(org, chosen, lang, state.reason);
    }
    if (state.step === 'slot') {
      const i = pickByNumber(text, state.slots?.length ?? 0);
      if (i === null) return { text: t('pickNumber', lang), metaPatch: {} };
      const conv = await ctx.db.one<{ customer_name: string | null }>('select customer_name from conversations where id = $1', [conversationId]);
      const next: BookingState = { ...state, step: 'name', slot: state.slots![i], lang };
      if (conv?.customer_name) return finishBooking(org, next, conv.customer_name, null, lang, conversationId);
      return { text: t('askName', lang), metaPatch: { booking: next } };
    }
    if (state.step === 'name') {
      const phone = text.match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/)?.[0] ?? null;
      const name = text.replace(phone ?? '', '').replace(/[,;|]/g, ' ').replace(/\s+/g, ' ').trim();
      if (name.length < 2) return { text: t('askName', lang), metaPatch: {} };
      return finishBooking(org, state, name, phone, lang, conversationId);
    }
  }

  // Arrived / waiting-time questions about today's visit.
  if (arrivedRe.test(text) || queueRe.test(text)) {
    const appt = await todaysAppointment(org, conversationId);
    if (!appt) return queueRe.test(text) && !bookRe.test(text) ? { text: t('noAppointment', lang), metaPatch: {} } : null;
    if (arrivedRe.test(text) && appt.status === 'booked') {
      try {
        const r = await checkIn(org, appt, 'whatsapp');
        return { text: t('checkedIn', lang, { token: String(r.appointment.token_no), ahead: String(r.ahead), eta: String(r.etaMin) }), metaPatch: {} };
      } catch (e) {
        return { text: (e as Error).message, metaPatch: {} };
      }
    }
    const eta = await etaFor(org, appt);
    return { text: t('queueStatus', lang, { token: String(appt.token_no), ahead: String(eta.ahead), eta: String(eta.etaMin) }), metaPatch: {} };
  }

  // Changing an existing appointment goes to a person (identity check, clinic policy).
  if (changeRe.test(text) && /appoint|slot|token|visit|booking|சந்திப்பு|அப்பாய|முன்பதிவு|अपॉइंट|ಅಪಾಯಿ|అపాయి/i.test(text)) return { text: t('handoff', lang), metaPatch: {}, handoff: 'appointment_change' };

  if (bookRe.test(text)) {
    const matched = matchStaff(text, staff);
    if (matched.length === 1) return offerSlots(org, matched[0]!, lang, text.slice(0, 200));
    const options = (matched.length ? matched : staff).slice(0, 9);
    const list = options.map((s, i) => `${i + 1}. ${s.name}${s.specialty ? ` (${s.specialty})` : ''}`).join('\n');
    return { text: t('chooseStaff', lang, { list }), metaPatch: { booking: { step: 'staff', staffIds: options.map((s) => s.id), reason: text.slice(0, 200), lang } satisfies BookingState } };
  }
  return null;
}

async function offerSlots(org: Org, s: Staff, lang: string, reason?: string): Promise<FlowResult> {
  const slots = await freeSlots(org, s, 6);
  if (!slots.length) return { text: t('noSlots', lang), metaPatch: { booking: null }, handoff: 'no_slots' };
  const list = slots.map((d, i) => `${i + 1}. ${formatWhen(d, org, lang)}`).join('\n');
  return { text: t('chooseSlot', lang, { staff: s.name, list }), metaPatch: { booking: { step: 'slot', staffId: s.id, slots: slots.map((d) => d.toISOString()), reason, lang } satisfies BookingState } };
}

async function finishBooking(org: Org, state: BookingState, name: string, phone: string | null, lang: string, conversationId: string): Promise<FlowResult> {
  const client = await findOrCreateClient(org, { name, phone, lang, conversationId });
  if (client.conversation_id !== conversationId) await ctx.db.query('update clients set conversation_id = $2 where id = $1', [client.id, conversationId]);
  await ctx.db.query('update conversations set customer_name = coalesce(customer_name, $2) where id = $1', [conversationId, name]);
  try {
    const appt = await bookAppointment(org, { clientId: client.id, staffId: state.staffId!, startsAt: new Date(state.slot!), reason: state.reason, channel: 'chat' });
    const s = (await ctx.db.one<Staff>('select * from staff_members where id = $1', [appt.staff_id]))!;
    return {
      text: t('booked', lang, { staff: s.name, when: formatWhen(appt.starts_at, org, lang), token: String(appt.token_no), link: visitLink(appt.code) }),
      metaPatch: { booking: null, appointmentId: appt.id, clientId: client.id,
        agent: { intent: 'booking', nextAction: 'attend_visit', summary: `Booked with ${s.name}; token ${appt.token_no}.` } },
    };
  } catch (e) {
    const s = await ctx.db.one<Staff>('select * from staff_members where id = $1', [state.staffId]);
    if (s) {
      const r = await offerSlots(org, s, lang, state.reason);
      return { ...r, text: `${(e as Error).message}\n\n${r.text}` };
    }
    return { text: (e as Error).message, metaPatch: { booking: null } };
  }
}

/** Replies to a follow-up check-in ("1 better / 2 same / 3 worse"). */
export async function followupReply(text: string, meta: Record<string, any> | undefined): Promise<{ outcome: 'better' | 'same' | 'worse'; followupId: string } | null> {
  const id = meta?.followupId as string | undefined;
  if (!id) return null;
  const s = text.trim().toLowerCase();
  let outcome: 'better' | 'same' | 'worse' | null = null;
  if (/^1\b|better|good|fine|improv|நன்றாக|பரவாயில்லை|बेहतर|ठीक|ಉತ್ತಮ|బాగా/.test(s)) outcome = 'better';
  else if (/^3\b|worse|bad|pain|not (good|well|better)|மோசம்|வலி|खराब|बदतर|दर्द|ಕೆಟ್ಟ|నొప్పి/.test(s)) outcome = 'worse';
  else if (/^2\b|same|no change|அப்படியே|वैसा ही|ಹಾಗೆಯೇ|అలాగే/.test(s)) outcome = 'same';
  if (!outcome) return null;
  await ctx.db.query('update followups set status = $2, reply = $3 where id = $1', [id, outcome, text.slice(0, 500)]);
  return { outcome, followupId: id };
}


/** Used by the agent pipeline to route a message to the booking agent. */
export function bookingIntent(text: string): boolean {
  return bookRe.test(text) && !changeRe.test(text);
}

export function changeIntent(text: string): boolean {
  return changeRe.test(text) && /appoint|appt|slot|token|visit|booking|சந்திப்பு|அப்பாய|முன்பதிவு|अपॉइंट|ಅಪಾಯಿ|అపాయి/i.test(text);
}
