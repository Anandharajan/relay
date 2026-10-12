import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireOrg, requireRole, requireUser, type AppEnv } from '../http.ts';

/**
 * Mock hospital lab system (LIS) for the demo workspace. Its Actions call these endpoints, so
 * lab report lookups and home-collection cancellations work end to end without a real backend.
 * Everything here is synthetic.
 */
export const demoStoreApi = new Hono();

const tests = ['Complete blood count', 'HbA1c', 'Lipid profile', 'Thyroid profile (TSH)', 'Renal function test', 'Urine culture'];
const statuses = ['Sample collected', 'Processing', 'Ready', 'Ready'];
const cancelled = new Set<string>();
/** Toggled from the dashboard to demonstrate self-healing Actions (the API "changes shape"). */
let schemaV2 = false;

function report(id: string) {
  const n = Number(id.replace(/\D/g, '')) || 0;
  const test = tests[n % tests.length]!;
  const status = cancelled.has(id) ? 'Home collection cancelled' : test === 'Urine culture' && n % 2 ? 'Processing (culture takes 48–72 hours)' : statuses[n % statuses.length]!;
  const ready = status === 'Ready';
  const note = ready ? 'The report has been sent to your registered WhatsApp number and is ready for your doctor.' : 'You will get it on WhatsApp as soon as it is ready.';
  return schemaV2
    ? { lab_id: id, investigation: test, result_status: status, remarks: note, collected_at: new Date(Date.now() - 6 * 3600_000).toISOString() }
    : { id, test, status, note, collected_at: new Date(Date.now() - 6 * 3600_000).toISOString() };
}

demoStoreApi.get('/lab/:id', (c) => {
  const id = c.req.param('id').toUpperCase().replace(/^LAB-?/, 'LAB-');
  if (!/^LAB-\d{3,6}$/.test(id)) return c.json({ error: 'Report not found' }, 404);
  return c.json(report(id));
});

demoStoreApi.post('/lab/:id/cancel', (c) => {
  const id = c.req.param('id').toUpperCase().replace(/^LAB-?/, 'LAB-');
  if (!/^LAB-\d{3,6}$/.test(id)) return c.json({ error: 'Report not found' }, 404);
  cancelled.add(id);
  return c.json(report(id));
});

/** Dashboard toggle (demo workspace admins) to make the mock API change its response schema. */
export const demoControl = new Hono<AppEnv>();
demoControl.use(requireUser, requireOrg);
demoControl.get('/drift', (c) => c.json({ schemaV2 }));
demoControl.post('/drift', requireRole('admin'), async (c) => {
  schemaV2 = (await body(c, z.object({ on: z.boolean() }))).on;
  return c.json({ schemaV2 });
});
