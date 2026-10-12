import { ctx } from '../ctx.ts';
import { getOrg } from '../services/orgs.ts';
import { getConversation, patchMeta } from '../services/conversations.ts';
import { deliverDue, queueMessage, setAppointmentStatus, type Appointment, type Client } from '../services/visits.ts';
import { enqueue } from './runner.ts';
import { recordRun } from '../services/agents.ts';
import { config } from '../config.ts';
import { refreshDemoDay } from '../seed.ts';

/**
 * Every minute: deliver due messages, send follow-ups, mark no-shows, chase overdue investigations.
 * Idempotent: every step moves rows to a new status, so overlapping runs are harmless.
 */
export async function visitsTick() {
  if (config.demo.seed) await refreshDemoDay().catch((e) => console.error('[demo] refresh failed', e.message));
  await deliverDue();

  // Follow-ups that are due.
  const due = await ctx.db.query<{ id: string; org_id: string; client_id: string; kind: string; staff_name: string | null }>(
    `select f.id, f.org_id, f.client_id, f.kind, s.name as staff_name from followups f
       left join appointments a on a.id = f.appointment_id left join staff_members s on s.id = a.staff_id
      where f.status = 'pending' and f.due_at <= now() limit 100`,
  );
  for (const f of due) {
    const org = await getOrg(f.org_id);
    const client = await ctx.db.one<Client>('select * from clients where id = $1', [f.client_id]);
    if (!org || !client) continue;
    await ctx.db.query(`update followups set status = 'sent' where id = $1`, [f.id]);
    const ta = client.lang === 'ta';
    const body =
      f.kind === 'checkin'
        ? ta
          ? `வணக்கம் ${client.name}, ${f.staff_name ?? 'மருத்துவர்'} அவர்களைச் சந்தித்த பிறகு இப்போது எப்படி இருக்கிறீர்கள்? பதில் அனுப்பவும்: 1 நன்றாக உள்ளது, 2 அப்படியே உள்ளது, 3 மோசமாக உள்ளது.`
          : `Hello ${client.name}, how are you feeling since your visit with ${f.staff_name ?? 'us'}? Reply 1 (better), 2 (same) or 3 (worse).`
        : ta
          ? `வணக்கம் ${client.name}, ${f.staff_name ?? 'மருத்துவர்'} அவர்களுடன் உங்கள் மறுபரிசோதனை நேரம் வந்துவிட்டது. முன்பதிவு செய்ய "appointment" என்று பதிலளிக்கவும்.`
          : `Hello ${client.name}, it's time for your review visit with ${f.staff_name ?? 'us'}. Reply "appointment" to book a slot.`;
    await queueMessage(org, client.id, 'followup', body);
    await recordRun({ orgId: org.id, agent: 'followup', trigger: 'schedule', clientId: client.id, status: 'ok', outcome: `${f.kind} sent`, complexity: 2, steps: [{ name: 'compose', detail: client.lang }, { name: 'send' }, { name: 'await_reply' }] });
    const fresh = await ctx.db.one<{ conversation_id: string | null }>('select conversation_id from clients where id = $1', [client.id]);
    if (f.kind === 'checkin' && fresh?.conversation_id) {
      const conv = await getConversation(org.id, fresh.conversation_id);
      if (conv) await patchMeta(conv, { followupId: f.id });
    }
    if (f.kind === 'checkin') await enqueue('voice_call', { orgId: org.id, followupId: f.id, purpose: 'followup' }, 4 * 3600_000);
  }

  // No-shows: booked, never checked in, 2 hours past the slot.
  const missed = await ctx.db.query<Appointment>(`select * from appointments where status = 'booked' and starts_at < now() - interval '2 hours' limit 100`);
  for (const a of missed) {
    const org = await getOrg(a.org_id);
    if (org) await setAppointmentStatus(org, a, 'no_show', 'system');
  }

  // Overdue investigations: remind once.
  const overdue = await ctx.db.query<{ id: string; org_id: string; client_id: string; label: string; lang: string; name: string }>(
    `select i.id, i.org_id, i.client_id, i.label, c.lang, c.name from investigations i join clients c on c.id = i.client_id
      where i.status = 'ordered' and i.due_by is not null and i.due_by < current_date limit 100`,
  );
  for (const i of overdue) {
    const org = await getOrg(i.org_id);
    if (!org) continue;
    await ctx.db.query(`update investigations set status = 'overdue', reminded_at = now() where id = $1`, [i.id]);
    const body =
      i.lang === 'ta'
        ? `நினைவூட்டல்: மருத்துவர் பரிந்துரைத்த ${i.label} பரிசோதனை இன்னும் நிலுவையில் உள்ளது. முடிவு கிடைத்ததும் இங்கே பதிவேற்றவும்.`
        : `Reminder: the ${i.label} test your doctor asked for is still pending. Once done, upload the report from your visit page or reply here.`;
    await queueMessage(org, i.client_id, 'investigation', body);
  }
}
