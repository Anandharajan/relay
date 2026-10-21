import { ctx } from '../ctx.ts';
import { hashPassword, token, uuid } from '../lib/crypto.ts';
import { buildDemoHospital, DEMO_ORG_NAME, refreshDemoDay } from '../seed.ts';
import { getOrg, type Org } from './orgs.ts';

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

/** Ready-made sandboxes kept waiting, so a visitor never waits for a hospital to be built. */
export const POOL_SIZE = Math.max(0, Number(process.env.SANDBOX_POOL ?? 2));
/** Pooled sandboxes older than this are rebuilt so their "today" stays today. */
const POOL_MAX_AGE_H = 12;

export async function activeSandboxes(): Promise<number> {
  const row = await ctx.db.one<{ n: number }>(`select count(*)::int as n from orgs where sandbox_state = 'claimed' and expires_at > now()`);
  return row?.n ?? 0;
}

/** Build one sandbox hospital, owned by its own guest doctor login, and put it in the pool. */
export async function buildSandbox(): Promise<string> {
  const userId = uuid();
  const id = token(6).replace(/[^A-Za-z0-9]/g, 'x').toLowerCase();
  // Random password nobody knows: the guest can only enter through the sandbox endpoint.
  await ctx.db.query('insert into users (id, email, name, password_hash) values ($1, $2, $3, $4)', [userId, `doctor-${id}@${GUEST_DOMAIN}`, SANDBOX_DOCTOR, await hashPassword(token(24))]);
  const org = await buildDemoHospital(`${DEMO_ORG_NAME} · sandbox ${id}`, userId, { sampleChats: false });
  await ctx.db.query('update staff_members set user_id = $2 where org_id = $1 and name = $3', [org.id, userId, SANDBOX_DOCTOR]);
  await ctx.db.query(`update orgs set sandbox_state = 'pooled' where id = $1`, [org.id]);
  return org.id;
}

/** Job: top the pool up to POOL_SIZE (one build per run keeps each job short). */
export async function fillSandboxPool(target = POOL_SIZE): Promise<number> {
  const row = await ctx.db.one<{ n: number }>(`select count(*)::int as n from orgs where sandbox_state = 'pooled'`);
  if ((row?.n ?? 0) >= target) return 0;
  await buildSandbox();
  return 1;
}

/** Take a ready sandbox from the pool. Returns null when the pool is empty. */
export async function claimSandbox(): Promise<Sandbox | null> {
  if ((await activeSandboxes()) >= MAX_ACTIVE) throw new Error('All demo sandboxes are busy right now. Please try again in a few minutes.');
  const expiresAt = new Date(Date.now() + SANDBOX_TTL_MIN * 60_000);
  const row = await ctx.db.tx((t) =>
    t.one<{ id: string }>(
      `update orgs set sandbox_state = 'claimed', expires_at = $1
        where id = (select id from orgs where sandbox_state = 'pooled' order by created_at limit 1 for update skip locked)
        returning id`,
      [expiresAt],
    ),
  );
  if (!row) return null;
  const org = (await getOrg(row.id))!;
  const owner = await ctx.db.one<{ user_id: string }>(`select user_id from members where org_id = $1 and role = 'owner' limit 1`, [org.id]);
  // Bring the built-ahead day up to the current time (today's queue, waiting times) without making the visitor wait.
  void refreshDemoDay(org).catch((e) => console.warn('[sandbox] refresh failed', (e as Error).message));
  return { org, userId: owner!.user_id, expiresAt };
}

/** Claim one now, building it on the spot only when pooling is turned off (local development, tests). */
export async function createSandbox(): Promise<Sandbox | null> {
  const ready = await claimSandbox();
  if (ready || POOL_SIZE > 0) return ready;
  await buildSandbox();
  return claimSandbox();
}

/** Job: remove expired sandboxes (cascades to all their data) and their guest logins. */
export async function purgeSandboxes(): Promise<number> {
  const gone = await ctx.db.query<{ id: string }>(
    `delete from orgs where (sandbox_state = 'claimed' and expires_at < now())
        or (sandbox_state = 'pooled' and created_at < now() - ($1 || ' hours')::interval) returning id`,
    [String(POOL_MAX_AGE_H)],
  );
  await ctx.db.query(`delete from users where email like $1 and not exists (select 1 from members m where m.user_id = users.id)`, [`%@${GUEST_DOMAIN}`]);
  if (gone.length) console.log(`[cron] removed ${gone.length} expired sandboxes`);
  return gone.length;
}
