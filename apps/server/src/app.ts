import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import { config } from './config.ts';
import { ctx } from './ctx.ts';
import { auth, me } from './routes/auth.ts';
import { workspace } from './routes/workspace.ts';
import { knowledge } from './routes/knowledge.ts';
import { inbox } from './routes/inbox.ts';
import { simulations } from './routes/simulations.ts';
import { actionsApi } from './routes/actions.ts';
import { analytics } from './routes/analytics.ts';
import { billing, razorpayWebhook } from './routes/billing.ts';
import { widget } from './routes/widget.ts';
import { demoControl, demoStoreApi } from './routes/demo.ts';
import { whatsapp } from './channels/whatsapp.ts';
import { demoSiteKey } from './seed.ts';

export function buildApp() {
  const app = new Hono();

  // Cross-origin resource policy must allow widget.js to load on customers' sites.
  app.use('*', secureHeaders({ crossOriginResourcePolicy: 'cross-origin', crossOriginOpenerPolicy: false, xFrameOptions: 'SAMEORIGIN' }));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    // Malformed ids (e.g. a non-UUID in the URL) are a client error, not a server failure.
    if ((err as { code?: string })?.code === '22P02') return c.json({ error: 'Not found' }, 404);
    console.error('[http]', c.req.method, c.req.path, err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  app.get('/healthz', async (c) => {
    await ctx.db.one('select 1 as ok');
    return c.json({ ok: true, db: ctx.db.kind, mode: config.mode });
  });

  app.get('/api/public/config', async (c) =>
    c.json({ demoSiteKey: await demoSiteKey(), allowSignup: config.allowSignup, mode: config.mode, demoEmail: config.demo.seed ? config.demo.email : null }),
  );

  app.route('/api/auth', auth);
  app.route('/api/me', me);
  app.route('/api/workspace', workspace);
  app.route('/api/knowledge', knowledge);
  app.route('/api/inbox', inbox);
  app.route('/api/simulations', simulations);
  app.route('/api/actions', actionsApi);
  app.route('/api/analytics', analytics);
  app.route('/api/billing', billing);
  app.route('/api/demo', demoControl);
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  app.route('/widget', widget);
  app.route('/webhooks/razorpay', razorpayWebhook);
  app.route('/webhooks/whatsapp', whatsapp);
  app.route('/demo-api', demoStoreApi);

  // Dashboard PWA, landing page and widget.js (built by apps/web + apps/widget).
  if (existsSync(config.staticDir)) {
    const root = config.staticDir;
    app.use('/assets/*', async (c, next) => {
      await next();
      c.header('cache-control', 'public, max-age=31536000, immutable');
    });
    app.use('/widget.js', async (c, next) => {
      await next();
      c.header('cache-control', 'public, max-age=300');
      c.header('access-control-allow-origin', '*');
    });
    app.use('*', serveStatic({ root }));
    const index = join(root, 'index.html');
    app.get('*', (c) => (existsSync(index) ? c.html(readFileSync(index, 'utf8')) : c.notFound()));
  } else {
    app.get('/', (c) => c.text(`Relay API is running. Build the dashboard with "pnpm build" (looked for ${config.staticDir}).`));
  }
  return app;
}
