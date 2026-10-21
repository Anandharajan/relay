import { ctx } from '../ctx.ts';
import { hashPassword, token, uuid } from '../lib/crypto.ts';
import { buildDemoHospital, DEMO_ORG_NAME } from '../seed.ts';
import type { Org } from './orgs.ts';

/**
 * Private sandboxes: a visitor gets their own copy of the demo hospital and is signed in as
 * Dr. Narmadha Vasu, so they can approve, review and reply without affecting anyone else.
 * Sandboxes and their guest logins are deleted after SANDBOX_TTL_MIN.
 */
export const SANDBOX_TTL_MIN = 60;
const MAX_ACTIVE = 100;
const GUEST_DOMAIN = 'sandbox.relay.invalid';
export const SANDBOX_DOCTOR = 'Dr. Narmadha Vasu';

export interface Sandbox {
  org: Org;
  userId: string;
  expiresAt: Date;
}

export async function activeSandboxes(): Promise<number> {
  const row = await ctx.db.one<{ n: number }>('select count(*)::int as n from orgs where expires_at > now()');
  return row?.n ?? 0;
}

export async function createSandbox(): Promise<Sandbox> {
  if ((await activeSandboxes()) >= MAX_ACTIVE) throw new Error('All demo sandboxes are busy right now. Please try again in a few minutes.');
  const userId = uuid();
  const id = token(6).replace(/[^A-Za-z0-9]/g, 'x').toLowerCase();
  // Random password nobody knows: the guest can only enter through the sandbox endpoint.
  await ctx.db.query('insert into users (id, email, name, password_hash) values ($1, $2, $3, $4)', [userId, `doctor-${id}@${GUEST_DOMAIN}`, SANDBOX_DOCTOR, await hashPassword(token(24))]);
  const org = await buildDemoHospital(`${DEMO_ORG_NAME} · sandbox ${id}`, userId, { sampleChats: false });
  const expiresAt = new Date(Date.now() + SANDBOX_TTL_MIN * 60_000);
  await ctx.db.query('update orgs set expires_at = $2 where id = $1', [org.id, expiresAt]);
  await ctx.db.query('update staff_members set user_id = $2 where org_id = $1 and name = $3', [org.id, userId, SANDBOX_DOCTOR]);
  return { org, userId, expiresAt };
}

/** Job: remove expired sandboxes (cascades to all their data) and their guest logins. */
export async function purgeSandboxes(): Promise<number> {
  const gone = await ctx.db.query<{ id: string }>('delete from orgs where expires_at is not null and expires_at < now() returning id');
  await ctx.db.query(`delete from users where email like $1 and not exists (select 1 from members m where m.user_id = users.id)`, [`%@${GUEST_DOMAIN}`]);
  if (gone.length) console.log(`[cron] removed ${gone.length} expired sandboxes`);
  return gone.length;
}
