import { ctx } from '../ctx.ts';
import { uuid } from '../lib/crypto.ts';
import { publish } from '../lib/events.ts';
import type { AnswerOutput } from '../engine/answer.ts';

/**
 * Agent observability. Every agent decision (front desk answer, booking step, safety stop, report intake,
 * findings review, follow-up, call) is recorded with its steps, cost and procedural tags, so the admin
 * console can show success rates, failure causes and cost per response.
 */

export type AgentName = 'frontdesk' | 'booking' | 'safety' | 'actions' | 'intake' | 'findings' | 'investigations' | 'followup' | 'telecaller' | 'queue' | 'channel' | 'jobs';

export interface RunInput {
  orgId: string | null;
  agent: AgentName;
  trigger: string;
  status: 'ok' | 'handoff' | 'failed';
  outcome?: string;
  tags?: string[];
  steps?: { name: string; detail?: string }[];
  conversationId?: string | null;
  clientId?: string | null;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costInr?: number;
  latencyMs?: number;
  complexity?: 1 | 2 | 3;
}

/**
 * Live agent activity: every agent decision is pushed to the workspace dashboard, and — for
 * workspaces with `showAgentTrace` (demo and sandboxes) — to the patient's own chat as well.
 */
async function shareActivity(r: RunInput) {
  if (!r.orgId) return;
  const activity = { agent: r.agent, status: r.status, outcome: r.outcome ?? '', steps: r.steps ?? [], latencyMs: Math.round(r.latencyMs ?? 0), conversationId: r.conversationId ?? null, clientId: r.clientId ?? null, at: new Date().toISOString() };
  publish(`org:${r.orgId}`, 'agent.activity', activity);
  if (!r.conversationId) return;
  const row = await ctx.db.one<{ show: boolean | null }>(`select (settings->>'showAgentTrace')::boolean as show from orgs where id = $1`, [r.orgId]);
  if (row?.show) publish(`conv:${r.conversationId}`, 'agents', activity);
}

export async function recordRun(r: RunInput) {
  try {
    await ctx.db.query(
      `insert into agent_runs (id, org_id, agent, trigger, conversation_id, client_id, status, outcome, tags, steps, provider, model, input_tokens, output_tokens, cost_inr, latency_ms, complexity)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16, $17)`,
      [
        uuid(), r.orgId, r.agent, r.trigger, r.conversationId ?? null, r.clientId ?? null, r.status, (r.outcome ?? '').slice(0, 300), r.tags ?? [], r.steps ?? [],
        r.provider ?? null, r.model ?? null, r.inputTokens ?? 0, r.outputTokens ?? 0, r.costInr ?? 0, Math.round(r.latencyMs ?? 0), r.complexity ?? 1,
      ],
    );
    if (r.status === 'failed') publish('platform', 'agent.failed', { agent: r.agent, tags: r.tags });
    await shareActivity(r);
  } catch (e) {
    console.error('[agents] could not record run', (e as Error).message);
  }
}

/** Map an answer-pipeline result to agent, status, procedural tags and steps. */
export function describeAnswer(out: AnswerOutput, historyTurns: number): Pick<RunInput, 'agent' | 'status' | 'tags' | 'steps' | 'outcome' | 'complexity' | 'provider' | 'model'> {
  const reason = out.reason ?? '';
  const tags: string[] = [];
  let agent: AgentName = 'frontdesk';
  if (reason === 'emergency' || reason === 'medical_advice') agent = 'safety';
  else if (out.kind === 'flow' || reason === 'appointment_change' || reason === 'no_slots' || reason === 'followup_worse') agent = reason === 'followup_worse' ? 'followup' : 'booking';
  else if (out.kind === 'action' || out.kind === 'action_pending' || out.kind === 'ask_param' || reason.startsWith('action_failed')) agent = 'actions';

  let status: RunInput['status'] = out.kind === 'handoff' ? 'handoff' : 'ok';
  if (reason.startsWith('engine_error')) {
    status = 'failed';
    tags.push(/timeout|abort/i.test(reason) ? 'llm.timeout' : /401|403|key|auth/i.test(reason) ? 'llm.auth' : /429|rate/i.test(reason) ? 'llm.rate_limited' : 'llm.error');
  } else if (reason === 'model_refused') {
    status = 'failed';
    tags.push('llm.refused');
  } else if (reason.startsWith('action_failed')) {
    status = 'failed';
    tags.push(/schema|missing|undefined/i.test(reason) ? 'action.schema_drift' : /\b(4\d\d|5\d\d)\b/.test(reason) ? 'action.http_error' : 'action.error');
  } else if (reason.startsWith('low_confidence')) tags.push('handoff.low_confidence');
  else if (reason) tags.push(`handoff.${reason.replace(/[^a-z_]/gi, '_').toLowerCase()}`);
  if (out.kind === 'answer' && !out.citations.length) tags.push('retrieval.uncited');
  if (/cached/.test(out.engine)) tags.push('cache.hit');
  if (/budget cap/.test(out.engine)) tags.push('budget.capped');

  const steps = [
    { name: 'detect_language', detail: out.lang },
    { name: 'safety_screen', detail: agent === 'safety' ? reason : 'clear' },
    ...(agent === 'booking' ? [{ name: 'visit_flow', detail: out.text.slice(0, 80) }] : []),
    ...(out.action ? [{ name: `action:${out.action.name}`, detail: out.action.ok === false ? 'failed' : out.kind }] : []),
    ...(out.kind === 'answer' || reason.startsWith('low_confidence') || reason === 'not_in_knowledge' || reason === 'no_knowledge'
      ? [{ name: 'retrieve', detail: `${out.citations.length} cited` }, { name: 'generate', detail: out.engine }, { name: 'confidence_gate', detail: out.confidence.toFixed(2) }]
      : []),
    { name: 'outcome', detail: out.kind },
  ];
  const [provider, model] = out.engine.includes(':') ? out.engine.replace(/ \(cached\)$/, '').split(':') : [out.engine.split(' ')[0], null];
  const complexity: 1 | 2 | 3 = agent === 'safety' || reason === 'followup_worse' || out.kind === 'action_pending' ? 3 : agent === 'booking' || agent === 'actions' || historyTurns > 2 ? 2 : 1;
  return { agent, status, tags, steps, outcome: out.kind === 'handoff' ? `handoff: ${reason}` : out.kind, complexity, provider: provider ?? null, model: model ?? null };
}
