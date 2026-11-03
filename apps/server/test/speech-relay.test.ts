import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

process.env.SPEECH_WORKER_SECRET = 'relay-test-secret-that-is-long-enough-123';
const { speechFetch, speechWorkerApi } = await import('../src/lib/speech-relay.ts');
const { runWorker, handleJob } = await import('../src/speech-worker.ts');

// Stands in for the inference gateway on the voice computer.
const seen: string[] = [];
const gateway = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  seen.push(`${req.method} ${req.url} ${req.headers.authorization} ${req.headers['content-type'] ?? ''} ${Buffer.concat(chunks).length}`);
  if (req.url === '/speech/v1/audio/speech') {
    res.setHeader('content-type', 'audio/wav');
    res.end(Buffer.from('RIFF-fixture'));
  } else {
    res.setHeader('content-type', 'application/json');
    res.end('{"status":"ok"}');
  }
});
const relayApp = new Hono().route('/api/speech-worker', speechWorkerApi);
let relay: ReturnType<typeof serve>;
let relayUrl = '';
const stop = new AbortController();

before(async () => {
  await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r));
  relay = serve({ fetch: relayApp.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise((r) => relay.once('listening', r));
  relayUrl = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;
});
after(async () => {
  stop.abort();
  gateway.closeAllConnections();
  await new Promise<void>((r) => gateway.close(() => r()));
  (relay as any).closeAllConnections?.();
  await new Promise<void>((r) => relay.close(() => r()));
});

test('without a connected worker, relayed speech fails at once with a clear reason', async () => {
  await assert.rejects(() => speechFetch('worker://relay/speech/health'), /voice computer is not connected/);
});

test('the worker endpoints need the shared secret', async () => {
  assert.equal((await fetch(`${relayUrl}/api/speech-worker/next`)).status, 401);
  assert.equal(
    (await fetch(`${relayUrl}/api/speech-worker/next`, { headers: { authorization: 'Bearer wrong-secret-wrong-secret-wrong-secret' } })).status,
    401,
  );
});

test('requests reach the gateway through the outbound worker and answers come back', async () => {
  void runWorker({ relayUrl, secret: process.env.SPEECH_WORKER_SECRET!, gatewayUrl: `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`, gatewayKey: 'gateway-key' }, stop.signal);
  // The worker's first poll marks it connected.
  for (let i = 0; i < 50 && !seen.length; i++) {
    try {
      const health = await speechFetch('worker://relay/speech/health', { signal: AbortSignal.timeout(5000) });
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: 'ok' });
      break;
    } catch (e) {
      if (!/not connected/.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.match(seen[0]!, /^GET \/speech\/health Bearer gateway-key/);
  const form = new FormData();
  form.set('input', 'hello');
  const speech = await speechFetch('worker://relay/speech/v1/audio/speech', {
    method: 'POST',
    body: JSON.stringify({ input: 'Hello', voice: 'p1' }),
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(speech.headers.get('content-type'), 'audio/wav');
  assert.equal(Buffer.from(await speech.arrayBuffer()).toString(), 'RIFF-fixture');
  const upload = await speechFetch('worker://relay/speech/profiles', { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
  assert.equal(upload.status, 200);
  assert.match(seen.at(-1)!, /^POST \/speech\/profiles Bearer gateway-key multipart\/form-data; boundary=/);
});

test('a request the worker does not answer in time times out for the caller', async () => {
  const controller = new AbortController();
  const pending = speechFetch('worker://relay/speech/health', { signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, (e: Error) => e.name === 'TimeoutError');
});

test('the worker forwards only speech routes', async () => {
  const refused = await handleJob(
    { id: 'x', method: 'POST', path: '/llm/v1/chat/completions', contentType: null, body: null },
    { relayUrl, secret: 'x'.repeat(32), gatewayUrl: 'http://127.0.0.1:1', gatewayKey: 'k' },
  );
  assert.equal(refused.status, 403);
});
