import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireOrg, requireRole, requireUser, type AppEnv } from '../http.ts';

/**
 * Mock merchant API for the "Kaapi & Co." demo store. The demo workspace's Actions call these
 * endpoints, so order lookup / cancellation work end to end without any real backend.
 */
export const demoStoreApi = new Hono();

const items = ['Monsoon Malabar 250g', 'Chikmagalur Estate 500g', 'Filter Coffee Kit', 'Cold Brew Bags (10)', 'Coorg Peaberry 250g'];
const statuses = ['Processing', 'Shipped', 'Out for delivery', 'Delivered'];
const cities = ['Bengaluru', 'Mysuru', 'Pune', 'Delhi', 'Chennai', 'Mumbai'];
const cancelled = new Set<string>();
/** Toggled from the dashboard to demonstrate self-healing Actions (the API "changes shape"). */
let schemaV2 = false;

function order(id: string) {
  const n = Number(id.replace(/\D/g, '')) || 0;
  const status = cancelled.has(id) ? 'Cancelled' : statuses[n % statuses.length]!;
  const eta = new Date(Date.now() + ((n % 4) + 1) * 86400_000).toISOString().slice(0, 10);
  const base = { id, item: items[n % items.length], amount_inr: 349 + (n % 7) * 150, city: cities[n % cities.length], courier: n % 2 ? 'Delhivery' : 'Blue Dart', eta: status === 'Delivered' ? null : eta };
  return schemaV2
    ? { order_id: base.id, order_status: status, line_item: base.item, total_inr: base.amount_inr, shipping: { city: base.city, carrier: base.courier, expected_delivery: base.eta } }
    : { ...base, status };
}

demoStoreApi.get('/orders/:id', (c) => {
  const id = c.req.param('id').toUpperCase();
  if (!/^KC-?\d{3,6}$/.test(id)) return c.json({ error: 'Order not found' }, 404);
  return c.json(order(id.replace(/^KC-?/, 'KC-')));
});

demoStoreApi.post('/orders/:id/cancel', (c) => {
  const id = c.req.param('id').toUpperCase().replace(/^KC-?/, 'KC-');
  if (!/^KC-\d{3,6}$/.test(id)) return c.json({ error: 'Order not found' }, 404);
  cancelled.add(id);
  return c.json({ ...order(id), refund: { amount_inr: (order(id) as any).amount_inr ?? (order(id) as any).total_inr, method: 'Original payment method (UPI/card)', eta_days: 5 } });
});

/** Dashboard toggle (demo workspace admins) to make the mock API change its response schema. */
export const demoControl = new Hono<AppEnv>();
demoControl.use(requireUser, requireOrg);
demoControl.get('/drift', (c) => c.json({ schemaV2 }));
demoControl.post('/drift', requireRole('admin'), async (c) => {
  schemaV2 = (await body(c, z.object({ on: z.boolean() }))).on;
  return c.json({ schemaV2 });
});
