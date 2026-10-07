/** Cross-instance realtime over Postgres LISTEN/NOTIFY. Skipped unless TEST_DATABASE_URL is set. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';

const url = process.env.TEST_DATABASE_URL;

test('two server instances exchange events through Postgres', { skip: !url && 'TEST_DATABASE_URL not set' }, async () => {
  // Two separate connection pools stand in for two app instances behind a load balancer.
  const a = await openDb({ databaseUrl: url!, dataDir: ':memory:' });
  const b = await openDb({ databaseUrl: url!, dataDir: ':memory:' });
  try {
    let receive!: (payload: string) => void;
    const received = new Promise<string>((resolve) => { receive = resolve; });
    await a.listen!('relay_bus_test', receive);
    await b.notify!('relay_bus_test', JSON.stringify({ hello: 'ನಮಸ್ಕಾರ' }));
    const payload = await Promise.race([received, new Promise<string>((_, rej) => setTimeout(() => rej(new Error('no notification')), 5000))]);
    assert.deepEqual(JSON.parse(payload), { hello: 'ನಮಸ್ಕಾರ' });
  } finally {
    await a.close();
    await b.close();
  }
});
