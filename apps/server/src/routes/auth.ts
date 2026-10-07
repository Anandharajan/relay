import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { config } from '../config.ts';
import { ctx } from '../ctx.ts';
import { hashPassword, signJwt, uuid, verifyPassword } from '../lib/crypto.ts';
import { rateLimit } from '../lib/ratelimit.ts';
import { body, fail, ORG_COOKIE, requireOrg, requireUser, SESSION_COOKIE, type AppEnv } from '../http.ts';
import { audit, createOrg } from '../services/orgs.ts';

export const auth = new Hono<AppEnv>();

const secure = config.publicUrl.startsWith('https://');

async function startSession(c: any, userId: string) {
  const jwt = await signJwt({ sub: userId, typ: 'user' }, '30d');
  setCookie(c, SESSION_COOKIE, jwt, { httpOnly: true, sameSite: 'Lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30 });
}

function limit(c: any, key: string) {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'local';
  if (!rateLimit(`auth:${key}:${ip}`, 20, 15 * 60_000).ok) fail(429, 'Too many attempts, try again later');
}

auth.post('/signup', async (c) => {
  limit(c, 'signup');
  const b = await body(
    c,
    z.object({
      email: z.string().email().max(200),
      password: z.string().min(8).max(200),
      name: z.string().min(1).max(100),
      orgName: z.string().max(100).optional(),
      inviteToken: z.string().optional(),
    }),
  );
  const email = b.email.toLowerCase().trim();
  const invite = b.inviteToken
    ? await ctx.db.one<{ token: string; org_id: string; email: string; role: string }>('select * from invites where token = $1 and accepted_at is null', [b.inviteToken])
    : undefined;
  if (b.inviteToken && !invite) fail(400, 'Invite link is invalid or already used');
  if (!config.allowSignup && !invite) fail(403, 'Sign-ups are closed on this server');
  if (await ctx.db.one('select 1 from users where email = $1', [email])) fail(409, 'An account with this email already exists');

  const userId = uuid();
  await ctx.db.query('insert into users (id, email, name, password_hash) values ($1, $2, $3, $4)', [userId, email, b.name.trim(), await hashPassword(b.password)]);
  if (invite) {
    await ctx.db.query('insert into members (org_id, user_id, role) values ($1, $2, $3) on conflict do nothing', [invite.org_id, userId, invite.role]);
    await ctx.db.query('update invites set accepted_at = now() where token = $1', [invite.token]);
    await audit(invite.org_id, userId, 'member.joined', userId, { role: invite.role });
    setCookie(c, ORG_COOKIE, invite.org_id, { path: '/', sameSite: 'Lax', secure });
  } else {
    const org = await createOrg(b.orgName?.trim() || `${b.name.trim()}'s workspace`, userId);
    setCookie(c, ORG_COOKIE, org.id, { path: '/', sameSite: 'Lax', secure });
  }
  await startSession(c, userId);
  return c.json({ ok: true });
});

auth.post('/login', async (c) => {
  limit(c, 'login');
  const b = await body(c, z.object({ email: z.string(), password: z.string() }));
  const user = await ctx.db.one<{ id: string; password_hash: string }>('select id, password_hash from users where email = $1', [b.email.toLowerCase().trim()]);
  if (!user || !(await verifyPassword(b.password, user.password_hash))) fail(401, 'Wrong email or password');
  await startSession(c, user.id);
  return c.json({ ok: true });
});

auth.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

auth.get('/invite/:token', async (c) => {
  const inv = await ctx.db.one<{ email: string; role: string; org_name: string }>(
    'select i.email, i.role, o.name as org_name from invites i join orgs o on o.id = i.org_id where i.token = $1 and i.accepted_at is null',
    [c.req.param('token')],
  );
  if (!inv) fail(404, 'Invite not found');
  return c.json(inv);
});

/** Accept an invite with an existing account. */
auth.post('/invite/:token/accept', requireUser, async (c) => {
  const inv = await ctx.db.one<{ token: string; org_id: string; role: string }>('select * from invites where token = $1 and accepted_at is null', [c.req.param('token')]);
  if (!inv) fail(404, 'Invite not found');
  const user = c.get('user');
  await ctx.db.query('insert into members (org_id, user_id, role) values ($1, $2, $3) on conflict do nothing', [inv.org_id, user.id, inv.role]);
  await ctx.db.query('update invites set accepted_at = now() where token = $1', [inv.token]);
  setCookie(c, ORG_COOKIE, inv.org_id, { path: '/', sameSite: 'Lax', secure });
  return c.json({ ok: true });
});

export const me = new Hono<AppEnv>();
me.use(requireUser, requireOrg);

me.get('/', async (c) => {
  const user = c.get('user');
  const org = c.get('org');
  const orgs = await ctx.db.query('select o.id, o.name, m.role from members m join orgs o on o.id = m.org_id where m.user_id = $1 order by m.created_at', [user.id]);
  return c.json({
    user,
    role: c.get('role'),
    org: { id: org.id, name: org.name, plan: org.plan, siteKey: org.site_key, settings: org.settings, whatsappConnected: Boolean(org.secrets.whatsappToken) },
    orgs,
    server: { mode: config.mode, publicUrl: config.publicUrl, billing: Boolean(config.razorpay.keyId) },
  });
});

me.post('/switch-org', async (c) => {
  const b = await body(c, z.object({ orgId: z.string().uuid() }));
  const m = await ctx.db.one('select 1 from members where org_id = $1 and user_id = $2', [b.orgId, c.get('user').id]);
  if (!m) fail(403, 'Not a member');
  setCookie(c, ORG_COOKIE, b.orgId, { path: '/', sameSite: 'Lax', secure });
  return c.json({ ok: true });
});

me.post('/orgs', async (c) => {
  const b = await body(c, z.object({ name: z.string().min(1).max(100) }));
  const org = await createOrg(b.name, c.get('user').id);
  setCookie(c, ORG_COOKIE, org.id, { path: '/', sameSite: 'Lax', secure });
  return c.json({ id: org.id });
});
