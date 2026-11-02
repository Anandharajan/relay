import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildSpeechGateway, completeSafetensors } from '../src/speech-gateway.ts';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('readiness rejects missing and truncated model weights', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-model-fixture-'));
  const path = join(dir, 'fixture.safetensors');
  try {
    assert.equal(await completeSafetensors(path), false);
    const header = Buffer.from(JSON.stringify({ weight: { dtype: 'F32', shape: [1], data_offsets: [0, 4] } }));
    const prefix = Buffer.alloc(8);
    prefix.writeBigUInt64LE(BigInt(header.length));
    await writeFile(path, Buffer.concat([prefix, header, Buffer.alloc(4)]));
    assert.equal(await completeSafetensors(path), true);
    await writeFile(path, Buffer.concat([prefix, header, Buffer.alloc(1)]));
    assert.equal(await completeSafetensors(path), false);
  } finally { await rm(dir, { recursive: true }); }
});

test('inference bridge requires auth, blocks administration and preserves audio and provider credentials', async () => {
  const received: { path: string; key: string; body: string }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push({ path: req.url!, key: req.headers.authorization!, body: Buffer.concat(chunks).toString() });
    if (req.url === '/engines/tts') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ active: 'moss-tts-nano', active_model: null }));
      return;
    }
    res.setHeader('content-type', 'audio/wav');
    res.end(Buffer.from('RIFF-contract-audio'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const secret = 'test-only-gateway-secret-32-characters';
  const app = buildSpeechGateway({ secret, speechUrl: base, speechKey: 'speech-test-key', llmUrl: base + '/v1', llmKey: 'model-test-key' });
  const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
  try {
    assert.equal((await app.request('/speech/health')).status, 401);
    assert.equal((await app.request('/speech/health', { headers: { authorization: 'Bearer incorrect' } })).status, 401);
    for (const path of ['/speech/engines/select', '/speech/hf-token', '/speech/models/install', '/speech/settings', '/speech/profiles/../engines/select']) {
      assert.equal((await app.request(path, { method: 'POST', headers, body: '{}' })).status, 404);
    }
    assert.equal(received.length, 0);
    const audio = await app.request('/speech/v1/audio/speech', { method: 'POST', headers, body: '{"voice":"own-profile","input":"Hello"}' });
    assert.equal(audio.headers.get('content-type'), 'audio/wav');
    assert.equal(audio.headers.get('cache-control'), 'no-store');
    assert.equal(await audio.text(), 'RIFF-contract-audio');
    assert.equal(received[0]!.key, 'Bearer speech-test-key');
    assert.equal(received[0]!.path, '/v1/audio/speech');
    assert.match(received[0]!.body, /own-profile/);
    await app.request('/llm/v1/chat/completions', { method: 'POST', headers, body: '{}' });
    assert.equal(received[1]!.key, 'Bearer model-test-key');
    assert.equal(received[1]!.path, '/v1/chat/completions');
    await app.request('/speech/profiles/own-profile', { method: 'DELETE', headers });
    assert.equal(received[2]!.path, '/profiles/own-profile');
    const metadata = await app.request('/speech/engines/tts', { headers });
    assert.equal((await metadata.json() as any).active_model, 'OpenMOSS-Team/MOSS-TTS-Nano-100M');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.throws(() => buildSpeechGateway({ secret: '', speechUrl: base, speechKey: '', llmUrl: base, llmKey: '' }), /must be configured/);
});
