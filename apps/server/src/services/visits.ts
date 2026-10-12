import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { token, uuid } from '../lib/crypto.ts';
import { publish } from '../lib/events.ts';
import { audit, getOrg, hasAddon, type Org } from './orgs.ts';
import { addMessage, createConversation, getConversation } from './conversations.ts';
import { recordRun } from './agents.ts';

/**
 * Visits: the horizontal scheduling layer (clinics, hospitals, salons, service centres, coaching …).
 * Staff → free slots → appointments with a token and a visit code → reminders, prep instructions,
 * check-in, a live queue with waiting-time estimates, and follow-ups.
 */

export interface Staff {
  id: string;
  org_id: string;
  name: string;
  specialty: string;
  languages: string[];
  avg_minutes: number;
  schedule: { days: number[]; start: string; end: string };
  active: boolean;
}

export interface Client {
  id: string;
  org_id: string;
  name: string;
  phone: string | null;
  lang: string;
  birth_year: number | null;
  sex: string | null;
  notes: string;
  conversation_id: string | null;
}

export interface Appointment {
  id: string;
  org_id: string;
  client_id: string;
  staff_id: string;
  starts_at: Date;
  status: 'booked' | 'checked_in' | 'in_progress' | 'done' | 'cancelled' | 'no_show';
  reason: string;
  channel: string;
  token_no: number | null;
  code: string;
  checked_in_at: Date | null;
  checkin_method: string | null;
  started_at: Date | null;
  ended_at: Date | null;
  last_eta_min: number | null;
}

// ── time helpers (fixed UTC offset per workspace; India has no DST) ─────────────────────────────
const MIN = 60_000;
export function localParts(d: Date, offsetMin: number) {
  const x = new Date(d.getTime() + offsetMin * MIN);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), dow: x.getUTCDay(), hh: x.getUTCHours(), mm: x.getUTCMinutes() };
}
export function fromLocal(y: number, m: number, d: number, hh: number, mm: number, offsetMin: number): Date {
  return new Date(Date.UTC(y, m, d, hh, mm) - offsetMin * MIN);
}
export function dayBounds(d: Date, offsetMin: number) {
  const p = localParts(d, offsetMin);
  const start = fromLocal(p.y, p.m, p.d, 0, 0, offsetMin);
  return { start, end: new Date(start.getTime() + 24 * 60 * MIN) };
}

