import type { Db } from './db.ts';

/** Process-wide handles, set once at boot (see index.ts). */
export const ctx = {
  db: null as unknown as Db,
};
