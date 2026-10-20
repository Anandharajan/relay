import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { encrypt, sha1, token, uuid } from '../lib/crypto.ts';
import { getBlobStore } from '../adapters/blob.ts';
import { body, fail, requireOrg, requireRole, requireUser, type AppEnv } from '../http.ts';
import { audit, hasAddon, planOf } from '../services/orgs.ts';
import {
  approveMessage, bookAppointment, checkIn, dayBounds, finishVisit, findOrCreateClient, freeSlots, getAppointment, listStaff, queueFor, queueMessage,
  setAppointmentStatus, startVisit, type Client, type Staff,
} from '../services/visits.ts';
import { brief, flagFor, runFindings, TESTS } from '../services/records.ts';
import { handleDigit, placeCall } from '../services/calls.ts';
import { awaitingReview, canSignOff, markReviewed, reviewCount } from '../services/review.ts';
import { enqueue } from '../jobs/runner.ts';

/** Dashboard API for the visits layer and the healthcare pack. */
export const visits = new Hono<AppEnv>();
visits.use(requireUser, requireOrg);

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const staffSchema = z.object({
  name: z.string().min(2).max(120),
  specialty: z.string().max(120).default(''),
  languages: z.array(z.string().max(20)).max(10).default([]),
  avgMinutes: z.number().int().min(3).max(240).default(15),
  schedule: z.object({ days: z.array(z.number().int().min(0).max(6)).min(1), start: hhmm, end: hhmm }),
  active: z.boolean().default(true),
  userId: z.string().uuid().nullable().optional(),
});

/** A staff calendar may only be linked to a login that belongs to this workspace. */
async function assertMember(orgId: string, userId: string | null | undefined) {
  if (!userId) return;
  const m = await ctx.db.one('select 1 from members where org_id = $1 and user_id = $2', [orgId, userId]);
  if (!m) fail(400, 'That login is not a member of this workspace');
}

/** Owners/admins, or the doctor linked to this patient, may sign off clinical work. */
async function requireSignOff(c: any, clientId: string) {
  if (!(await canSignOff(c.get('org').id, { id: c.get('user').id, role: c.get('role') }, clientId))) fail(403, 'Only an admin or this patient’s doctor can sign this off');
}

// ── staff ────────────────────────────────────────────────────────────────────
visits.get('/staff', async (c) => c.json(await listStaff(c.get('org').id, false)));

visits.post('/staff', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const b = await body(c, staffSchema);
  const count = await ctx.db.one<{ c: number }>('select count(*)::int as c from staff_members where org_id = $1 and active', [org.id]);
  if (config.mode === 'cloud' && (count?.c ?? 0) >= planOf(org).staff) fail(403, `Your plan includes ${planOf(org).staff} staff calendars. Upgrade to add more.`);
  await assertMember(org.id, b.userId);
  const id = uuid();
  await ctx.db.query(
    `insert into staff_members (id, org_id, name, specialty, languages, avg_minutes, schedule, active, user_id) values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9)`,
    [id, org.id, b.name, b.specialty, b.languages, b.avgMinutes, b.schedule, b.active, b.userId ?? null],
  );
  await audit(org.id, c.get('user').id, 'staff.created', id, { name: b.name });
  return c.json({ id });
});

visits.patch('/staff/:id', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const b = await body(c, staffSchema.partial());
  const s = await ctx.db.one<Staff>('select * from staff_members where id = $1 and org_id = $2', [c.req.param('id'), org.id]);
  if (!s) fail(404, 'Not found');
  await assertMember(org.id, b.userId);
  await ctx.db.query(`update staff_members set name = $3, specialty = $4, languages = $5::jsonb, avg_minutes = $6, schedule = $7::jsonb, active = $8, user_id = $9 where id = $1 and org_id = $2`, [
    s.id, org.id, b.name ?? s.name, b.specialty ?? s.specialty, b.languages ?? s.languages, b.avgMinutes ?? s.avg_minutes, b.schedule ?? s.schedule, b.active ?? s.active,
    b.userId === undefined ? s.user_id : b.userId,
  ]);
  return c.json({ ok: true });
});

visits.get('/slots', async (c) => {
  const org = c.get('org');
  const s = await ctx.db.one<Staff>('select * from staff_members where id = $1 and org_id = $2', [c.req.query('staffId'), org.id]);
  if (!s) fail(404, 'Unknown staff member');
  return c.json((await freeSlots(org, s, 12)).map((d) => d.toISOString()));
});

