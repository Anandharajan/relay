import { Hono } from 'hono';
import { z } from 'zod';
import { ctx } from '../ctx.ts';
import { uuid } from '../lib/crypto.ts';
import { body, fail, requireOrg, requireRole, requireUser, type AppEnv } from '../http.ts';
import { enqueue } from '../jobs/runner.ts';
import { generateQuestions } from '../jobs/simulate.ts';

export const simulations = new Hono<AppEnv>();
simulations.use(requireUser, requireOrg);

simulations.get('/', async (c) => {
  return c.json(await ctx.db.query('select * from simulations where org_id = $1 order by created_at desc limit 50', [c.get('org').id]));
});

simulations.get('/:id', async (c) => {
  const sim = await ctx.db.one('select * from simulations where id = $1 and org_id = $2', [c.req.param('id'), c.get('org').id]);
  if (!sim) fail(404, 'Simulation not found');
  const cases = await ctx.db.query('select * from simulation_cases where simulation_id = $1 order by position', [sim.id]);
  return c.json({ simulation: sim, cases });
});

/** Parse "question => expected" lines. */
function parseLines(text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [q, e] = l.split(/\s*=>\s*/);
      return { question: q!.trim(), expected: e?.trim() || null };
    });
}

simulations.post('/', requireRole('admin'), async (c) => {
  const org = c.get('org');
  const b = await body(c, z.object({ name: z.string().max(100).optional(), questions: z.string().max(100_000).optional(), generate: z.number().int().min(1).max(100).optional() }));
  let cases = b.questions ? parseLines(b.questions) : [];
  if (!cases.length && b.generate) cases = await generateQuestions(org.id, b.generate);
  if (!cases.length) fail(400, 'Add at least one question (or add knowledge first to auto-generate)');
  if (cases.length > 200) fail(400, 'Max 200 questions per simulation');
  const id = uuid();
  await ctx.db.query('insert into simulations (id, org_id, name, total) values ($1, $2, $3, $4)', [id, org.id, b.name?.trim() || `Simulation ${new Date().toLocaleString('en-IN')}`, cases.length]);
  for (let i = 0; i < cases.length; i++) {
    await ctx.db.query('insert into simulation_cases (id, simulation_id, position, question, expected) values ($1, $2, $3, $4, $5)', [uuid(), id, i, cases[i]!.question, cases[i]!.expected]);
  }
  await enqueue('simulate', { simulationId: id });
  return c.json({ id });
});

simulations.delete('/:id', requireRole('admin'), async (c) => {
  await ctx.db.query('delete from simulations where id = $1 and org_id = $2', [c.req.param('id'), c.get('org').id]);
  return c.json({ ok: true });
});
