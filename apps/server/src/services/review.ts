import { ctx } from '../ctx.ts';
import { publish } from '../lib/events.ts';
import type { Role } from '../http.ts';
import { audit } from './orgs.ts';

/**
 * Clinical routing: who is responsible for a patient, the queue of reports awaiting review,
 * and who may sign off clinical work. Kept separate from intake (records.ts) and booking (visits.ts).
 */

export interface Responsible {
  staffId: string;
  staffName: string;
  userId: string | null;
}

export interface ReviewItem {
  id: string;
  title: string;
  kind: string;
  status: string;
  created_at: string;
  client_id: string;
  client_name: string;
  staff_id: string | null;
  staff_name: string | null;
  staff_user_id: string | null;
  open_findings: number;
  urgent_findings: number;
}

/** The doctor for a patient: the next upcoming appointment, else the most recent one. */
export async function responsibleFor(orgId: string, clientId: string): Promise<Responsible | null> {
  const row = await ctx.db.one<{ id: string; name: string; user_id: string | null }>(
    `select s.id, s.name, s.user_id from appointments a join staff_members s on s.id = a.staff_id
      where a.org_id = $1 and a.client_id = $2 and a.status <> 'cancelled'
      order by (a.starts_at >= now()) desc,
               case when a.starts_at >= now() then a.starts_at end asc,
               a.starts_at desc
      limit 1`,
    [orgId, clientId],
  );
  return row ? { staffId: row.id, staffName: row.name, userId: row.user_id } : null;
}

/** Send a personal notification to one staff login (shown in their dashboard). */
export function notifyUser(userId: string, data: { title: string; body?: string; link?: string }) {
  publish(`user:${userId}`, 'notify', { ...data, at: new Date().toISOString() });
}

/** Attach a processed report to the responsible doctor and tell them. */
export async function routeRecord(orgId: string, record: { id: string; client_id: string; title: string }): Promise<Responsible | null> {
  const who = await responsibleFor(orgId, record.client_id);
  await ctx.db.query('update records set assigned_staff_id = $2 where id = $1', [record.id, who?.staffId ?? null]);
  if (who?.userId) notifyUser(who.userId, { title: 'Report to review', body: record.title, link: '/app/approvals' });
  publish(`org:${orgId}`, 'reviews.updated', { recordId: record.id });
  return who;
}

/** Reports nobody has reviewed yet, most urgent first. `userId` limits it to that doctor's patients. */
export async function awaitingReview(orgId: string, opts: { userId?: string } = {}): Promise<ReviewItem[]> {
  return ctx.db.query<ReviewItem>(
    `select r.id, r.title, r.kind, r.status, r.created_at, r.client_id, c.name as client_name,
            s.id as staff_id, s.name as staff_name, s.user_id as staff_user_id,
            (select count(*)::int from findings f where f.client_id = r.client_id and f.status = 'open') as open_findings,
            (select count(*)::int from findings f where f.client_id = r.client_id and f.status = 'open' and f.severity = 'urgent') as urgent_findings
       from records r
       join clients c on c.id = r.client_id
       left join staff_members s on s.id = r.assigned_staff_id
      where r.org_id = $1 and r.reviewed_at is null and r.status in ('processed', 'needs_review')
        and ($2::uuid is null or s.user_id = $2::uuid)
      order by urgent_findings desc, r.status = 'needs_review' desc, r.created_at asc
      limit 200`,
    [orgId, opts.userId ?? null],
  );
}

export async function reviewCount(orgId: string, userId?: string): Promise<number> {
  const row = await ctx.db.one<{ n: number }>(
    `select count(*)::int as n from records r left join staff_members s on s.id = r.assigned_staff_id
      where r.org_id = $1 and r.reviewed_at is null and r.status in ('processed', 'needs_review') and ($2::uuid is null or s.user_id = $2::uuid)`,
    [orgId, userId ?? null],
  );
  return row?.n ?? 0;
}

/**
 * Clinical sign-off is allowed for owners/admins, and for the doctor linked to the patient
 * (through the report's assigned doctor or any of the patient's appointments).
 */
export async function canSignOff(orgId: string, user: { id: string; role: Role }, clientId: string): Promise<boolean> {
  if (user.role === 'owner' || user.role === 'admin') return true;
  const row = await ctx.db.one(
    `select 1 from staff_members s
      where s.org_id = $1 and s.user_id = $2 and (
        exists (select 1 from appointments a where a.staff_id = s.id and a.client_id = $3)
        or exists (select 1 from records r where r.assigned_staff_id = s.id and r.client_id = $3))
      limit 1`,
    [orgId, user.id, clientId],
  );
  return Boolean(row);
}

export async function markReviewed(orgId: string, recordId: string, userId: string): Promise<boolean> {
  const rows = await ctx.db.query<{ id: string }>(
    `update records set reviewed_by = $3, reviewed_at = now() where id = $1 and org_id = $2 and reviewed_at is null returning id`,
    [recordId, orgId, userId],
  );
  if (!rows.length) return false;
  await audit(orgId, userId, 'record.reviewed', recordId, {});
  publish(`org:${orgId}`, 'reviews.updated', { recordId });
  return true;
}

/** Hand a patient's conversation to the booked doctor's login, if one is linked. */
export async function assignConversationToStaff(orgId: string, conversationId: string, staffId: string): Promise<string | null> {
  const s = await ctx.db.one<{ user_id: string | null; name: string }>('select user_id, name from staff_members where id = $1 and org_id = $2', [staffId, orgId]);
  if (!s?.user_id) return null;
  await ctx.db.query('update conversations set assigned_to = $3 where id = $1 and org_id = $2', [conversationId, orgId, s.user_id]);
  publish(`org:${orgId}`, 'conversation.updated', { id: conversationId });
  notifyUser(s.user_id, { title: 'New patient booked with you', link: `/app/inbox?c=${conversationId}` });
  return s.user_id;
}
