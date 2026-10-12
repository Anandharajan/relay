import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { ctx } from '../ctx.ts';
import { sha1, uuid } from '../lib/crypto.ts';
import { rateLimit } from '../lib/ratelimit.ts';
import { getBlobStore } from '../adapters/blob.ts';
import { body, fail } from '../http.ts';
import { audit, getOrg, getOrgBySiteKey, hasAddon } from '../services/orgs.ts';
import { checkIn, dayBounds, etaFor, getAppointmentByCode, type Client } from '../services/visits.ts';
import { handleDigit, inboundChoice, inboundMenu, sayTwiml, verifyTwilio } from '../services/calls.ts';
import { enqueue } from '../jobs/runner.ts';
import { config } from '../config.ts';

function ip(c: Context) {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}
function limit(c: Context, key: string, max = 60) {
  if (!rateLimit(`pub:${key}:${ip(c)}`, max, 10 * 60_000).ok) fail(429, 'Too many requests, please try again shortly');
}

/**
 * Public visit API: what a patient sees from the link in their booking confirmation (/v/:code),
 * and the reception QR (/checkin/:siteKey). The 6-character code is the credential; it is rate limited
 * and only exposes this one visit (no history, no findings, no other patients).
 */
export const publicVisit = new Hono();

async function loadVisit(code: string) {
  const appt = await getAppointmentByCode(code);
  if (!appt) fail(404, 'Visit not found. Check the link in your confirmation message.');
  const org = (await getOrg(appt.org_id))!;
  return { appt, org };
}

publicVisit.get('/visit/:code', async (c) => {
  limit(c, 'visit', 240);
  const { appt, org } = await loadVisit(c.req.param('code'));
  const [staff, client, messages, investigations, records] = await Promise.all([
    ctx.db.one<{ name: string; specialty: string }>('select name, specialty from staff_members where id = $1', [appt.staff_id]),
    ctx.db.one<Client & { face_optin_at: Date | null }>('select * from clients where id = $1', [appt.client_id]),
    ctx.db.query<{ kind: string; body: string; sent_at: Date }>(
      `select kind, body, sent_at from outbox where client_id = $1 and status = 'sent' and kind in ('confirmation','prep','investigation','finding','custom','eta','followup','record_ack') and sent_at > now() - interval '45 days' order by sent_at desc limit 20`,
      [appt.client_id],
    ),
    ctx.db.query<{ label: string; status: string; due_by: string | null; instructions: string }>(
      `select label, status, due_by, instructions from investigations where client_id = $1 and status in ('ordered', 'overdue', 'resulted') and created_at > now() - interval '90 days' order by created_at desc`,
      [appt.client_id],
    ),
    ctx.db.query<{ title: string; status: string; created_at: Date }>(`select title, status, created_at from records where client_id = $1 and uploaded_by = 'patient' order by created_at desc limit 10`, [appt.client_id]),
  ]);
  const { start, end } = dayBounds(new Date(), org.settings.utcOffsetMin);
  const today = new Date(appt.starts_at) >= start && new Date(appt.starts_at) < end;
  const live = today && ['booked', 'checked_in', 'in_progress'].includes(appt.status) ? await etaFor(org, appt) : null;
  const rated = await ctx.db.one<{ rating: number }>('select rating from visit_ratings where appointment_id = $1', [appt.id]);
  return c.json({
    org: { name: org.name, brandColor: org.settings.brandColor, vertical: org.settings.vertical, emergencyNumber: org.settings.emergencyNumber, cameraCheckin: await hasAddon(org, 'camera_checkin') },
    visit: { code: appt.code, startsAt: appt.starts_at, status: appt.status, token: appt.token_no, reason: appt.reason, checkedInAt: appt.checked_in_at, today },
    staff,
    client: { firstName: client?.name.split(' ')[0] ?? '', lang: client?.lang ?? 'en', cameraOptIn: Boolean(client?.face_optin_at) },
    live,
    messages,
    investigations,
    uploads: records,
    rated: rated?.rating ?? null,
  });
});

publicVisit.post('/visit/:code/checkin', async (c) => {
  limit(c, 'checkin', 30);
  const { appt, org } = await loadVisit(c.req.param('code'));
  try {
    const r = await checkIn(org, appt, 'qr');
    return c.json({ ok: true, ahead: r.ahead, etaMin: r.etaMin, token: r.appointment.token_no });
  } catch (e) {
    fail(409, (e as Error).message);
  }
});

