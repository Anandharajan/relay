import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireOrg, requireUser, type AppEnv } from '../http.ts';
import { listNotifications, markRead } from '../services/notify.ts';

/** The signed-in user's own notifications in the current workspace. */
export const notifications = new Hono<AppEnv>();
notifications.use(requireUser, requireOrg);

notifications.get('/', async (c) => c.json(await listNotifications(c.get('org').id, c.get('user').id)));

notifications.post('/read', async (c) => {
  const b = await body(c, z.object({ ids: z.array(z.string().uuid()).max(100).optional() }));
  await markRead(c.get('org').id, c.get('user').id, b.ids);
  return c.json({ ok: true });
});
