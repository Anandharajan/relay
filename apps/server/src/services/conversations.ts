import { ctx } from '../ctx.ts';
import { uuid } from '../lib/crypto.ts';
import { publish } from '../lib/events.ts';
import { truncate } from '../lib/text.ts';
import { answer, type AnswerOutput, type HistoryTurn } from '../engine/answer.ts';
import { executeAction, loadActions, renderTemplate } from '../engine/actions.ts';
import { getEmbedder, toVectorLiteral } from '../adapters/embed.ts';
import { addUsage, audit, type Org } from './orgs.ts';
import { sendChannelMessage } from '../channels/outbound.ts';

export interface Conversation {
  id: string;
  org_id: string;
  channel: string;
  visitor_id: string;
  customer_name: string | null;
  customer_contact: string | null;
  status: 'ai' | 'escalated' | 'human' | 'resolved';
  lang: string;
  csat: number | null;
  resolved_by: string | null;
  assigned_to: string | null;
  meta: Record<string, any>;
  last_message_at: Date;
  last_message_preview: string;
  created_at: Date;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'customer' | 'ai' | 'human' | 'system' | 'note';
  content: string;
  citations: unknown[];
  confidence: number | null;
  author_id: string | null;
  meta: Record<string, any>;
  created_at: Date;
}

export async function getConversation(orgId: string, id: string): Promise<Conversation | undefined> {
  return ctx.db.one<Conversation>('select * from conversations where id = $1 and org_id = $2', [id, orgId]);
}