publicVisit.post('/visit/:code/records', async (c) => {
  limit(c, 'upload', 20);
  const { appt, org } = await loadVisit(c.req.param('code'));
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) fail(400, 'Attach a file');
  if (file.size > 10 * 1024 * 1024) fail(400, 'Max file size is 10 MB');
  if (!/\.(pdf|docx|txt|jpe?g|png|heic|webp)$/i.test(file.name)) fail(400, 'Upload a PDF, photo or Word file');
  const id = uuid();
  const key = `org/${org.id}/records/${id}-${file.name.replace(/[^\w.\-]/g, '_')}`;
  await getBlobStore().put(key, new Uint8Array(await file.arrayBuffer()), file.type || 'application/octet-stream');
  await ctx.db.query(`insert into records (id, org_id, client_id, title, blob_key, uploaded_by) values ($1, $2, $3, $4, $5, 'patient')`, [id, org.id, appt.client_id, file.name.slice(0, 200), key]);
  await enqueue('record_process', { recordId: id });
  await audit(org.id, 'patient', 'record.uploaded', id, { visit: appt.id });
  return c.json({ ok: true });
});

publicVisit.post('/visit/:code/camera-consent', async (c) => {
  limit(c, 'consent', 20);
  const { appt, org } = await loadVisit(c.req.param('code'));
  if (!(await hasAddon(org, 'camera_checkin'))) fail(404, 'Not available');
  const b = await body(c, z.object({ optIn: z.boolean() }));
  await ctx.db.query(`update clients set face_optin_at = ${b.optIn ? 'now()' : 'null'} where id = $1`, [appt.client_id]);
  await audit(org.id, 'patient', b.optIn ? 'consent.camera_granted' : 'consent.camera_withdrawn', appt.client_id, {});
  return c.json({ ok: true });
});

/** Reception QR: one code per institution, the visitor types their visit code or phone's last 4 digits + token. */
publicVisit.get('/checkin/:siteKey', async (c) => {
  const org = await getOrgBySiteKey(c.req.param('siteKey'));
  if (!org) fail(404, 'Unknown location');
  return c.json({ name: org.name, brandColor: org.settings.brandColor });
});

publicVisit.post('/checkin/:siteKey', async (c) => {
  limit(c, 'desk', 30);
  const org = await getOrgBySiteKey(c.req.param('siteKey'));
  if (!org) fail(404, 'Unknown location');
  const b = await body(c, z.object({ code: z.string().max(12).optional(), phoneLast4: z.string().regex(/^\d{4}$/).optional(), token: z.number().int().min(1).max(999).optional() }));
  let appt = b.code ? await getAppointmentByCode(b.code) : undefined;
  if (!appt && b.phoneLast4 && b.token) {
    const { start, end } = dayBounds(new Date(), org.settings.utcOffsetMin);
    appt = await ctx.db.one(
      `select a.* from appointments a join clients c on c.id = a.client_id where a.org_id = $1 and a.token_no = $2 and right(c.phone, 4) = $3 and a.starts_at >= $4 and a.starts_at < $5 limit 1`,
      [org.id, b.token, b.phoneLast4, start, end],
    );
  }
  if (!appt || appt.org_id !== org.id) fail(404, 'No appointment found for today. Please see the front desk.');
  try {
    const r = await checkIn(org, appt, 'qr');
    return c.json({ ok: true, code: appt.code, token: r.appointment.token_no, ahead: r.ahead, etaMin: r.etaMin });
  } catch (e) {
    fail(409, (e as Error).message);
  }
});

// ── voice webhooks (telecalling add-on) ─────────────────────────────────────
export const voiceWebhooks = new Hono();

async function twilioParams(c: Context) {
  const form = (await c.req.parseBody()) as Record<string, string>;
  return Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)]));
}

voiceWebhooks.post('/twilio/:callId', async (c) => {
  const call = await ctx.db.one<{ org_id: string }>('select org_id from calls where id = $1', [c.req.param('callId')]);
  if (!call) return c.text('unknown call', 404);
  const org = (await getOrg(call.org_id))!;
  const params = await twilioParams(c);
  const url = `${config.publicUrl}/webhooks/voice/twilio/${c.req.param('callId')}`;
  if (!verifyTwilio(org, url, params, c.req.header('x-twilio-signature') ?? '')) return c.text('invalid signature', 401);
  const r = await handleDigit(c.req.param('callId'), params.Digits ?? '');
  c.header('content-type', 'text/xml');
  return c.body(sayTwiml(r.reply || 'Thank you.', r.lang ?? 'en'));
});

voiceWebhooks.post('/twilio/inbound/:siteKey', async (c) => {
  const org = await getOrgBySiteKey(c.req.param('siteKey'));
  if (!org || !(await hasAddon(org, 'telecalling'))) return c.text('not found', 404);
  const params = await twilioParams(c);
  const url = `${config.publicUrl}/webhooks/voice/twilio/inbound/${c.req.param('siteKey')}`;
  if (!verifyTwilio(org, url, params, c.req.header('x-twilio-signature') ?? '')) return c.text('invalid signature', 401);
  c.header('content-type', 'text/xml');
  if (!params.Digits) return c.body(inboundMenu(org, url));
  return c.body(await inboundChoice(org, params.From ?? '', params.Digits));
});