// ── clients ──────────────────────────────────────────────────────────────────
visits.get('/clients', async (c) => {
  const org = c.get('org');
  const q = (c.req.query('q') ?? '').trim();
  const rows = await ctx.db.query(
    `select c.id, c.name, c.phone, c.lang, c.birth_year, c.sex, c.created_at,
            (select count(*) from findings f where f.client_id = c.id and f.status = 'open')::int as open_findings,
            (select max(severity) from findings f where f.client_id = c.id and f.status = 'open' and f.severity = 'urgent') as urgent,
            (select min(starts_at) from appointments a where a.client_id = c.id and a.starts_at > now() - interval '3 hours' and a.status in ('booked','checked_in','in_progress')) as next_visit
       from clients c where c.org_id = $1 and ($2 = '' or c.name ilike '%' || $2 || '%' or c.phone like '%' || $2 || '%')
      order by urgent nulls last, next_visit nulls last, c.created_at desc limit 200`,
    [org.id, q],
  );
  return c.json(rows);
});

const clientSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().max(20).optional().nullable(),
  lang: z.string().max(5).default('en'),
  birthYear: z.number().int().min(1900).max(2100).optional().nullable(),
  sex: z.enum(['F', 'M', 'O']).optional().nullable(),
  notes: z.string().max(2000).optional(),
});

visits.post('/clients', async (c) => {
  const org = c.get('org');
  const b = await body(c, clientSchema);
  const client = await findOrCreateClient(org, { name: b.name, phone: b.phone, lang: b.lang });
  await ctx.db.query('update clients set birth_year = coalesce($2, birth_year), sex = coalesce($3, sex), notes = coalesce($4, notes) where id = $1', [client.id, b.birthYear ?? null, b.sex ?? null, b.notes ?? null]);
  return c.json({ id: client.id });
});

visits.patch('/clients/:id', async (c) => {
  const org = c.get('org');
  const b = await body(c, clientSchema.partial());
  await ctx.db.query(
    `update clients set name = coalesce($3, name), phone = coalesce($4, phone), lang = coalesce($5, lang), birth_year = coalesce($6, birth_year), sex = coalesce($7, sex), notes = coalesce($8, notes) where id = $1 and org_id = $2`,
    [c.req.param('id'), org.id, b.name ?? null, b.phone ?? null, b.lang ?? null, b.birthYear ?? null, b.sex ?? null, b.notes ?? null],
  );
  return c.json({ ok: true });
});

visits.get('/clients/:id', async (c) => {
  const b = await brief(c.get('org'), c.req.param('id'));
  if (!b) fail(404, 'Not found');
  return c.json(b);
});

/** A message written by staff: it is the staff member's own words, so it is sent immediately. */
visits.post('/clients/:id/messages', async (c) => {
  const org = c.get('org');
  const b = await body(c, z.object({ body: z.string().min(1).max(2000) }));
  const client = await ctx.db.one('select id from clients where id = $1 and org_id = $2', [c.req.param('id'), org.id]);
  if (!client) fail(404, 'Not found');
  const id = await queueMessage(org, c.req.param('id'), 'custom', b.body, { meta: { by: c.get('user').name } });
  await ctx.db.query('update outbox set approved_by = $2 where id = $1', [id, c.get('user').name]);
  return c.json({ id });
});

// ── appointments, queue ──────────────────────────────────────────────────────
visits.post('/appointments', async (c) => {
  const org = c.get('org');
  const b = await body(
    c,
    z.object({
      clientId: z.string().uuid().optional(),
      client: clientSchema.optional(),
      staffId: z.string().uuid(),
      startsAt: z.string().datetime(),
      reason: z.string().max(300).optional(),
    }),
  );
  let clientId = b.clientId;
  if (!clientId) {
    if (!b.client) fail(400, 'clientId or client is required');
    clientId = (await findOrCreateClient(org, { name: b.client.name, phone: b.client.phone, lang: b.client.lang })).id;
  }
  try {
    const appt = await bookAppointment(org, { clientId, staffId: b.staffId, startsAt: new Date(b.startsAt), reason: b.reason, channel: 'desk', by: c.get('user').id });
    const client = await ctx.db.one<Client>('select * from clients where id = $1', [clientId]);
    const s = await ctx.db.one<Staff>('select * from staff_members where id = $1', [appt.staff_id]);
    const { formatWhen, visitLink } = await import('../services/visits.ts');
    const body2 =
      client?.lang === 'ta'
        ? `✅ முன்பதிவு உறுதி: ${s!.name}, ${formatWhen(appt.starts_at, org, 'ta')}. டோக்கன் ${appt.token_no}. உங்கள் வருகைப் பக்கம்: ${visitLink(appt.code)}`
        : `✅ Booked: ${s!.name}, ${formatWhen(appt.starts_at, org, 'en')}. Token ${appt.token_no}. Your visit page: ${visitLink(appt.code)}`;
    await queueMessage(org, clientId, 'confirmation', body2, { appointmentId: appt.id });
    return c.json(appt);
  } catch (e) {
    fail(409, (e as Error).message);
  }
});

