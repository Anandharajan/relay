import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { signJwt, uuid, verifyJwt } from '../lib/crypto.ts';
import { subscribe, type RelayEvent } from '../lib/events.ts';
import { rateLimit } from '../lib/ratelimit.ts';
import { body, fail } from '../http.ts';
import { getOrg, getOrgBySiteKey, type Org } from '../services/orgs.ts';
import {
  addMessage, createConversation, getConversation, handleCustomerMessage, publicMessage, resolve, setStatus, type Conversation, type Message,
} from '../services/conversations.ts';

type WidgetEnv = { Variables: { org: Org; visitorId: string } };

/** Public API used by widget.js on customers' websites. Auth: site key → per-visitor JWT. */
export const widget = new Hono<WidgetEnv>();
widget.use('*', cors({ origin: '*', allowHeaders: ['content-type', 'authorization'], allowMethods: ['GET', 'POST', 'OPTIONS'], maxAge: 86400 }));

function originAllowed(org: Org, origin: string | undefined): boolean {
  const list = org.settings.allowedOrigins.filter(Boolean);
  if (!list.length || !origin) return true;
  if (origin === config.publicUrl) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return list.some((entry) => {
    const e = entry.trim().replace(/\/$/, '');
    if (e === origin) return true;
    const pattern = e.replace(/^https?:\/\//, '');
    return pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) || host === pattern.slice(2) : host === pattern;
  });
}

async function visitorAuth(c: Context<WidgetEnv>, tokenValue?: string) {
  const jwt = tokenValue ?? c.req.header('authorization')?.replace(/^Bearer /, '');
  const claims = jwt ? await verifyJwt<{ sub: string; org: string; typ: string }>(jwt) : null;
  if (!claims || claims.typ !== 'visitor') fail(401, 'Invalid visitor session');
  const org = await getOrg(claims.org);
  if (!org) fail(401, 'Unknown workspace');
  c.set('org', org);
  c.set('visitorId', claims.sub);
}

async function visitorConversation(c: Context<WidgetEnv>, id?: string | null): Promise<Conversation | undefined> {
  const org = c.get('org');
  if (id) {
    const conv = await getConversation(org.id, id);
    if (!conv || conv.visitor_id !== c.get('visitorId')) fail(404, 'Conversation not found');
    return conv;
  }
  return ctx.db.one<Conversation>(
    `select * from conversations where org_id = $1 and visitor_id = $2 and channel = 'web' and (status <> 'resolved' or resolved_at > now() - interval '30 minutes') order by created_at desc limit 1`,
    [org.id, c.get('visitorId')],
  );
}

widget.post('/session', async (c) => {
  const b = await body(c, z.object({ siteKey: z.string().max(64), token: z.string().max(2000).optional() }));
  const org = await getOrgBySiteKey(b.siteKey);
  if (!org) fail(404, 'Unknown site key');
  if (!originAllowed(org, c.req.header('origin'))) fail(403, 'This website is not allowed to use this chat widget');
  let visitorId: string | undefined;
  if (b.token) {
    const claims = await verifyJwt<{ sub: string; org: string; typ: string }>(b.token);
    if (claims?.typ === 'visitor' && claims.org === org.id) visitorId = claims.sub;
  }
  visitorId ??= `v_${uuid().replace(/-/g, '').slice(0, 16)}`;
  const token = await signJwt({ sub: visitorId, org: org.id, typ: 'visitor' }, '180d');
  const s = org.settings;
  return c.json({ token, visitorId, config: { name: org.name, botName: s.botName, brandColor: s.brandColor, greeting: s.greeting, consentText: s.consentText } });
});

widget.get('/conversation', async (c) => {
  await visitorAuth(c);
  const conv = await visitorConversation(c);
  if (!conv) return c.json({ conversation: null, messages: [] });
  const messages = await ctx.db.query<Message>(`select * from messages where conversation_id = $1 and role in ('customer', 'ai', 'human') order by created_at`, [conv.id]);
  return c.json({ conversation: { id: conv.id, status: conv.status }, messages: messages.map(publicMessage) });
});

widget.post('/messages', async (c) => {
  await visitorAuth(c);
  const org = c.get('org');
  const visitorId = c.get('visitorId');
  const b = await body(c, z.object({ content: z.string().trim().min(1).max(2000), conversationId: z.string().uuid().optional().nullable(), name: z.string().max(80).optional(), pageUrl: z.string().max(500).optional() }));
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`w:v:${visitorId}`, 20, 60_000).ok || !rateLimit(`w:ip:${ip}`, 40, 60_000).ok || !rateLimit(`w:o:${org.id}`, 600, 60_000).ok) {
    fail(429, 'You are sending messages too quickly. Please wait a moment.');
  }
  let conv = await visitorConversation(c, b.conversationId);
  if (!conv) conv = await createConversation(org, visitorId, 'web', { name: b.name, meta: { pageUrl: b.pageUrl, userAgent: c.req.header('user-agent')?.slice(0, 200) } });
  const msg = await handleCustomerMessage(org, conv, b.content);
  return c.json({ conversationId: conv.id, message: publicMessage(msg) });
});

widget.post('/feedback', async (c) => {
  await visitorAuth(c);
  const b = await body(c, z.object({ conversationId: z.string().uuid(), helpful: z.boolean() }));
  const conv = (await visitorConversation(c, b.conversationId))!;
  if (b.helpful) {
    await resolve(conv, 'ai', 5);
  } else {
    await ctx.db.query('update conversations set csat = 1 where id = $1', [conv.id]);
    if (conv.status === 'ai') {
      await addMessage(conv, 'system', 'Customer said the answer did not help');
      await setStatus(conv, 'escalated');
    }
  }
  return c.json({ ok: true });
});

widget.post('/handoff', async (c) => {
  await visitorAuth(c);
  const b = await body(c, z.object({ conversationId: z.string().uuid() }));
  const conv = (await visitorConversation(c, b.conversationId))!;
  if (conv.status === 'ai' || conv.status === 'resolved') {
    await addMessage(conv, 'system', 'Customer asked for a human');
    await setStatus(conv, 'escalated');
  }
  return c.json({ ok: true });
});

widget.post('/consent', async (c) => {
  await visitorAuth(c);
  const b = await body(c, z.object({ purpose: z.string().max(60).default('support_chat') }));
  const exists = await ctx.db.one('select 1 from consents where org_id = $1 and visitor_id = $2 and purpose = $3 and withdrawn_at is null', [c.get('org').id, c.get('visitorId'), b.purpose]);
  if (!exists) await ctx.db.query('insert into consents (id, org_id, visitor_id, purpose) values ($1, $2, $3, $4)', [uuid(), c.get('org').id, c.get('visitorId'), b.purpose]);
  return c.json({ ok: true });
});

widget.get('/stream', async (c) => {
  await visitorAuth(c, c.req.query('token'));
  const conv = (await visitorConversation(c, c.req.query('conversationId')))!;
  return streamSSE(c, async (stream) => {
    const queue: RelayEvent[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = subscribe(`conv:${conv.id}`, (e) => {
      queue.push(e);
      wake?.();
    });
    let open = true;
    stream.onAbort(() => {
      open = false;
      unsubscribe();
      wake?.();
    });
    while (open) {
      while (queue.length) {
        const e = queue.shift()!;
        await stream.writeSSE({ event: e.type, data: JSON.stringify(e.data) });
      }
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, 25_000);
      });
      wake = null;
      if (!queue.length && open) await stream.writeSSE({ event: 'ping', data: '{}' });
    }
  });
});