// ── on-premises camera agents (camera check-in add-on) ──────────────────────
export const edge = new Hono<{ Variables: { orgId: string; deviceId: string } }>();
edge.use('*', async (c, next) => {
  const auth = c.req.header('authorization')?.replace(/^Bearer /, '') ?? '';
  const device = auth ? await ctx.db.one<{ id: string; org_id: string }>('select id, org_id from edge_devices where token_hash = $1', [sha1(auth)]) : undefined;
  if (!device) return c.json({ error: 'Invalid device token' }, 401);
  const org = await getOrg(device.org_id);
  if (!org || !(await hasAddon(org, 'camera_checkin'))) return c.json({ error: 'Camera check-in add-on is not active' }, 403);
  await ctx.db.query('update edge_devices set last_seen_at = now() where id = $1', [device.id]);
  c.set('orgId', device.org_id);
  c.set('deviceId', device.id);
  await next();
});

/** Today's expected, opted-in visitors. Only ids and first names: face templates live on the device. */
edge.get('/expected', async (c) => {
  const org = (await getOrg(c.get('orgId')))!;
  const { start, end } = dayBounds(new Date(), org.settings.utcOffsetMin);
  return c.json(
    await ctx.db.query(
      `select c.id as client_id, split_part(c.name, ' ', 1) as first_name, a.code as visit_code, a.starts_at, a.status from appointments a join clients c on c.id = a.client_id
        where a.org_id = $1 and a.starts_at >= $2 and a.starts_at < $3 and a.status in ('booked', 'checked_in') and c.face_optin_at is not null`,
      [org.id, start, end],
    ),
  );
});

edge.post('/arrivals', async (c) => {
  const org = (await getOrg(c.get('orgId')))!;
  const b = await body(c, z.object({ clientId: z.string().uuid(), confidence: z.number().min(0).max(1) }));
  if (b.confidence < 0.8) return c.json({ ok: false, reason: 'low_confidence' });
  const client = await ctx.db.one<{ face_optin_at: Date | null }>('select face_optin_at from clients where id = $1 and org_id = $2', [b.clientId, org.id]);
  if (!client?.face_optin_at) return c.json({ ok: false, reason: 'no_consent' });
  const { start, end } = dayBounds(new Date(), org.settings.utcOffsetMin);
  const appt = await ctx.db.one<any>(`select * from appointments where client_id = $1 and starts_at >= $2 and starts_at < $3 and status = 'booked' order by starts_at limit 1`, [b.clientId, start, end]);
  if (!appt) return c.json({ ok: false, reason: 'no_appointment_or_already_checked_in' });
  const r = await checkIn(org, appt, 'camera');
  await audit(org.id, `edge:${c.get('deviceId')}`, 'checkin.camera', appt.id, { confidence: b.confidence });
  return c.json({ ok: true, token: r.appointment.token_no, etaMin: r.etaMin });
});

// ── early access / leads ────────────────────────────────────────────────────
publicVisit.post('/leads', async (c) => {
  limit(c, 'lead', 8);
  const b = await body(
    c,
    z.object({
      name: z.string().min(2).max(120),
      email: z.string().email().max(200),
      phone: z.string().max(20).optional(),
      orgName: z.string().max(160).default(''),
      institutionType: z.enum(['clinic', 'hospital', 'diagnostics', 'education', 'services', 'retail', 'other']).default('other'),
      size: z.string().max(40).default(''),
      message: z.string().max(2000).default(''),
      source: z.string().max(40).default('landing'),
    }),
  );
  await ctx.db.query(
    `insert into leads (id, name, email, phone, org_name, institution_type, size, message, source) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [uuid(), b.name, b.email.toLowerCase(), b.phone ?? null, b.orgName, b.institutionType, b.size, b.message, b.source],
  );
  return c.json({ ok: true });
});

// ── visit rating (patient → staff member, and the assistant) ─────────────────
publicVisit.post('/visit/:code/rating', async (c) => {
  limit(c, 'rating', 10);
  const { appt, org } = await loadVisit(c.req.param('code'));
  if (appt.status !== 'done') fail(409, 'You can rate your visit after the consultation.');
  const b = await body(c, z.object({ rating: z.number().int().min(1).max(5), aiRating: z.number().int().min(1).max(5).optional(), comment: z.string().max(1000).default('') }));
  await ctx.db.query(
    `insert into visit_ratings (id, org_id, appointment_id, client_id, staff_id, rating, ai_rating, comment) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (appointment_id) do update set rating = excluded.rating, ai_rating = excluded.ai_rating, comment = excluded.comment`,
    [uuid(), org.id, appt.id, appt.client_id, appt.staff_id, b.rating, b.aiRating ?? null, b.comment],
  );
  if (b.rating <= 2) {
    const { publish } = await import('../lib/events.ts');
    publish(`org:${org.id}`, 'attention', { reason: 'low_rating', appointmentId: appt.id });
  }
  return c.json({ ok: true });
});
