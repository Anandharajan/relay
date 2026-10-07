import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Row = Record<string, any>;

/** Minimal SQL interface shared by PGlite (embedded) and postgres.js (server). Params use $1..$n. */
export interface Db {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'pglite' | 'postgres';
  /** Cross-process pub/sub (Postgres LISTEN/NOTIFY). Only on real Postgres. */
  listen?(channel: string, fn: (payload: string) => void): Promise<void>;
  notify?(channel: string, payload: string): Promise<void>;
}

function normalize(params: unknown[] = [], serializeObjects = true): unknown[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (serializeObjects && p !== null && typeof p === 'object' && !(p instanceof Date) && !(p instanceof Uint8Array)) return JSON.stringify(p);
    return p;
  });
}

async function openPglite(dataDir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { vector } = await import('@electric-sql/pglite/vector');
  let target = 'memory://';
  if (dataDir !== ':memory:') {
    target = join(dataDir, 'pg');
    mkdirSync(target, { recursive: true });
  }
  const pg = await PGlite.create(target, { extensions: { vector } });
  // PGlite is a single connection; serialize transactions so concurrent requests don't interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const wrap = (q: { query: typeof pg.query; exec: typeof pg.exec }): Omit<Db, 'tx' | 'close' | 'kind'> => ({
    async query(sql, params) {
      const r = await q.query(sql, normalize(params));
      return r.rows as any[];
    },
    async one(sql, params) {
      const r = await q.query(sql, normalize(params));
      return r.rows[0] as any;
    },
    async exec(sql) {
      await q.exec(sql);
    },
  });
  const base = wrap(pg);
  const db: Db = {
    ...base,
    kind: 'pglite',
    tx(fn) {
      const run = chain.then(() =>
        pg.transaction((t) => {
          const inner: Db = { ...wrap(t as any), kind: 'pglite', tx: (f) => f(inner), close: async () => {} };
          return fn(inner);
        }),
      );
      chain = run.catch(() => {});
      return run as Promise<any>;
    },
    close: () => pg.close(),
  };
  return db;
}

async function openPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres');
  // Read after dotenv configuration; Node's NODE_EXTRA_CA_CERTS is read before
  // --env-file, so it cannot reliably configure trust from the app's .env.
  const caFile = process.env.DATABASE_CA_CERT_FILE;
  const sql = postgres(url, {
    max: 10,
    onnotice: () => {},
    ...(caFile ? { ssl: { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true } } : {}),
  });
  const wrap = (s: any): Omit<Db, 'tx' | 'close' | 'kind'> => ({
    async query(q, params) {
      // postgres.js serializes native JSON values using the inferred SQL type.
      // Pre-stringifying here would store JSON strings instead of objects/arrays.
      return [...(await s.unsafe(q, normalize(params, false) as any[]))] as any[];
    },
    async one(q, params) {
      return (await s.unsafe(q, normalize(params, false) as any[]))[0] as any;
    },
    async exec(q) {
      await s.unsafe(q);
    },
  });
  const db: Db = {
    ...wrap(sql),
    kind: 'postgres',
    tx: (fn) =>
      sql.begin((t: any) => {
        const inner: Db = { ...wrap(t), kind: 'postgres', tx: (f) => f(inner), close: async () => {} };
        return fn(inner);
      }) as Promise<any>,
    close: () => sql.end(),
    async listen(channel, fn) {
      await sql.listen(channel, fn);
    },
    async notify(channel, payload) {
      await sql.notify(channel, payload);
    },
  };
  return db;
}

export async function openDb(opts: { databaseUrl: string; dataDir: string }): Promise<Db> {
  const db = opts.databaseUrl ? await openPostgres(opts.databaseUrl) : await openPglite(opts.dataDir);
  await migrate(db);
  return db;
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(db: Db) {
  await db.exec(`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>('select name from _migrations')).map((r) => r.name));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query('insert into _migrations (name) values ($1)', [file]);
    });
    console.log(`[db] applied migration ${file}`);
  }
}
