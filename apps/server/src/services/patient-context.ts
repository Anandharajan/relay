import { ctx } from '../ctx.ts';
import type { Org } from './orgs.ts';
import { visitLink } from './visits.ts';

/** Resolve identity from an authenticated conversation, never from a phone/name in a prompt. */
export async function patientContext(org: Org, conversationId: string) {
  const client = await ctx.db.one<{ id: string; name: string }>(
    'select id, name from clients where org_id = $1 and conversation_id = $2', [org.id, conversationId]);
  if (!client) return null;
  const appointment = await ctx.db.one<{ id: string; code: string; staff_name: string; starts_at: Date; status: string; token_no: number }>(
    `select a.id, a.code, s.name as staff_name, a.starts_at, a.status, a.token_no from appointments a
     join staff_members s on s.id = a.staff_id where a.org_id = $1 and a.client_id = $2
     and a.status not in ('cancelled', 'no_show')
     order by (a.id::text = (select meta->>'appointmentId' from conversations where id = $3 and org_id = $1)) desc nulls last,
     a.starts_at desc limit 1`, [org.id, client.id, conversationId]);
  const records = await ctx.db.query<{ id: string; title: string; status: string }>(
    'select id, title, status from records where org_id = $1 and client_id = $2 order by created_at desc limit 10', [org.id, client.id]);
  const requested = await ctx.db.query<{ label: string; instructions: string }>(
    `select label, instructions from investigations where org_id = $1 and client_id = $2 and status in ('ordered', 'overdue') order by due_by nulls last`, [org.id, client.id]);
  return { client, appointment, records, requested, visitUrl: appointment ? visitLink(appointment.code) : null };
}

export function unrelatedMessage(text: string) {
  return /\b(write (me )?(a )?(poem|joke|essay|code)|tell (me )?(a )?joke|bitcoin|crypto investment|win (a )?lottery|buy followers|football score|weather forecast|ignore (all |previous )?instructions|reveal (your |the )?system prompt)\b/i.test(text);
}

export async function reportFlow(org: Org, conversationId: string, text: string, lang: string) {
  if (!/\b(upload|attach|send|share|submitted|received|documents?|reports?|files?)\b|அறிக்கை|பதிவேற்ற|रिपोर्ट|दस्तावेज/i.test(text)) return null;
  // Lab-ID lookups and medical interpretation remain in their existing action/safety paths.
  if (/\bLAB-\d+\b|\b(report ready|lab report be ready|lab hours)\b/i.test(text)) return null;
  const context = await patientContext(org, conversationId);
  if (!context) return {
    text: lang === 'ta' ? 'அறிக்கையை உங்கள் சந்திப்புடன் இணைக்க முதலில் "book appointment" என்று முன்பதிவு செய்யவும். உண்மையான மருத்துவ விவரங்களை பொது டெமோவில் பகிர வேண்டாம்.' :
      'To link a report to your visit, first book an appointment here. Please upload only reports your clinic requested; use fictional documents in the public demo.',
    metaPatch: { agent: { intent: 'collect_report', nextAction: 'book_visit', summary: 'Patient wants to share documents; no linked visit yet.' } },
  };
  const files = context.records.map(r => `${r.title}: ${r.status === 'processed' ? 'received; awaiting staff review' : r.status === 'needs_review' ? 'needs manual review' : 'processing'}`).join('; ');
  const requested = context.requested.map(r => r.label).join(', ');
  const textOut = lang === 'ta'
    ? `${files ? `பெறப்பட்ட அறிக்கைகள்: ${files}. ` : ''}${requested ? `மருத்துவர் கேட்ட பரிசோதனைகள்: ${requested}. ` : 'மருத்துவமனை கேட்ட அறிக்கைகள் இருந்தால் மட்டும் பதிவேற்றவும். '}அறிக்கையை இணைக்க: ${context.visitUrl || ''}. முடிவுகளை மருத்துவர் மதிப்பாய்வு செய்வார்; நான் மருத்துவ விளக்கம் அளிக்க மாட்டேன்.`
    : `${files ? `Your reports: ${files}. ` : ''}${requested ? `The clinic requested: ${requested}. ` : 'If the clinic requested documents, you can share them here. '}Use Attach report in this chat${context.visitUrl ? ` or your visit page: ${context.visitUrl}` : ''}. Your doctor will review the results; I cannot interpret them.`;
  return { text: textOut, metaPatch: { clientId: context.client.id, appointmentId: context.appointment?.id,
    agent: { intent: 'collect_report', nextAction: files ? 'staff_review' : 'upload_report', summary: files || 'Waiting for requested reports.', requestedDocuments: context.requested.map(r => r.label) } } };
}