export async function createConversation(org: Org, visitorId: string, channel = 'web', extra: { name?: string; contact?: string; meta?: object } = {}) {
  const id = uuid();
  await ctx.db.query(
    `insert into conversations (id, org_id, channel, visitor_id, customer_name, customer_contact, meta) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [id, org.id, channel, visitorId, extra.name ?? null, extra.contact ?? null, extra.meta ?? {}],
  );
  await addUsage(org.id, { conversations: 1 });
  const conv = (await getConversation(org.id, id))!;
  publish(`org:${org.id}`, 'conversation.created', conv);
  return conv;
}

export async function addMessage(
  conv: Conversation,
  role: Message['role'],
  content: string,
  extra: { citations?: unknown[]; confidence?: number | null; tokens?: number; costInr?: number; authorId?: string | null; redacted?: string; meta?: object } = {},
): Promise<Message> {
  const id = uuid();
  await ctx.db.query(
    `insert into messages (id, org_id, conversation_id, role, content, redacted, citations, confidence, tokens, cost_inr, author_id, meta)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12::jsonb)`,
    [id, conv.org_id, conv.id, role, content, extra.redacted ?? null, extra.citations ?? [], extra.confidence ?? null, extra.tokens ?? 0, extra.costInr ?? 0, extra.authorId ?? null, extra.meta ?? {}],
  );
  if (role === 'customer' || role === 'ai' || role === 'human') {
    await ctx.db.query('update conversations set last_message_at = now(), last_message_preview = $2 where id = $1', [conv.id, truncate(content, 140)]);
  }
  const msg = (await ctx.db.one<Message>('select * from messages where id = $1', [id]))!;
  if (role !== 'note') publish(`conv:${conv.id}`, 'message', publicMessage(msg));
  publish(`org:${conv.org_id}`, 'message.created', msg);
  // Deliver agent/AI replies on non-web channels (WhatsApp, ...).
  if ((role === 'ai' || role === 'human') && conv.channel !== 'web') {
    sendChannelMessage(conv, content).catch((e) => console.error('[channel] send failed', e));
  }
  return msg;
}

/** What the customer-facing widget may see. Internal notes and AI metadata are stripped. */
export function publicMessage(m: Message) {
  return { id: m.id, role: m.role === 'human' ? 'agent' : m.role, content: m.content, citations: m.citations, created_at: m.created_at };
}

export async function setStatus(conv: Conversation, status: Conversation['status'], patch: { assigned_to?: string | null } = {}) {
  await ctx.db.query('update conversations set status = $2, assigned_to = coalesce($3, assigned_to) where id = $1', [conv.id, status, patch.assigned_to ?? null]);
  conv.status = status;
  publish(`conv:${conv.id}`, 'status', { status });
  publish(`org:${conv.org_id}`, 'conversation.updated', { id: conv.id, status });
}

export async function patchMeta(conv: Conversation, patch: Record<string, unknown>) {
  conv.meta = { ...conv.meta, ...patch };
  await ctx.db.query('update conversations set meta = $2::jsonb where id = $1', [conv.id, conv.meta]);
}

export async function history(convId: string, limit = 12): Promise<HistoryTurn[]> {
  const rows = await ctx.db.query<{ role: string; content: string }>(
    `select role, content from messages where conversation_id = $1 and role in ('customer', 'ai', 'human') order by created_at desc limit $2`,
    [convId, limit],
  );
  return rows.reverse().map((r) => ({ role: r.role as HistoryTurn['role'], content: r.content }));
}

export async function resolve(conv: Conversation, by: 'ai' | 'human', csat?: number) {
  if (conv.status === 'resolved') {
    if (csat) await ctx.db.query('update conversations set csat = $2 where id = $1', [conv.id, csat]);
    return;
  }
  // Any human reply, approved draft or approved action means the AI didn't resolve it alone.
  const humanTouched = await ctx.db.one(`select 1 from messages where conversation_id = $1 and (role = 'human' or author_id is not null) limit 1`, [conv.id]);
  const resolvedBy = by === 'ai' && !humanTouched ? 'ai' : 'human';
  await ctx.db.query(`update conversations set status = 'resolved', resolved_by = $2, resolved_at = now(), csat = coalesce($3, csat) where id = $1`, [conv.id, resolvedBy, csat ?? null]);
  conv.status = 'resolved';
  if (resolvedBy === 'ai') await addUsage(conv.org_id, { resolutions: 1 });
  publish(`conv:${conv.id}`, 'status', { status: 'resolved' });
  publish(`org:${conv.org_id}`, 'conversation.updated', { id: conv.id, status: 'resolved', resolved_by: resolvedBy });
}

/** Entry point for every inbound customer message, from any channel. */
export async function handleCustomerMessage(org: Org, conv: Conversation, content: string): Promise<Message> {
  if (conv.status === 'resolved') await setStatus(conv, 'ai');
  const msg = await addMessage(conv, 'customer', content);
  if (conv.status === 'ai') {
    runAi(org, conv, content).catch((e) => console.error('[ai] failed', e));
  } else {
    publish(`org:${org.id}`, 'attention', { conversationId: conv.id, reason: 'customer_replied' });
  }
  return msg;
}

export async function runAi(org: Org, conv: Conversation, content: string): Promise<AnswerOutput> {
  publish(`conv:${conv.id}`, 'typing', { typing: true });
  const turns = await history(conv.id);
  const out = await answer({ org, question: content, history: turns.slice(0, -1), meta: conv.meta });
  publish(`conv:${conv.id}`, 'typing', { typing: false });

  if (out.lang !== conv.lang) await ctx.db.query('update conversations set lang = $2 where id = $1', [conv.id, out.lang]);
  if (out.metaPatch) await patchMeta(conv, out.metaPatch);
  await addUsage(org.id, { ai_messages: 1, tokens: out.tokens, cost_inr: out.costInr });
  const aiMeta = { kind: out.kind, engine: out.engine, reason: out.reason, action: out.action ? { name: out.action.name, ok: out.action.ok } : undefined };

  // Draft mode: AI answers wait for a human to approve. Handoffs and actions-pending still notify immediately.
  if (org.settings.mode === 'draft' && (out.kind === 'answer' || out.kind === 'action')) {
    await createDraft(conv, content, out.text, out.citations, out.confidence);
    await setStatus(conv, 'escalated');
    return out;
  }

  await addMessage(conv, 'ai', out.text, { citations: out.citations, confidence: out.confidence, tokens: out.tokens, costInr: out.costInr, redacted: out.redactedQuestion, meta: aiMeta });

  if (out.kind === 'handoff') {
    if (out.suggestion) await createDraft(conv, content, out.suggestion.text, out.suggestion.citations, out.confidence);
    await addMessage(conv, 'system', `Escalated to the team: ${out.reason ?? 'needs a human'}`);
    await setStatus(conv, 'escalated');
    publish(`org:${org.id}`, 'attention', { conversationId: conv.id, reason: out.reason });
  } else if (out.kind === 'action_pending' && out.action) {
    const runId = uuid();
    await ctx.db.query(`insert into action_runs (id, org_id, action_id, conversation_id, params, status) values ($1, $2, $3, $4, $5::jsonb, 'pending_approval')`, [
      runId, org.id, out.action.id, conv.id, out.action.params,
    ]);
    await addMessage(conv, 'system', `Sensitive action "${out.action.name}" is waiting for human verification.`, { meta: { actionRunId: runId } });
    await setStatus(conv, 'escalated');
    publish(`org:${org.id}`, 'attention', { conversationId: conv.id, reason: 'action_approval' });
  }
  if (out.action && out.kind === 'action') {
    await ctx.db.query(`insert into action_runs (id, org_id, action_id, conversation_id, params, status, response) values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)`, [
      uuid(), org.id, out.action.id, conv.id, out.action.params, out.action.ok ? 'ok' : 'error', { data: out.action.result ?? null },
    ]);
  }
  return out;
}

export async function createDraft(conv: Conversation, question: string, draft: string, citations: unknown[], confidence: number) {
  const id = uuid();
  await ctx.db.query(`insert into ai_drafts (id, org_id, conversation_id, question, draft, citations, confidence) values ($1, $2, $3, $4, $5, $6::jsonb, $7)`, [
    id, conv.org_id, conv.id, question, draft, citations, confidence,
  ]);
  const row = await ctx.db.one('select * from ai_drafts where id = $1', [id]);
  publish(`org:${conv.org_id}`, 'draft.created', row);
  return row;
}

/** Human approves (optionally edits) an AI draft. Edits become new knowledge: the AI learns from the team. */
export async function decideDraft(org: Org, conv: Conversation, draftId: string, userId: string, decision: 'send' | 'discard', finalText?: string) {
  const draft = await ctx.db.one<{ id: string; draft: string; question: string; citations: unknown[]; status: string }>(
    `select * from ai_drafts where id = $1 and conversation_id = $2`,
    [draftId, conv.id],
  );
  if (!draft || draft.status !== 'pending') throw new Error('Draft not found or already decided');
  if (decision === 'discard') {
    await ctx.db.query(`update ai_drafts set status = 'discarded', edited_by = $2, decided_at = now() where id = $1`, [draftId, userId]);
  } else {
    const text = (finalText ?? draft.draft).trim();
    const edited = text !== draft.draft.trim();
    await ctx.db.query(`update ai_drafts set status = $2, final = $3, edited_by = $4, decided_at = now() where id = $1`, [draftId, edited ? 'edited' : 'sent', text, userId]);
    await addMessage(conv, edited ? 'human' : 'ai', text, { citations: edited ? [] : draft.citations, authorId: userId, meta: { approvedDraft: draftId } });
    if (edited && draft.question) await learn(org.id, draft.question, text, userId);
    await setStatus(conv, org.settings.mode === 'draft' ? 'ai' : 'human', { assigned_to: userId });
  }
  publish(`org:${org.id}`, 'draft.updated', { id: draftId, conversationId: conv.id });
}

/** Store a team-approved Q&A pair in the org's "Learned from your team" knowledge source. */
export async function learn(orgId: string, question: string, answerText: string, userId: string) {
  let source = await ctx.db.one<{ id: string }>(`select id from knowledge_sources where org_id = $1 and type = 'learned'`, [orgId]);
  if (!source) {
    source = { id: uuid() };
    await ctx.db.query(
      `insert into knowledge_sources (id, org_id, type, title, status, last_synced_at) values ($1, $2, 'learned', 'Learned from your team', 'ready', now())`,
      [source.id, orgId],
    );
  }
  const content = `Q: ${question.trim()}\nA: ${answerText.trim()}`;
  const embedder = getEmbedder();
  const [vec] = await embedder.embed([content]);
  await ctx.db.query(
    `insert into chunks (id, org_id, source_id, position, title, content, embedding, embed_model) values ($1, $2, $3, 0, 'Team answer', $4, $5::vector, $6)`,
    [uuid(), orgId, source.id, content, toVectorLiteral(vec!), embedder.id],
  );
  await ctx.db.query(`update knowledge_sources set chunk_count = chunk_count + 1, last_synced_at = now() where id = $1`, [source.id]);
  await ctx.db.query('delete from answer_cache where org_id = $1', [orgId]);
  await audit(orgId, userId, 'knowledge.learned', source.id, { question: truncate(question, 120) });
}

/** Human-in-the-loop verification for sensitive Actions (refunds, cancellations, address changes). */
export async function decideActionRun(org: Org, runId: string, userId: string, approve: boolean) {
  const run = await ctx.db.one<{ id: string; action_id: string; conversation_id: string; params: Record<string, string>; status: string }>(
    `select * from action_runs where id = $1 and org_id = $2`,
    [runId, org.id],
  );
  if (!run || run.status !== 'pending_approval') throw new Error('Action run not found or already decided');
  const conv = (await getConversation(org.id, run.conversation_id))!;
  const action = (await loadActions(org.id, false)).find((a) => a.id === run.action_id);
  if (!approve || !action) {
    await ctx.db.query(`update action_runs set status = 'rejected', approved_by = $2 where id = $1`, [runId, userId]);
    await addMessage(conv, 'system', `Action "${action?.name ?? 'unknown'}" was rejected by the team.`);
    await audit(org.id, userId, 'action.rejected', runId, {});
    return { ok: false };
  }
  const result = await executeAction(action, run.params);
  await ctx.db.query(`update action_runs set status = $2, response = $3::jsonb, error = $4, latency_ms = $5, approved_by = $6 where id = $1`, [
    runId, result.ok ? 'ok' : 'error', { data: result.data ?? null }, result.error ?? null, result.latencyMs, userId,
  ]);
  await audit(org.id, userId, 'action.approved', runId, { action: action.name, ok: result.ok });
  if (result.ok) {
    await addMessage(conv, 'ai', renderTemplate(action.response_template, result.data), { authorId: userId, meta: { kind: 'action', action: { name: action.name, ok: true } } });
    await setStatus(conv, 'ai');
  } else {
    await addMessage(conv, 'system', `Action "${action.name}" failed: ${result.error}`);
  }
  return { ok: result.ok, result };
}
