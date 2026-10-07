import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import { ctx } from './ctx.ts';
import { verifyJwt } from './lib/crypto.ts';
import { getOrg, type Org } from './services/orgs.ts';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** viewer = read-only guest of the public demo workspace. */
export type Role = 'owner' | 'admin' | 'agent' | 'viewer';

export type AppEnv = {
  Variables: {
    user: SessionUser;
    org: Org;
    role: Role;
  };
};

export const SESSION_COOKIE = 'relay_session';
export const ORG_COOKIE = 'relay_org';

export function fail(status: 400 | 401 | 403 | 404 | 409 | 429 | 500, message: string): never {
  throw new HTTPException(status, { message });
}

export async function body<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    fail(400, 'Expected a JSON body');
  }
  const r = schema.safeParse(data);
  if (!r.success) fail(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
}

/** Cookie session + CSRF guard: state-changing requests must carry a custom header (blocked cross-site without CORS). */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-relay-csrf') !== '1') fail(403, 'Missing CSRF header');
  const jwt = getCookie(c, SESSION_COOKIE) ?? c.req.header('authorization')?.replace(/^Bearer /, '');
  const claims = jwt ? await verifyJwt<{ sub: string; typ: string }>(jwt) : null;
  if (!claims || claims.typ !== 'user') fail(401, 'Not signed in');
  const user = await ctx.db.one<SessionUser>('select id, email, name from users where id = $1', [claims.sub]);
  if (!user) fail(401, 'Not signed in');
  c.set('user', user);
  await next();
};

export const requireOrg: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  const wanted = c.req.header('x-org-id') ?? getCookie(c, ORG_COOKIE);
  const memberships = await ctx.db.query<{ org_id: string; role: Role }>('select org_id, role from members where user_id = $1 order by created_at', [user.id]);
  const m = memberships.find((x) => x.org_id === wanted) ?? memberships[0];
  if (!m) fail(403, 'You are not a member of any workspace');
  const org = await getOrg(m.org_id);
  if (!org) fail(404, 'Workspace not found');
  c.set('org', org);
  c.set('role', m.role);
  if (m.role === 'viewer' && VIEWER_HIDDEN.some((p) => c.req.path.startsWith(p))) fail(403, 'Not available in the demo workspace.');
  if (m.role === 'viewer' && c.req.method !== 'GET' && c.req.method !== 'HEAD' && !VIEWER_WRITES.some((p) => c.req.path.startsWith(p))) {
    fail(403, 'The demo workspace is read-only. Create your free workspace to try this with your own data.');
  }
  await next();
};

/** The few non-GET calls a read-only demo guest may make (they change nothing that other visitors see). */
const VIEWER_WRITES = ['/api/knowledge/ask', '/api/inbox/presence', '/api/me/switch-org'];

/** Admin-only data a demo guest must not read even though it is GET. */
const VIEWER_HIDDEN = ['/api/workspace/team', '/api/workspace/audit', '/api/workspace/privacy', '/api/workspace/model', '/api/billing'];

const rank: Record<Role, number> = { viewer: 0, agent: 1, admin: 2, owner: 3 };

export function requireRole(min: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (rank[c.get('role')] < rank[min]) fail(403, `Requires ${min} role`);
    await next();
  };
}
