import { uuid } from '../lib/crypto.ts';
import { publish } from '../lib/events.ts';
import { recordRun } from '../services/agents.ts';
import type { Org } from '../services/orgs.ts';

/**
 * The run framework shared by every agent pipeline: agents grouped in stages, real timings,
 * a report that fills in section by section, and each change streamed on `run:<id>`.
 * Runs live in memory for an hour (they are views of work; the durable results are stored by the agents).
 */

export type AgentStatus = 'waiting' | 'working' | 'done' | 'failed' | 'skipped';
export interface PipelineAgent {
  id: string;
  role: string;
  action: string;
  stage: number;
  status: AgentStatus;
  startedAt?: string;
  endedAt?: string;
  ms?: number;
  result?: string;
}
export interface ReportSection {
  id: string;
  title: string;
  kind: 'reply' | 'text' | 'list' | 'table' | 'callout' | 'chips';
  tone?: 'ok' | 'warn' | 'bad' | 'info';
  body?: string;
  items?: string[];
  rows?: string[][];
  head?: string[];
}
export interface PipelineRun {
  id: string;
  orgId: string;
  kind: 'message' | 'report' | 'day' | 'copilot';
  /** For copilot runs: the conversation being worked on. */
  conversationId?: string;
  title: string;
  status: 'running' | 'done' | 'failed';
  stages: string[];
  agents: PipelineAgent[];
  report: ReportSection[];
  startedAt: string;
  endedAt?: string;
  ms?: number;
  public: boolean;
  data?: Record<string, unknown>;
}

const runs = new Map<string, PipelineRun>();
const TTL = 60 * 60_000;
function gc() {
  const cut = Date.now() - TTL;
  for (const [id, r] of runs) if (new Date(r.startedAt).getTime() < cut) runs.delete(id);
}

export function getRun(id: string) {
  return runs.get(id);
}

/** The newest run for a conversation (doctor copilot). */
export function latestForConversation(orgId: string, conversationId: string) {
  let best: PipelineRun | undefined;
  for (const r of runs.values()) if (r.orgId === orgId && r.conversationId === conversationId && (!best || r.startedAt > best.startedAt)) best = r;
  return best ? snapshot(best) : null;
}

export function recentRuns(orgId: string, limit = 8) {
  return [...runs.values()].filter((r) => r.orgId === orgId && !r.public).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit).map(snapshot);
}

/** What the browser sees (internal data stays on the server). */
export function snapshot(r: PipelineRun) {
  const { data: _d, ...rest } = r;
  return rest;
}

export function emit(r: PipelineRun) {
  publish(`run:${r.id}`, 'run', snapshot(r));
}

export function section(r: PipelineRun, s: ReportSection) {
  const i = r.report.findIndex((x) => x.id === s.id);
  if (i >= 0) r.report[i] = s;
  else r.report.push(s);
  emit(r);
}

/** Run one agent: mark it working, do the work, record its real duration and a one-line result. */
export async function agent<T>(r: PipelineRun, id: string, fn: () => Promise<{ result: string; value?: T } | null>): Promise<T | undefined> {
  const a = r.agents.find((x) => x.id === id)!;
  a.status = 'working';
  a.startedAt = new Date().toISOString();
  emit(r);
  const t0 = performance.now();
  try {
    const out = await fn();
    a.ms = Math.round(performance.now() - t0);
    a.endedAt = new Date().toISOString();
    if (!out) {
      a.status = 'skipped';
      a.result = 'Not needed for this input';
    } else {
      a.status = 'done';
      a.result = out.result;
    }
    emit(r);
    return out?.value;
  } catch (e) {
    a.ms = Math.round(performance.now() - t0);
    a.endedAt = new Date().toISOString();
    a.status = 'failed';
    a.result = (e as Error).message.slice(0, 160);
    emit(r);
    return undefined;
  }
}

export function skip(r: PipelineRun, ids: string[], why: string) {
  for (const id of ids) {
    const a = r.agents.find((x) => x.id === id);
    if (a && a.status === 'waiting') {
      a.status = 'skipped';
      a.result = why;
    }
  }
  emit(r);
}

export function newRun(org: Org, kind: PipelineRun['kind'], title: string, stages: string[], agents: Omit<PipelineAgent, 'status'>[], isPublic: boolean): PipelineRun {
  gc();
  const r: PipelineRun = {
    id: uuid(), orgId: org.id, kind, title, status: 'running', stages,
    agents: agents.map((a) => ({ ...a, status: 'waiting' })), report: [], startedAt: new Date().toISOString(), public: isPublic,
  };
  runs.set(r.id, r);
  return r;
}

export async function finish(r: PipelineRun, failed = false) {
  r.status = failed ? 'failed' : 'done';
  r.endedAt = new Date().toISOString();
  r.ms = new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime();
  emit(r);
  const bad = r.agents.filter((a) => a.status === 'failed');
  await recordRun({
    orgId: r.orgId,
    agent: 'pipeline' as any,
    trigger: `${r.kind}${r.public ? ':public' : ''}`,
    status: bad.length ? 'failed' : 'ok',
    outcome: `${r.kind} pipeline · ${r.agents.filter((a) => a.status === 'done').length} agents · ${r.ms} ms`,
    tags: bad.map((a) => `pipeline.${a.id}.failed`),
    steps: r.agents.map((a) => ({ name: a.id, detail: `${a.status}${a.ms !== undefined ? ` ${a.ms}ms` : ''}` })),
    latencyMs: r.ms,
    complexity: r.kind === 'message' ? 1 : r.kind === 'copilot' ? 2 : 3,
  });
}