const localeOf: Record<string, string> = { en: 'en-IN', ta: 'ta-IN', hi: 'hi-IN', kn: 'kn-IN', te: 'te-IN', ml: 'ml-IN', bn: 'bn-IN' };
export function formatWhen(d: Date, org: Org, lang = 'en'): string {
  const shifted = new Date(new Date(d).getTime() + org.settings.utcOffsetMin * MIN);
  return shifted.toLocaleString(localeOf[lang] ?? 'en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function visitLink(code: string) {
  return `${config.publicUrl}/v/${code}`;
}

// ── staff and slots ─────────────────────────────────────────────────────────────────────────────
export async function listStaff(orgId: string, activeOnly = true): Promise<Staff[]> {
  return ctx.db.query<Staff>(`select * from staff_members where org_id = $1 ${activeOnly ? 'and active' : ''} order by name`, [orgId]);
}

export async function freeSlots(org: Org, staff: Staff, count = 6, from = new Date()): Promise<Date[]> {
  const off = org.settings.utcOffsetMin;
  const earliest = new Date(from.getTime() + 30 * MIN);
  const horizon = new Date(from.getTime() + 8 * 24 * 60 * MIN);
  const taken = new Set(
    (
      await ctx.db.query<{ starts_at: Date }>(
        `select starts_at from appointments where staff_id = $1 and status not in ('cancelled') and starts_at between $2 and $3`,
        [staff.id, from, horizon],
      )
    ).map((r) => new Date(r.starts_at).getTime()),
  );
  const [sh, sm] = staff.schedule.start.split(':').map(Number) as [number, number];
  const [eh, em] = staff.schedule.end.split(':').map(Number) as [number, number];
  // Book on a clean grid (15, 30, 45 … minutes) even if the average consultation is, say, 18 minutes.
  const step = Math.max(15, Math.ceil(staff.avg_minutes / 15) * 15);
  const out: Date[] = [];
  for (let day = 0; day < 8 && out.length < count; day++) {
    const p = localParts(new Date(from.getTime() + day * 24 * 60 * MIN), off);
    if (!staff.schedule.days.includes(p.dow)) continue;
    // Spread the offer: at most 3 slots per day so the patient sees more than one day.
    let perDay = 0;
    for (let t = fromLocal(p.y, p.m, p.d, sh, sm, off); t < fromLocal(p.y, p.m, p.d, eh, em, off) && perDay < 3; t = new Date(t.getTime() + step * MIN)) {
      if (t < earliest || taken.has(t.getTime())) continue;
      out.push(t);
      perDay++;
      t = new Date(t.getTime() + step * 2 * MIN); // skip ahead so offered slots are spread out
      if (out.length >= count) break;
    }
  }
  return out;
}

// ── clients ─────────────────────────────────────────────────────────────────────────────────────
export async function findOrCreateClient(org: Org, input: { name: string; phone?: string | null; lang?: string; conversationId?: string | null }): Promise<Client> {
  const phone = input.phone ? normalizePhone(input.phone) : null;
  let existing = phone ? await ctx.db.one<Client>('select * from clients where org_id = $1 and phone = $2', [org.id, phone]) : undefined;
  if (!existing && input.conversationId) existing = await ctx.db.one<Client>('select * from clients where org_id = $1 and conversation_id = $2', [org.id, input.conversationId]);
  if (existing) {
    if (input.conversationId && !existing.conversation_id) await ctx.db.query('update clients set conversation_id = $2 where id = $1', [existing.id, input.conversationId]);
    return (await ctx.db.one<Client>('select * from clients where id = $1', [existing.id]))!;
  }
  const id = uuid();
  await ctx.db.query(`insert into clients (id, org_id, name, phone, lang, conversation_id, consent_at) values ($1, $2, $3, $4, $5, $6, now())`, [
    id, org.id, input.name.trim().slice(0, 120), phone, input.lang ?? 'en', input.conversationId ?? null,
  ]);
  return (await ctx.db.one<Client>('select * from clients where id = $1', [id]))!;
}

export function normalizePhone(p: string): string {
  const d = p.replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
}

// ── booking ─────────────────────────────────────────────────────────────────────────────────────
export async function bookAppointment(org: Org, input: { clientId: string; staffId: string; startsAt: Date; reason?: string; channel?: string; by?: string }): Promise<Appointment> {
  const staff = await ctx.db.one<Staff>('select * from staff_members where id = $1 and org_id = $2', [input.staffId, org.id]);
  if (!staff) throw new Error('Unknown staff member');
  const clash = await ctx.db.one(`select 1 from appointments where staff_id = $1 and starts_at = $2 and status <> 'cancelled'`, [staff.id, input.startsAt]);
  if (clash) throw new Error('That slot was just taken. Please pick another.');
  const { start, end } = dayBounds(input.startsAt, org.settings.utcOffsetMin);
  const n = await ctx.db.one<{ c: number }>(`select count(*)::int as c from appointments where staff_id = $1 and starts_at >= $2 and starts_at < $3`, [staff.id, start, end]);
  const id = uuid();
  const code = token(6).replace(/[^A-Za-z0-9]/g, 'x').toUpperCase();
  await ctx.db.query(
    `insert into appointments (id, org_id, client_id, staff_id, starts_at, reason, channel, token_no, code) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, org.id, input.clientId, staff.id, input.startsAt, (input.reason ?? '').slice(0, 300), input.channel ?? 'web', (n?.c ?? 0) + 1, code],
  );
  const appt = (await getAppointment(org.id, id))!;
  await audit(org.id, input.by ?? 'ai', 'appointment.booked', id, { staff: staff.name, startsAt: input.startsAt });
  await scheduleForAppointment(org, appt, staff);
  publish(`org:${org.id}`, 'visits.updated', { appointmentId: id });
  return appt;
}

export async function getAppointment(orgId: string, id: string) {
  return ctx.db.one<Appointment>('select * from appointments where id = $1 and org_id = $2', [id, orgId]);
}

export async function getAppointmentByCode(code: string) {
  return ctx.db.one<Appointment>('select * from appointments where code = $1', [code.toUpperCase()]);
}

/** Reminders (24 h, 2 h), matching doctor-approved prep instructions, and an optional reminder call. */
async function scheduleForAppointment(org: Org, appt: Appointment, staff: Staff) {
  const client = (await ctx.db.one<Client>('select * from clients where id = $1', [appt.client_id]))!;
  const when = new Date(appt.starts_at);
  const now = Date.now();
  const lang = client.lang;
  const label = staffLabel(org);
  const r24 = new Date(when.getTime() - 24 * 60 * MIN);
  const r2 = new Date(when.getTime() - 2 * 60 * MIN);
  const remind = (h: string) =>
    lang === 'ta'
      ? `நினைவூட்டல்: ${staff.name} அவர்களுடன் உங்கள் சந்திப்பு ${formatWhen(when, org, lang)} (${h}). டோக்கன் ${appt.token_no}. வந்ததும் செக்-இன் செய்யவும்: ${visitLink(appt.code)}`
      : `Reminder: your appointment with ${staff.name} is on ${formatWhen(when, org, 'en')} (${h}). Token ${appt.token_no}. Check in when you arrive: ${visitLink(appt.code)}`;
  if (r24.getTime() > now) await queueMessage(org, client.id, 'reminder', remind(lang === 'ta' ? 'நாளை' : 'tomorrow'), { appointmentId: appt.id, sendAt: r24 });
  if (r2.getTime() > now) await queueMessage(org, client.id, 'reminder', remind(lang === 'ta' ? 'இன்னும் 2 மணி நேரம்' : 'in 2 hours'), { appointmentId: appt.id, sendAt: r2 });

  // Prep protocols: only text a doctor/admin wrote and approved, matched on staff, specialty or reason.
  const protocols = await ctx.db.query<{ id: string; title: string; keywords: string[]; staff_id: string | null; instructions: string; days_before: number }>(
    'select * from prep_protocols where org_id = $1 and approved_by is not null',
    [org.id],
  );
  const hay = `${appt.reason} ${staff.specialty} ${staff.name}`.toLowerCase();
  for (const p of protocols) {
    const matches = p.staff_id ? p.staff_id === staff.id : p.keywords.some((k) => k && hay.includes(k.toLowerCase()));
    if (!matches) continue;
    // Never before the booking confirmation itself: at least a few seconds after booking.
    const sendAt = new Date(Math.max(now + 5000, when.getTime() - p.days_before * 24 * 60 * MIN));
    await queueMessage(org, client.id, 'prep', `📋 ${p.title}\n${p.instructions}`, { appointmentId: appt.id, sendAt, meta: { protocolId: p.id, approvedBy: 'protocol' } });
  }
  if (await hasAddon(org, 'telecalling')) {
    const callAt = new Date(when.getTime() - 26 * 60 * MIN);
    if (callAt.getTime() > now) await ctx.db.query(`insert into jobs (id, type, payload, run_at) values ($1, 'voice_call', $2::jsonb, $3)`, [uuid(), { orgId: org.id, appointmentId: appt.id, purpose: 'reminder' }, callAt]);
  }
  void label;
}

export function staffLabel(org: Org) {
  return org.settings.vertical === 'healthcare' ? 'doctor' : 'staff';
}

// ── outbox: every proactive message, with an approval gate ──────────────────────────────────────
export async function queueMessage(
  org: Org,
  clientId: string,
  kind: string,
  body: string,
  opts: { appointmentId?: string; sendAt?: Date; requireApproval?: boolean; meta?: object } = {},
) {
  const id = uuid();
  await ctx.db.query(
    `insert into outbox (id, org_id, client_id, appointment_id, kind, body, status, send_at, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [id, org.id, clientId, opts.appointmentId ?? null, kind, body, opts.requireApproval ? 'pending_approval' : 'scheduled', opts.sendAt ?? new Date(), opts.meta ?? {}],
  );
  if (opts.requireApproval) publish(`org:${org.id}`, 'attention', { reason: 'message_approval', outboxId: id });
  else if (!opts.sendAt || opts.sendAt.getTime() <= Date.now() + 1000) await deliverDue(id);
  return id;
}

export async function approveMessage(orgId: string, outboxId: string, userId: string, body?: string) {
  await ctx.db.query(
    `update outbox set status = 'scheduled', approved_by = $3, body = coalesce($4, body), send_at = least(send_at, now()) where id = $1 and org_id = $2 and status = 'pending_approval'`,
    [outboxId, orgId, userId, body ?? null],
  );
  await deliverDue(outboxId);
}

/** Deliver due messages into the client's conversation (web chat, WhatsApp …). */
export async function deliverDue(onlyId?: string) {
  const rows = await ctx.db.query<{ id: string; org_id: string; client_id: string; kind: string; body: string }>(
    `select id, org_id, client_id, kind, body from outbox where status = 'scheduled' and send_at <= now() ${onlyId ? 'and id = $1' : ''} order by send_at limit 200`,
    onlyId ? [onlyId] : [],
  );
  for (const r of rows) {
    try {
      const org = (await getOrg(r.org_id))!;
      const client = (await ctx.db.one<Client>('select * from clients where id = $1', [r.client_id]))!;
      let conv = client.conversation_id ? await getConversation(org.id, client.conversation_id) : undefined;
      if (!conv) {
        const channel = client.phone && org.secrets.whatsappToken ? 'whatsapp' : 'web';
        conv = await createConversation(org, channel === 'whatsapp' ? client.phone! : `client_${client.id.slice(0, 8)}`, channel, { name: client.name, contact: client.phone ?? undefined });
        await ctx.db.query('update clients set conversation_id = $2 where id = $1', [client.id, conv.id]);
      }
      await addMessage(conv, 'ai', r.body, { meta: { outboxId: r.id, kind: r.kind, proactive: true } });
      await ctx.db.query(`update outbox set status = 'sent', sent_at = now() where id = $1`, [r.id]);
      publish(`client:${r.client_id}`, 'message', { kind: r.kind, body: r.body });
    } catch (e) {
      await ctx.db.query(`update outbox set status = 'failed', error = $2 where id = $1`, [r.id, (e as Error).message.slice(0, 300)]);
      await recordRun({ orgId: r.org_id, agent: 'channel', trigger: `outbox:${r.kind}`, clientId: r.client_id, status: 'failed', outcome: (e as Error).message.slice(0, 200), tags: ['outbox.delivery_failed'] });
    }
  }
}

// ── queue and live waiting time ─────────────────────────────────────────────────────────────────
export async function averageMinutes(staff: Staff): Promise<number> {
  const r = await ctx.db.one<{ avg: number | null; n: number }>(
    `select avg(extract(epoch from (ended_at - started_at)) / 60)::float as avg, count(*)::int as n
       from (select started_at, ended_at from appointments where staff_id = $1 and status = 'done' and started_at is not null and ended_at is not null order by ended_at desc limit 20) x`,
    [staff.id],
  );
  // Blend observed pace with the configured average until there is enough history.
  if (!r?.avg || r.n < 3) return staff.avg_minutes;
  const w = Math.min(1, r.n / 10);
  return Math.max(3, Math.round(w * r.avg + (1 - w) * staff.avg_minutes));
}

export interface QueueEntry {
  appointment: Appointment;
  client: { id: string; name: string };
  position: number;
  ahead: number;
  etaMin: number;
}

/** Today's queue for one staff member: in progress first, then checked-in visitors by token. */
export async function queueFor(org: Org, staffId: string, at = new Date()) {
  const staff = (await ctx.db.one<Staff>('select * from staff_members where id = $1 and org_id = $2', [staffId, org.id]))!;
  const { start, end } = dayBounds(at, org.settings.utcOffsetMin);
  const appts = await ctx.db.query<Appointment & { client_name: string }>(
    `select a.*, c.name as client_name from appointments a join clients c on c.id = a.client_id
      where a.staff_id = $1 and a.starts_at >= $2 and a.starts_at < $3 order by a.token_no`,
    [staffId, start, end],
  );
  const avg = await averageMinutes(staff);
  const current = appts.find((a) => a.status === 'in_progress');
  const remainingCurrent = current?.started_at ? Math.max(2, avg - Math.round((at.getTime() - new Date(current.started_at).getTime()) / MIN)) : 0;
  const waiting = appts.filter((a) => a.status === 'checked_in');
  const entries: QueueEntry[] = waiting.map((a, i) => {
    const queueEta = remainingCurrent + i * avg;
    // Nobody is seen before their booked time.
    const untilSlot = Math.max(0, Math.round((new Date(a.starts_at).getTime() - at.getTime()) / MIN));
    return { appointment: a, client: { id: a.client_id, name: a.client_name }, position: i + 1, ahead: i + (current ? 1 : 0), etaMin: Math.max(queueEta, untilSlot) };
  });
  return {
    staff,
    avgMinutes: avg,
    current: current ? { appointment: current, client: { id: current.client_id, name: current.client_name } } : null,
    waiting: entries,
    upcoming: appts.filter((a) => a.status === 'booked').map((a) => ({ appointment: a, client: { id: a.client_id, name: a.client_name } })),
    done: appts.filter((a) => ['done', 'no_show', 'cancelled'].includes(a.status)).map((a) => ({ appointment: a, client: { id: a.client_id, name: a.client_name } })),
  };
}

export async function etaFor(org: Org, appt: Appointment) {
  const q = await queueFor(org, appt.staff_id);
  const e = q.waiting.find((w) => w.appointment.id === appt.id);
  if (e) return { ahead: e.ahead, etaMin: e.etaMin, status: appt.status, avgMinutes: q.avgMinutes };
  const untilSlot = Math.max(0, Math.round((new Date(appt.starts_at).getTime() - Date.now()) / MIN));
  return { ahead: q.waiting.length + (q.current ? 1 : 0), etaMin: Math.max(untilSlot, q.waiting.length * q.avgMinutes), status: appt.status, avgMinutes: q.avgMinutes };
}

/** After any queue change: push a new estimate to waiting visitors whose wait moved by ≥ 10 minutes. */
export async function refreshEtas(org: Org, staffId: string) {
  const q = await queueFor(org, staffId);
  for (const w of q.waiting) {
    const last = w.appointment.last_eta_min;
    await ctx.db.query('update appointments set last_eta_min = $2 where id = $1', [w.appointment.id, w.etaMin]);
    publish(`visit:${w.appointment.code}`, 'eta', { ahead: w.ahead, etaMin: w.etaMin });
    if (last !== null && Math.abs(last - w.etaMin) >= 10) {
      const client = await ctx.db.one<Client>('select * from clients where id = $1', [w.client.id]);
      const body =
        client?.lang === 'ta'
          ? `புதுப்பிப்பு: டோக்கன் ${w.appointment.token_no}, உங்களுக்கு முன் ${w.ahead} பேர். காத்திருப்பு சுமார் ${w.etaMin} நிமிடங்கள்.`
          : `Update: token ${w.appointment.token_no}, ${w.ahead} ahead of you. Estimated wait now about ${w.etaMin} minutes.`;
      await queueMessage(org, w.client.id, 'eta', body, { appointmentId: w.appointment.id });
    }
  }
  publish(`org:${org.id}`, 'visits.updated', { staffId });
}

export async function checkIn(org: Org, appt: Appointment, method: string) {
  if (!['booked', 'checked_in'].includes(appt.status)) throw new Error(`This visit is ${appt.status.replace('_', ' ')}`);
  const { start, end } = dayBounds(new Date(), org.settings.utcOffsetMin);
  const at = new Date(appt.starts_at);
  if (at < start || at >= end) throw new Error('Check-in opens on the day of your appointment');
  if (appt.status === 'booked') {
    await ctx.db.query(`update appointments set status = 'checked_in', checked_in_at = now(), checkin_method = $2 where id = $1`, [appt.id, method]);
    await audit(org.id, `checkin:${method}`, 'appointment.checked_in', appt.id, {});
  }
  const fresh = (await getAppointment(org.id, appt.id))!;
  const eta = await etaFor(org, fresh);
  await ctx.db.query('update appointments set last_eta_min = $2 where id = $1', [appt.id, eta.etaMin]);
  if (appt.status === 'booked' && method !== 'whatsapp') {
    const client = await ctx.db.one<Client>('select * from clients where id = $1', [appt.client_id]);
    const body =
      client?.lang === 'ta'
        ? `செக்-இன் ஆகிவிட்டது. டோக்கன் ${fresh.token_no}, உங்களுக்கு முன் ${eta.ahead} பேர். காத்திருப்பு சுமார் ${eta.etaMin} நிமிடங்கள்.`
        : `You're checked in. Token ${fresh.token_no}, ${eta.ahead} ahead of you. Estimated wait: about ${eta.etaMin} minutes.`;
    await queueMessage(org, appt.client_id, 'eta', body, { appointmentId: appt.id });
  }
  await refreshEtas(org, appt.staff_id);
  return { appointment: fresh, ...eta };
}

export async function startVisit(org: Org, appt: Appointment) {
  await ctx.db.query(`update appointments set status = 'done', ended_at = coalesce(ended_at, now()) where staff_id = $1 and status = 'in_progress' and id <> $2`, [appt.staff_id, appt.id]);
  await ctx.db.query(`update appointments set status = 'in_progress', started_at = now(), checked_in_at = coalesce(checked_in_at, now()) where id = $1`, [appt.id]);
  await refreshEtas(org, appt.staff_id);
}

export async function finishVisit(org: Org, appt: Appointment, opts: { followupDays?: number | null; checkinDays?: number | null; by?: string } = {}) {
  await ctx.db.query(`update appointments set status = 'done', ended_at = now(), started_at = coalesce(started_at, now() - interval '10 minutes') where id = $1`, [appt.id]);
  if (opts.checkinDays) {
    await ctx.db.query(`insert into followups (id, org_id, client_id, appointment_id, kind, due_at) values ($1, $2, $3, $4, 'checkin', now() + ($5 || ' days')::interval)`, [
      uuid(), org.id, appt.client_id, appt.id, String(opts.checkinDays),
    ]);
  }
  if (opts.followupDays) {
    await ctx.db.query(`insert into followups (id, org_id, client_id, appointment_id, kind, due_at) values ($1, $2, $3, $4, 'review', now() + ($5 || ' days')::interval)`, [
      uuid(), org.id, appt.client_id, appt.id, String(Math.max(1, opts.followupDays - 1)),
    ]);
  }
  await audit(org.id, opts.by ?? 'staff', 'appointment.done', appt.id, { followupDays: opts.followupDays ?? null });
  await refreshEtas(org, appt.staff_id);
}

export async function setAppointmentStatus(org: Org, appt: Appointment, status: 'cancelled' | 'no_show', by: string) {
  await ctx.db.query('update appointments set status = $2 where id = $1', [appt.id, status]);
  await ctx.db.query(`update outbox set status = 'cancelled' where appointment_id = $1 and status in ('scheduled', 'pending_approval') and kind in ('reminder', 'prep')`, [appt.id]);
  await audit(org.id, by, `appointment.${status}`, appt.id, {});
  if (status === 'no_show') {
    const client = await ctx.db.one<Client>('select * from clients where id = $1', [appt.client_id]);
    const body =
      client?.lang === 'ta'
        ? 'இன்று உங்கள் சந்திப்பைத் தவறவிட்டீர்கள். புதிய நேரத்தை முன்பதிவு செய்ய "appointment" என்று பதிலளிக்கவும்.'
        : 'We missed you today. Reply "appointment" to book a new time; it only takes a minute.';
    await queueMessage(org, appt.client_id, 'rebook', body, { appointmentId: appt.id });
  }
  await refreshEtas(org, appt.staff_id);
}