visits.get('/appointments', async (c) => {
  const org = c.get('org');
  const date = c.req.query('date');
  const at = date ? new Date(`${date}T12:00:00Z`) : new Date();
  const { start, end } = dayBounds(at, org.settings.utcOffsetMin);
  return c.json(
    await ctx.db.query(
      `select a.*, c.name as client_name, c.phone as client_phone, s.name as staff_name from appointments a
         join clients c on c.id = a.client_id join staff_members s on s.id = a.staff_id
        where a.org_id = $1 and a.starts_at >= $2 and a.starts_at < $3 order by a.starts_at`,
      [org.id, start, end],
    ),
  );
});

visits.get('/queue', async (c) => {
  const org = c.get('org');
  const staff = await listStaff(org.id);
  return c.json(await Promise.all(staff.map((s) => queueFor(org, s.id))));
});

visits.post('/appointments/:id/:op{checkin|start|finish|cancel|no_show}', async (c) => {
  const org = c.get('org');
  const appt = await getAppointment(org.id, c.req.param('id'));
  if (!appt) fail(404, 'Not found');
  const op = c.req.param('op');
  try {
    if (op === 'checkin') return c.json(await checkIn(org, appt, 'desk'));
    if (op === 'start') await startVisit(org, appt);
    if (op === 'finish') {
      const b = await body(c, z.object({ followupDays: z.number().int().min(1).max(365).nullable().optional(), checkinDays: z.number().int().min(1).max(30).nullable().optional() }));
      await finishVisit(org, appt, { ...b, by: c.get('user').id });
    }
    if (op === 'cancel' || op === 'no_show') await setAppointmentStatus(org, appt, op === 'cancel' ? 'cancelled' : 'no_show', c.get('user').id);
  } catch (e) {
    fail(409, (e as Error).message);
  }
  return c.json({ ok: true });
});

// ── prep protocols (doctor-approved instructions) ───────────────────────────
visits.get('/protocols', async (c) => c.json(await ctx.db.query('select * from prep_protocols where org_id = $1 order by created_at', [c.get('org').id])));

visits.post('/protocols', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const b = await body(
    c,
    z.object({ title: z.string().min(2).max(200), keywords: z.array(z.string().max(60)).max(30).default([]), staffId: z.string().uuid().nullable().optional(), instructions: z.string().min(5).max(4000), daysBefore: z.number().int().min(0).max(14).default(1) }),
  );
  const id = uuid();
  await ctx.db.query(`insert into prep_protocols (id, org_id, title, keywords, staff_id, instructions, days_before, approved_by) values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`, [
    id, org.id, b.title, b.keywords, b.staffId ?? null, b.instructions, b.daysBefore, c.get('user').name,
  ]);
  await audit(org.id, c.get('user').id, 'protocol.approved', id, { title: b.title });
  return c.json({ id });
});

visits.delete('/protocols/:id', requireRole('admin'), async (c) => {
  await ctx.db.query('delete from prep_protocols where id = $1 and org_id = $2', [c.req.param('id'), c.get('org').id]);
  return c.json({ ok: true });
});

// ── approvals: AI-drafted messages that need a clinician ────────────────────
visits.get('/approvals', async (c) => {
  const org = c.get('org');
  const [messages, findings] = await Promise.all([
    ctx.db.query(
      `select o.*, c.name as client_name from outbox o join clients c on c.id = o.client_id where o.org_id = $1 and o.status = 'pending_approval' order by o.created_at desc limit 100`,
      [org.id],
    ),
    ctx.db.query(
      `select f.*, c.name as client_name from findings f join clients c on c.id = f.client_id where f.org_id = $1 and f.status = 'open'
        order by case f.severity when 'urgent' then 0 when 'attention' then 1 else 2 end, f.created_at desc limit 200`,
      [org.id],
    ),
  ]);
  return c.json({ messages, findings });
});

