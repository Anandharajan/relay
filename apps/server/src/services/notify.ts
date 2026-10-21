import { ctx } from '../ctx.ts';
import { uuid } from '../lib/crypto.ts';
import { publish } from '../lib/events.ts';
import { getOrg, type Org } from './orgs.ts';
import { formatWhen } from './visits.ts';

/**
 * Descriptive notifications for doctors and staff. Each one says who, what happened, what the
 * agents already did, and the next step — so it can be acted on from the notification alone.
 * Stored per user (they survive being offline) and pushed live on `user:<id>`.
 */

export type NoticeKind = 'report' | 'booking' | 'clinical_question' | 'emergency';
export interface Fact { label: string; value: string }
export interface Notice {
  kind: NoticeKind;
  severity: 'info' | 'attention' | 'urgent';
  title: string;
  body: string;
  facts: Fact[];
  link: string;
}

export async function deliver(orgId: string, userIds: string[], n: Notice): Promise<void> {
  for (const userId of new Set(userIds)) {
    const id = uuid();
    await ctx.db.query(
      `insert into notifications (id, org_id, user_id, kind, severity, title, body, facts, link) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [id, orgId, userId, n.kind, n.severity, n.title.slice(0, 200), n.body.slice(0, 1000), n.facts, n.link],
    );
    publish(`user:${userId}`, 'notify', { id, ...n, at: new Date().toISOString() });
  }
}

/** Owners and admins: the fallback when no doctor is linked, and always for emergencies. */
async function admins(orgId: string): Promise<string[]> {
  const rows = await ctx.db.query<{ user_id: string }>(`select user_id from members where org_id = $1 and role in ('owner', 'admin')`, [orgId]);
  return rows.map((r) => r.user_id);
}

interface PatientSummary {
  id: string;
  name: string;
  age: string | null;
  nextVisit: string | null;
  doctorUserId: string | null;
  doctorName: string | null;
  openFindings: number;
  reports: number;
}

async function patient(org: Org, clientId: string): Promise<PatientSummary | null> {
  const c = await ctx.db.one<{ id: string; name: string; birth_year: number | null; sex: string | null }>('select id, name, birth_year, sex from clients where id = $1 and org_id = $2', [clientId, org.id]);
  if (!c) return null;
  const appt = await ctx.db.one<{ starts_at: Date; token_no: number | null; reason: string; user_id: string | null; staff_name: string }>(
    `select a.starts_at, a.token_no, a.reason, s.user_id, s.name as staff_name from appointments a join staff_members s on s.id = a.staff_id
      where a.client_id = $1 and a.status <> 'cancelled'
      order by (a.starts_at >= now()) desc, case when a.starts_at >= now() then a.starts_at end asc, a.starts_at desc limit 1`,
    [clientId],
  );
  const counts = await ctx.db.one<{ f: number; r: number }>(
    `select (select count(*)::int from findings where client_id = $1 and status = 'open') as f, (select count(*)::int from records where client_id = $1) as r`,
    [clientId],
  );
  const age = c.birth_year ? `${new Date().getFullYear() - c.birth_year}${c.sex ? ` ${c.sex}` : ''}` : null;
  return {
    id: c.id, name: c.name, age,
    nextVisit: appt ? `${formatWhen(appt.starts_at, org)}${appt.token_no ? `, token ${appt.token_no}` : ''}${appt.reason ? ` · ${appt.reason.slice(0, 80)}` : ''}` : null,
    doctorUserId: appt?.user_id ?? null, doctorName: appt?.staff_name ?? null,
    openFindings: counts?.f ?? 0, reports: counts?.r ?? 0,
  };
}

const who = (p: PatientSummary) => `${p.name}${p.age ? ` (${p.age})` : ''}`;

/** A report finished intake: results that matter, findings raised, and what is waiting. */
export async function noticeReport(orgId: string, recordId: string, doctorUserId: string | null): Promise<void> {
  const org = await getOrg(orgId);
  const rec = await ctx.db.one<{ client_id: string; title: string; status: string }>('select client_id, title, status from records where id = $1', [recordId]);
  if (!org || !rec) return;
  const p = await patient(org, rec.client_id);
  if (!p) return;
  const abnormal = await ctx.db.query<{ label: string; value: number; unit: string; flag: string }>(
    `select label, value, unit, flag from observations where record_id = $1 and flag <> 'normal' order by case when flag like 'critical%' then 0 else 1 end, label limit 4`,
    [recordId],
  );
  const urgent = await ctx.db.one<{ n: number }>(`select count(*)::int as n from findings where client_id = $1 and status = 'open' and severity = 'urgent'`, [rec.client_id]);
  const drafts = await ctx.db.one<{ n: number }>(`select count(*)::int as n from outbox where client_id = $1 and status = 'pending_approval'`, [rec.client_id]);
  const results = rec.status === 'needs_review'
    ? 'Unreadable file (photo or scan): enter the key values manually.'
    : abnormal.length ? abnormal.map((o) => `${o.label} ${o.value} ${o.unit} (${o.flag.replace('_', ' ')})`).join(', ') : 'All recognised values within range.';
  const facts: Fact[] = [
    { label: 'Results', value: results },
    ...(p.nextVisit ? [{ label: 'Visit', value: p.nextVisit }] : []),
    { label: 'Agents did', value: `Intake read the report · findings agent raised ${p.openFindings} open finding${p.openFindings === 1 ? '' : 's'}${drafts?.n ? ` · a patient message is drafted and held for you` : ''}` },
    { label: 'Next', value: drafts?.n ? 'Review the report, then approve or edit the patient message.' : 'Review the report and mark it reviewed.' },
  ];
  await deliver(orgId, doctorUserId ? [doctorUserId] : await admins(orgId), {
    kind: 'report', severity: urgent?.n ? 'urgent' : abnormal.length ? 'attention' : 'info',
    title: `${urgent?.n ? '⚠️ Urgent report' : 'Report to review'}: ${who(p)}`,
    body: `${rec.title}${doctorUserId ? '' : ' · no doctor linked, sent to admins'}`,
    facts, link: `/app/clients/${p.id}`,
  });
}

/** A new booking with this doctor: who, when, why, and what is already on file. */
export async function noticeBooking(org: Org, clientId: string, doctorUserId: string, conversationId: string | null): Promise<void> {
  const p = await patient(org, clientId);
  if (!p) return;
  await deliver(org.id, [doctorUserId], {
    kind: 'booking', severity: 'info',
    title: `New booking: ${who(p)}`,
    body: p.nextVisit ?? '',
    facts: [
      ...(p.nextVisit ? [{ label: 'Visit', value: p.nextVisit }] : []),
      { label: 'On file', value: `${p.reports} report${p.reports === 1 ? '' : 's'} · ${p.openFindings} open finding${p.openFindings === 1 ? '' : 's'}` },
      { label: 'Agents did', value: 'Booking agent offered slots and confirmed · prep instructions and reminder scheduled · conversation assigned to you' },
      { label: 'Next', value: 'Nothing needed now. Reports the patient sends will appear in your review queue.' },
    ],
    link: conversationId ? `/app/inbox/${conversationId}` : `/app/clients/${p.id}`,
  });
}

/** The safety agent held a clinical question or emergency: route it to the patient's doctor. */
export async function noticeEscalation(org: Org, conversationId: string, reason: string, question: string): Promise<void> {
  const emergency = reason === 'emergency' || reason === 'followup_worse';
  if (!emergency && reason !== 'medical_advice') return;
  const client = await ctx.db.one<{ id: string }>('select id from clients where org_id = $1 and conversation_id = $2', [org.id, conversationId]);
  const p = client ? await patient(org, client.id) : null;
  const name = p ? who(p) : 'A chat visitor';
  const to = [...(p?.doctorUserId ? [p.doctorUserId] : []), ...(emergency || !p?.doctorUserId ? await admins(org.id) : [])];
  await deliver(org.id, to, {
    kind: emergency ? 'emergency' : 'clinical_question', severity: emergency ? 'urgent' : 'attention',
    title: emergency ? `🚨 Possible emergency: ${name}` : `Clinical question: ${name}`,
    body: `“${question.slice(0, 240)}”`,
    facts: [
      ...(p?.nextVisit ? [{ label: 'Visit', value: p.nextVisit }] : []),
      { label: 'Agents did', value: emergency ? `Safety agent told the patient to call ${org.settings.emergencyNumber || '108'} now; no AI advice given` : 'Safety agent held it: no medical advice given; the patient was told a clinician will reply' },
      { label: 'Next', value: emergency ? 'Call the patient now.' : 'Reply from the conversation (your reply goes to the patient; notes stay internal).' },
    ],
    link: `/app/inbox/${conversationId}`,
  });
}

export async function listNotifications(orgId: string, userId: string) {
  const items = await ctx.db.query(`select * from notifications where org_id = $1 and user_id = $2 order by created_at desc limit 50`, [orgId, userId]);
  const unread = await ctx.db.one<{ n: number }>(`select count(*)::int as n from notifications where org_id = $1 and user_id = $2 and read_at is null`, [orgId, userId]);
  return { items, unread: unread?.n ?? 0 };
}

export async function markRead(orgId: string, userId: string, ids?: string[]): Promise<void> {
  if (ids?.length) {
    await ctx.db.query(`update notifications set read_at = now() where org_id = $1 and user_id = $2 and read_at is null and id::text in (select jsonb_array_elements_text($3::jsonb))`, [orgId, userId, ids]);
  } else {
    await ctx.db.query(`update notifications set read_at = now() where org_id = $1 and user_id = $2 and read_at is null`, [orgId, userId]);
  }
}
