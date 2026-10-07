import { ctx } from '../ctx.ts';
import { publish } from '../lib/events.ts';
import { answer } from '../engine/answer.ts';
import { parseJsonObject } from '../engine/actions.ts';
import { getOrg, llmForOrg } from '../services/orgs.ts';

/**
 * Simulations: run a batch of test questions through the real pipeline (dry-run) and report a
 * pass rate before going live. A case passes when the AI answers without escalating and, if an
 * expectation is given, the answer contains it (use "a|b" for alternatives, "a, b" for all-of).
 */
export function judge(kind: string, text: string, expected: string | null): { passed: boolean; reason: string } {
  if (kind === 'handoff') return { passed: false, reason: 'Escalated to a human' };
  if (!expected?.trim()) return { passed: true, reason: 'Answered without escalation' };
  const lower = text.toLowerCase();
  const missing = expected
    .split(',')
    .map((group) => group.split('|').map((s) => s.trim().toLowerCase()).filter(Boolean))
    .filter((alts) => alts.length && !alts.some((a) => lower.includes(a)));
  return missing.length
    ? { passed: false, reason: `Missing expected: ${missing.map((m) => m.join(' or ')).join(', ')}` }
    : { passed: true, reason: 'Answer contains the expected content' };
}

export async function runSimulation({ simulationId }: { simulationId: string }) {
  const sim = await ctx.db.one<{ id: string; org_id: string }>('select * from simulations where id = $1', [simulationId]);
  if (!sim) return;
  const org = (await getOrg(sim.org_id))!;
  await ctx.db.query(`update simulations set status = 'running' where id = $1`, [sim.id]);
  const cases = await ctx.db.query<{ id: string; question: string; expected: string | null }>(
    'select id, question, expected from simulation_cases where simulation_id = $1 order by position',
    [sim.id],
  );
  let passed = 0;
  let done = 0;
  for (const c of cases) {
    const out = await answer({ org, question: c.question, dryRun: true });
    const verdict = judge(out.kind, out.text, c.expected);
    if (verdict.passed) passed++;
    done++;
    await ctx.db.query(
      `update simulation_cases set answer = $2, confidence = $3, citations = $4::jsonb, handoff = $5, passed = $6, reason = $7 where id = $1`,
      [c.id, out.text, out.confidence, out.citations, out.kind === 'handoff', verdict.passed, out.kind === 'handoff' ? `${verdict.reason}: ${out.reason ?? ''}` : verdict.reason],
    );
    await ctx.db.query('update simulations set passed = $2 where id = $1', [sim.id, passed]);
    publish(`org:${org.id}`, 'simulation.progress', { id: sim.id, done, total: cases.length, passed });
  }
  await ctx.db.query(`update simulations set status = 'done', passed = $2, pass_rate = $3, finished_at = now() where id = $1`, [
    sim.id, passed, cases.length ? passed / cases.length : 0,
  ]);
  publish(`org:${org.id}`, 'simulation.progress', { id: sim.id, done, total: cases.length, passed, finished: true });
}

/** Build test questions from the knowledge base: LLM-generated when available, FAQ questions otherwise. */
export async function generateQuestions(orgId: string, n: number): Promise<{ question: string; expected: string | null }[]> {
  const chunks = await ctx.db.query<{ title: string; content: string }>(
    `select title, content from chunks where org_id = $1 order by random() limit 40`,
    [orgId],
  );
  const { llm } = await llmForOrg(orgId);
  if (llm && chunks.length) {
    try {
      const r = await llm.complete(
        'You write realistic customer-support test questions. Reply with JSON only: {"questions": [{"question": string, "expected": string}]} where "expected" is a short key phrase (1-3 words) that a correct answer must contain.',
        [{ role: 'user', content: `Write ${n} varied questions customers would ask, answerable from these help-center excerpts. Include a few in Hindi or Kannada.\n\n${chunks.map((c) => `- ${c.title}: ${c.content.slice(0, 500)}`).join('\n')}` }],
        { maxTokens: 6000 },
      );
      const parsed = parseJsonObject(r.text) as { questions?: { question: string; expected?: string }[] } | null;
      if (parsed?.questions?.length) return parsed.questions.slice(0, n).map((q) => ({ question: q.question, expected: q.expected ?? null }));
    } catch (e) {
      console.warn('[simulate] LLM question generation failed, falling back:', (e as Error).message);
    }
  }
  const out: { question: string; expected: string | null }[] = [];
  for (const c of chunks) {
    for (const m of c.content.matchAll(/^\s*(?:Q|Question|प्रश्न|ಪ್ರಶ್ನೆ)\s*[:.]\s*(.+)$/gim)) out.push({ question: m[1]!.trim(), expected: null });
  }
  if (out.length < n) {
    for (const c of chunks) if (c.title && out.length < n) out.push({ question: `Tell me about ${c.title.toLowerCase()}`, expected: null });
  }
  return out.slice(0, n);
}