visits.post('/outbox/:id/approve', async (c) => {
  const b = await body(c, z.object({ body: z.string().min(1).max(2000).optional() }));
  const org = c.get('org');
  const row = await ctx.db.one<{ meta: any; client_id: string }>(`select meta, client_id from outbox where id = $1 and org_id = $2 and status = 'pending_approval'`, [c.req.param('id'), org.id]);
  if (!row) fail(404, 'Nothing to approve');
  await requireSignOff(c, row.client_id);
  await approveMessage(org.id, c.req.param('id'), c.get('user').name, b.body);
  const ids: string[] = row.meta?.findingIds ?? (row.meta?.findingId ? [row.meta.findingId] : []);
  if (ids.length) await ctx.db.query(`update findings set status = 'shared', reviewed_by = $2, reviewed_at = now() where id::text in (select jsonb_array_elements_text($1::jsonb)) and status in ('open', 'acknowledged')`, [ids, c.get('user').name]);
  await audit(org.id, c.get('user').id, 'message.approved', c.req.param('id'), { edited: Boolean(b.body) });
  return c.json({ ok: true });
});

visits.post('/outbox/:id/discard', async (c) => {
  await ctx.db.query(`update outbox set status = 'cancelled' where id = $1 and org_id = $2 and status in ('pending_approval', 'scheduled')`, [c.req.param('id'), c.get('org').id]);
  return c.json({ ok: true });
});

visits.post('/findings/:id/review', async (c) => {
  const org = c.get('org');
  const b = await body(c, z.object({ action: z.enum(['acknowledge', 'dismiss']) }));
  const f = await ctx.db.one<{ client_id: string }>('select client_id from findings where id = $1 and org_id = $2', [c.req.param('id'), org.id]);
  if (!f) fail(404, 'Not found');
  await requireSignOff(c, f.client_id);
  await ctx.db.query(`update findings set status = $3, reviewed_by = $4, reviewed_at = now() where id = $1 and org_id = $2`, [
    c.req.param('id'), org.id, b.action === 'dismiss' ? 'dismissed' : 'acknowledged', c.get('user').name,
  ]);
  await audit(org.id, c.get('user').id, `finding.${b.action}`, c.req.param('id'), {});
  return c.json({ ok: true });
});

// ── report review queue ──────────────────────────────────────────────────────
visits.get('/reviews', async (c) => {
  const org = c.get('org');
  const mine = c.req.query('mine') === '1';
  return c.json(await awaitingReview(org.id, mine ? { userId: c.get('user').id } : {}));
});

visits.get('/reviews/count', async (c) => {
  const org = c.get('org');
  const [all, mine] = await Promise.all([reviewCount(org.id), reviewCount(org.id, c.get('user').id)]);
  return c.json({ all, mine });
});

visits.post('/records/:id/reviewed', async (c) => {
  const org = c.get('org');
  const rec = await ctx.db.one<{ client_id: string }>('select client_id from records where id = $1 and org_id = $2', [c.req.param('id'), org.id]);
  if (!rec) fail(404, 'Not found');
  await requireSignOff(c, rec.client_id);
  if (!(await markReviewed(org.id, c.req.param('id'), c.get('user').id))) fail(409, 'Already reviewed');
  return c.json({ ok: true });
});

// ── records ──────────────────────────────────────────────────────────────────
async function requireRecords(c: any) {
  const org = c.get('org');
  if (config.mode === 'cloud' && !planOf(org).records) fail(403, 'Medical records and AI findings are part of the Growth plan and above.');
}

visits.post('/clients/:id/records', async (c) => {
  await requireRecords(c);
  const org = c.get('org');
  const clientId = c.req.param('id');
  const client = await ctx.db.one('select id from clients where id = $1 and org_id = $2', [clientId, org.id]);
  if (!client) fail(404, 'Not found');
  const id = uuid();
  if ((c.req.header('content-type') ?? '').includes('multipart')) {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) fail(400, 'Attach a file in the "file" field');
    if (file.size > 15 * 1024 * 1024) fail(400, 'Max file size is 15 MB');
    const key = `org/${org.id}/records/${id}-${file.name.replace(/[^\w.\-]/g, '_')}`;
    await getBlobStore().put(key, new Uint8Array(await file.arrayBuffer()), file.type || 'application/octet-stream');
    await ctx.db.query(`insert into records (id, org_id, client_id, title, blob_key, uploaded_by) values ($1, $2, $3, $4, $5, 'staff')`, [id, org.id, clientId, file.name, key]);
  } else {
    const b = await body(c, z.object({ title: z.string().min(1).max(200), text: z.string().min(5).max(100_000) }));
    await ctx.db.query(`insert into records (id, org_id, client_id, title, text, uploaded_by) values ($1, $2, $3, $4, $5, 'staff')`, [id, org.id, clientId, b.title, b.text]);
  }
  await enqueue('record_process', { recordId: id });
  return c.json({ id });
});

visits.get('/records/:id', async (c) => {
  const r = await ctx.db.one('select id, title, kind, status, text, summary, observed_on, created_at from records where id = $1 and org_id = $2', [c.req.param('id'), c.get('org').id]);
  if (!r) fail(404, 'Not found');
  return c.json(r);
});

/** Manual entry for scanned images the intake agent could not read. */
visits.post('/clients/:id/observations', async (c) => {
  const org = c.get('org');
  const b = await body(c, z.object({ test: z.string().max(20), value: z.number(), observedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), recordId: z.string().uuid().optional() }));
  const def = TESTS.find((t) => t.key === b.test);
  if (!def) fail(400, `Unknown test. Use one of: ${TESTS.map((t) => t.key).join(', ')}`);
  const o = { test: def.key, value: b.value, ref_low: def.low ?? null, ref_high: def.high ?? null };
  await ctx.db.query(
    `insert into observations (id, org_id, client_id, record_id, test, label, value, unit, ref_low, ref_high, flag, observed_on) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [uuid(), org.id, c.req.param('id'), b.recordId ?? null, def.key, def.label, b.value, def.unit, o.ref_low, o.ref_high, flagFor(o), b.observedOn],
  );
  return c.json({ findings: await runFindings(org, c.req.param('id')) });
});

// ── investigations ──────────────────────────────────────────────────────────
async function notifyInvestigation(org: any, inv: { client_id: string; label: string; instructions: string; due_by: string | null }, by: string) {
  const client = await ctx.db.one<Client>('select * from clients where id = $1', [inv.client_id]);
  const ta = client?.lang === 'ta';
  const due = inv.due_by ? (ta ? ` (${inv.due_by} க்குள்)` : ` by ${inv.due_by}`) : '';
  const text = ta
    ? `உங்கள் மருத்துவர் ${inv.label} பரிசோதனையைப் பரிந்துரைத்துள்ளார்${due}. ${inv.instructions}\nமுடிவு கிடைத்ததும் உங்கள் வருகைப் பக்கத்தில் பதிவேற்றவும் அல்லது இங்கே அனுப்பவும்.`
    : `Your doctor has asked for a ${inv.label} test${due}. ${inv.instructions}\nWhen the report is ready, upload it from your visit page or send it here.`;
  const id = await queueMessage(org, inv.client_id, 'investigation', text.trim());
  await ctx.db.query('update outbox set approved_by = $2 where id = $1', [id, by]);
}

visits.post('/clients/:id/investigations', async (c) => {
  const org = c.get('org');
  const b = await body(c, z.object({ test: z.string().max(40), label: z.string().max(120), instructions: z.string().max(1000).default(''), dueBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
  const id = uuid();
  await ctx.db.query(`insert into investigations (id, org_id, client_id, test, label, instructions, due_by, status, ordered_by) values ($1, $2, $3, $4, $5, $6, $7, 'ordered', $8)`, [
    id, org.id, c.req.param('id'), b.test, b.label, b.instructions, b.dueBy ?? null, c.get('user').name,
  ]);
  await notifyInvestigation(org, { client_id: c.req.param('id'), label: b.label, instructions: b.instructions, due_by: b.dueBy ?? null }, c.get('user').name);
  await audit(org.id, c.get('user').id, 'investigation.ordered', id, { test: b.test });
  return c.json({ id });
});

visits.post('/investigations/:id/:op{order|cancel}', async (c) => {
  const org = c.get('org');
  const inv = await ctx.db.one<{ id: string; client_id: string; label: string; instructions: string; status: string }>('select * from investigations where id = $1 and org_id = $2', [c.req.param('id'), org.id]);
  if (!inv) fail(404, 'Not found');
  if (c.req.param('op') === 'cancel') {
    await ctx.db.query(`update investigations set status = 'cancelled' where id = $1`, [inv.id]);
    return c.json({ ok: true });
  }
  const b = await body(c, z.object({ dueBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), instructions: z.string().max(1000).optional() }));
  const instructions = b.instructions ?? '';
  await ctx.db.query(`update investigations set status = 'ordered', ordered_by = $2, due_by = $3, instructions = $4 where id = $1`, [inv.id, c.get('user').name, b.dueBy ?? null, instructions]);
  await notifyInvestigation(org, { client_id: inv.client_id, label: inv.label, instructions, due_by: b.dueBy ?? null }, c.get('user').name);
  await audit(org.id, c.get('user').id, 'investigation.ordered', inv.id, {});
  return c.json({ ok: true });
});

// ── telecalling add-on ──────────────────────────────────────────────────────
visits.get('/calls', async (c) => {
  const org = c.get('org');
  const rows = await ctx.db.query(
    `select k.*, c.name as client_name from calls k left join clients c on c.id = k.client_id where k.org_id = $1 order by k.created_at desc limit 100`,
    [org.id],
  );
  return c.json({ enabled: await hasAddon(org, 'telecalling'), provider: org.settings.voice?.provider ?? 'simulated', calls: rows });
});

visits.post('/calls', async (c) => {
  const org = c.get('org');
  if (!(await hasAddon(org, 'telecalling'))) fail(403, 'AI telecalling is an add-on. Start a free trial from Settings → Billing.');
  const b = await body(c, z.object({ appointmentId: z.string().uuid().optional(), followupId: z.string().uuid().optional(), purpose: z.enum(['reminder', 'followup']) }));
  const id = await placeCall({ orgId: org.id, ...b });
  if (!id) fail(409, 'Nothing to call about (the appointment may no longer be booked, or the follow-up was already answered).');
  return c.json({ id });
});

visits.post('/calls/:id/simulate', async (c) => {
  const org = c.get('org');
  const b = await body(c, z.object({ digit: z.enum(['1', '2', '3']) }));
  const call = await ctx.db.one<{ provider: string }>('select provider from calls where id = $1 and org_id = $2', [c.req.param('id'), org.id]);
  if (!call) fail(404, 'Not found');
  if (call.provider !== 'simulated') fail(400, 'Only simulated calls can be answered from the dashboard');
  return c.json(await handleDigit(c.req.param('id'), b.digit));
});

visits.put('/voice', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const b = await body(
    c,
    z.object({ provider: z.enum(['simulated', 'twilio', 'exotel']), from: z.string().max(20).optional(), accountSid: z.string().max(64).optional(), authToken: z.string().max(200).optional(), transferTo: z.string().max(20).optional() }),
  );
  const settings = { ...org.settings, voice: { provider: b.provider, from: b.from, accountSid: b.accountSid, transferTo: b.transferTo } };
  const secrets = { ...org.secrets };
  if (b.authToken) secrets.voiceToken = encrypt(b.authToken);
  await ctx.db.query('update orgs set settings = $2::jsonb, secrets = $3::jsonb where id = $1', [org.id, settings, secrets]);
  await audit(org.id, c.get('user').id, 'channel.voice.updated', org.id, { provider: b.provider });
  return c.json({ ok: true, inboundUrl: `${config.publicUrl}/webhooks/voice/twilio/inbound/${org.site_key}` });
});

// ── camera check-in add-on: on-premises devices ─────────────────────────────
visits.get('/edge/devices', async (c) => {
  const org = c.get('org');
  return c.json({
    enabled: await hasAddon(org, 'camera_checkin'),
    devices: await ctx.db.query('select id, name, last_seen_at, created_at from edge_devices where org_id = $1 order by created_at', [org.id]),
  });
});

visits.post('/edge/devices', requireRole('admin'), async (c) => {
  const org = c.get('org');
  if (!(await hasAddon(org, 'camera_checkin'))) fail(403, 'Camera check-in is an add-on. Start a free trial from Settings → Billing.');
  const b = await body(c, z.object({ name: z.string().min(2).max(80) }));
  const id = uuid();
  const secret = `edge_${token(24)}`;
  await ctx.db.query('insert into edge_devices (id, org_id, name, token_hash) values ($1, $2, $3, $4)', [id, org.id, b.name, sha1(secret)]);
  await audit(org.id, c.get('user').id, 'edge.device_created', id, { name: b.name });
  return c.json({ id, token: secret, apiUrl: `${config.publicUrl}/edge` });
});

visits.delete('/edge/devices/:id', requireRole('admin'), async (c) => {
  await ctx.db.query('delete from edge_devices where id = $1 and org_id = $2', [c.req.param('id'), c.get('org').id]);
  return c.json({ ok: true });
});
