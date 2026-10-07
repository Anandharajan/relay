/**
 * End-to-end: boots the real server with the demo workspace, then drives it over HTTP like the
 * dashboard and the widget would. Uses in-memory PGlite by default; set TEST_DATABASE_URL to an
 * EMPTY Postgres+pgvector database to run the same suite against real Postgres (CI does this).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

const PORT = 8791;
process.env.PORT = String(PORT);
process.env.PUBLIC_URL = `http://localhost:${PORT}`;
process.env.DATA_DIR = ':memory:';
process.env.DATABASE_URL = '';
process.env.LLM_PROVIDER = 'extractive';
process.env.DEMO_SEED = 'true';
process.env.RELAY_SECRET = 'test-secret-test-secret-test-secret';

const base = `http://localhost:${PORT}`;
let server: { close: () => void; address: () => AddressInfo | string | null };
let cookie = '';

async function api(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-relay-csrf': '1', cookie, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie();
  if (set.length) {
    const jar = new Map(cookie.split('; ').filter(Boolean).map((kv) => [kv.split('=')[0], kv] as const));
    for (const s of set) jar.set(s.split('=')[0]!, s.split(';')[0]!);
    cookie = [...jar.values()].join('; ');
  }
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, label: string, ms = process.env.TEST_DATABASE_URL ? 30000 : 8000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

before(async () => {
  const { ctx } = await import('../src/ctx.ts');
  const { openDb } = await import('../src/db.ts');
  const { buildApp } = await import('../src/app.ts');
  const { registerJob, startJobs } = await import('../src/jobs/runner.ts');
  const { ingestSource } = await import('../src/jobs/ingest.ts');
  const { runSimulation } = await import('../src/jobs/simulate.ts');
  const { seedDemo } = await import('../src/seed.ts');
  const { serve } = await import('@hono/node-server');
  const { initBus } = await import('../src/lib/events.ts');
  ctx.db = await openDb({ databaseUrl: process.env.TEST_DATABASE_URL ?? '', dataDir: ':memory:' });
  await initBus(ctx.db);
  registerJob('ingest', ingestSource);
  registerJob('simulate', runSimulation);
  await startJobs([]);
  server = serve({ fetch: buildApp().fetch, port: PORT }) as any;
  await seedDemo();
});

after(() => {
  server?.close();
  setTimeout(() => process.exit(0), 100).unref();
});

test('rejects unauthenticated and CSRF-less requests', async () => {
  assert.equal((await api('GET', '/api/me')).status, 401);
  const res = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.equal(res.status, 200); // logout is public
  const noCsrf = await fetch(`${base}/api/knowledge/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noCsrf.status, 403);
});

test('signup creates an isolated workspace', async () => {
  const r = await api('POST', '/api/auth/signup', { email: 'owner@test.in', password: 'password123', name: 'Asha', orgName: 'Test Store' });
  assert.equal(r.status, 200);
  const me = await api('GET', '/api/me');
  assert.equal(me.data.org.name, 'Test Store');
  assert.equal(me.data.role, 'owner');
  // Tenant isolation: the new workspace sees none of the demo store's knowledge or conversations.
  assert.equal((await api('GET', '/api/knowledge')).data.length, 0);
  assert.equal((await api('GET', '/api/inbox/conversations?view=all')).data.conversations.length, 0);
  const ask = await api('POST', '/api/knowledge/ask', { question: 'How long does delivery take?' });
  assert.equal(ask.data.kind, 'handoff');
  cookie = '';
});

test('demo owner signs in and ingests new FAQ knowledge', async () => {
  assert.equal((await api('POST', '/api/auth/login', { email: 'demo@relay.local', password: 'relay-demo-1234' })).status, 200);
  const add = await api('POST', '/api/knowledge/faq', { title: 'Gift cards', content: 'Q: Do you sell gift cards?\nA: Yes, digital gift cards from ₹500 to ₹5,000, delivered by email instantly.' });
  assert.equal(add.status, 200);
  await waitFor(async () => (await api('GET', '/api/knowledge')).data.find((s: any) => s.id === add.data.id && s.status === 'ready'), 'ingestion');
  const ask = await api('POST', '/api/knowledge/ask', { question: 'can I buy a gift card?' });
  assert.equal(ask.data.kind, 'answer');
  assert.match(ask.data.text, /gift cards from ₹500/);
  assert.equal(ask.data.citations[0].title, 'Gift cards');
});

test('answers in Hindi and Kannada from vernacular knowledge', async () => {
  const hi = await api('POST', '/api/knowledge/ask', { question: 'रिफंड में कितना समय लगता है?' });
  assert.equal(hi.data.lang, 'hi');
  assert.equal(hi.data.kind, 'answer');
  assert.match(hi.data.text, /5-7 कार्यदिवस/);
  const kn = await api('POST', '/api/knowledge/ask', { question: 'ಕ್ಯಾಶ್ ಆನ್ ಡೆಲಿವರಿ ಲಭ್ಯವಿದೆಯೇ?' });
  assert.equal(kn.data.lang, 'kn');
  assert.equal(kn.data.kind, 'answer');
  assert.match(kn.data.text, /₹2,000/);
  const returns = await api('POST', '/api/knowledge/ask', { question: 'ನಿಮ್ಮ ರಿಟರ್ನ್ ನೀತಿ ಏನು?' });
  assert.equal(returns.data.lang, 'kn');
  assert.equal(returns.data.kind, 'answer');
  assert.match(returns.data.text, /7 ದಿನಗಳೊಳಗೆ/);
  assert.ok(returns.data.citations.length);
});

test('PII never reaches the model input', async () => {
  const r = await api('POST', '/api/knowledge/ask', { question: 'my number is 9876543210, what is your return policy?' });
  assert.ok(!r.data.redactedQuestion.includes('9876543210'));
  assert.match(r.data.redactedQuestion, /\[PHONE_1\]/);
});

test('keyword-only order question without an ID is answered from knowledge', async () => {
  const r = await api('POST', '/api/knowledge/ask', { question: 'How can I track my order?' });
  assert.equal(r.data.kind, 'answer');
  assert.match(r.data.text, /tracking link/);
});

test('widget conversation: answer, action, sensitive action approval, resolution', async () => {
  const pub = await api('GET', '/api/public/config');
  const session = await fetch(`${base}/widget/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteKey: pub.data.demoSiteKey }) }).then((r) => r.json());
  const W = { authorization: `Bearer ${session.token}`, cookie: '' };
  const send = (content: string, conversationId?: string) =>
    fetch(`${base}/widget/messages`, { method: 'POST', headers: { 'content-type': 'application/json', ...W }, body: JSON.stringify({ content, conversationId }) }).then((r) => r.json());
  const thread = () => fetch(`${base}/widget/conversation`, { headers: W }).then((r) => r.json());

  const first = await send('Is the coffee fresh?');
  const convId = first.conversationId;
  await waitFor(async () => (await thread()).messages.find((m: any) => m.role === 'ai'), 'AI answer');
  assert.match((await thread()).messages[1].content, /roasted to order/);

  await send('Where is my order KC-1042?', convId);
  const orderReply = await waitFor(async () => (await thread()).messages.filter((m: any) => m.role === 'ai')[1], 'order action');
  assert.match(orderReply.content, /KC-1042 .*Courier/);

  await send('Cancel my order KC-3003', convId);
  await waitFor(async () => (await thread()).conversation.status === 'escalated', 'escalation');

  const detail = await api('GET', `/api/inbox/conversations/${convId}`);
  const run = detail.data.actionRuns.find((r: any) => r.status === 'pending_approval');
  assert.ok(run, 'pending approval run exists');
  const approved = await api('POST', `/api/inbox/action-runs/${run.id}`, { approve: true });
  assert.equal(approved.data.ok, true);
  const t = await thread();
  assert.match(t.messages.at(-1).content, /KC-3003 has been cancelled/);
  assert.equal(t.conversation.status, 'ai');

  const fb = await fetch(`${base}/widget/feedback`, { method: 'POST', headers: { 'content-type': 'application/json', ...W }, body: JSON.stringify({ conversationId: convId, helpful: true }) });
  assert.equal(fb.status, 200);
  const after = await api('GET', `/api/inbox/conversations/${convId}`);
  assert.equal(after.data.conversation.status, 'resolved');
  assert.equal(after.data.conversation.csat, 5);
  assert.equal(after.data.conversation.resolved_by, 'human'); // a human approved an action in this thread
});

test('widget sessions cannot read other visitors\' conversations', async () => {
  const pub = await api('GET', '/api/public/config');
  const mk = () => fetch(`${base}/widget/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteKey: pub.data.demoSiteKey }) }).then((r) => r.json());
  const a = await mk();
  const b = await mk();
  const sent = await fetch(`${base}/widget/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${a.token}` }, body: JSON.stringify({ content: 'hello there friend' }) }).then((r) => r.json());
  const res = await fetch(`${base}/widget/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${b.token}` }, body: JSON.stringify({ content: 'hi', conversationId: sent.conversationId }) });
  assert.equal(res.status, 404);
});

test('edited AI drafts become knowledge (learning loop)', async () => {
  const pub = await api('GET', '/api/public/config');
  const s = await fetch(`${base}/widget/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteKey: pub.data.demoSiteKey }) }).then((r) => r.json());
  const sent = await fetch(`${base}/widget/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` }, body: JSON.stringify({ content: 'Do you have a physical cafe I can visit in Indiranagar?' }) }).then((r) => r.json());
  const conv = await waitFor(async () => {
    const d = await api('GET', `/api/inbox/conversations/${sent.conversationId}`);
    return d.data.conversation.status === 'escalated' && d.data;
  }, 'escalation');
  // Ask the AI for a suggestion via an @AI note, then edit and send it.
  await api('POST', `/api/inbox/conversations/${sent.conversationId}/messages`, { content: '@AI tell them we are online-only for now', note: true });
  const withDraft = await api('GET', `/api/inbox/conversations/${sent.conversationId}`);
  const draft = withDraft.data.drafts.find((d: any) => d.status === 'pending');
  const finalText = 'We are online-only for now — no physical cafe yet, but we deliver across Bengaluru in 1-2 days.';
  if (draft) {
    assert.equal((await api('POST', `/api/inbox/conversations/${sent.conversationId}/drafts/${draft.id}`, { decision: 'send', text: finalText })).status, 200);
  } else {
    // No draft could be produced from knowledge: reply manually and teach the AI.
    const msg = await api('POST', `/api/inbox/conversations/${sent.conversationId}/messages`, { content: finalText });
    await api('POST', `/api/inbox/messages/${msg.data.id}/learn`, {});
  }
  assert.ok(conv);
  const ask = await api('POST', '/api/knowledge/ask', { question: 'Do you have a physical cafe I can visit in Indiranagar?' });
  assert.equal(ask.data.kind, 'answer');
  assert.match(ask.data.text, /online-only/);
});

test('simulation reports a pass rate', async () => {
  const created = await api('POST', '/api/simulations', { name: 'CI', questions: 'How long does delivery take? => 2-3\nDo you sell green tea?\nIs COD available? => 2,000' });
  assert.equal(created.status, 200);
  const sim = await waitFor(async () => {
    const d = await api('GET', `/api/simulations/${created.data.id}`);
    return d.data.simulation.status === 'done' && d.data;
  }, 'simulation');
  assert.equal(sim.simulation.total, 3);
  assert.equal(sim.cases.find((c: any) => c.question.includes('green tea')).passed, false);
  assert.equal(sim.cases.find((c: any) => c.question.includes('delivery')).passed, true);
});

test('analytics and DPDP export/erase', async () => {
  const a = await api('GET', '/api/analytics?days=30');
  assert.ok(a.data.totals.conversations >= 12);
  assert.ok(a.data.languages.some((l: any) => l.lang === 'hi'));
  const pub = await api('GET', '/api/public/config');
  const session = await api('POST', '/widget/session', { siteKey: pub.data.demoSiteKey });
  const sent = await api('POST', '/widget/messages', { content: 'talk to a human' }, { authorization: `Bearer ${session.data.token}` });
  await waitFor(async () => {
    const detail = await api('GET', `/api/inbox/conversations/${sent.data.conversationId}`);
    return detail.data.conversation.status === 'escalated';
  }, 'requested human handoff');
  const afterHandoff = await api('GET', '/api/analytics?days=30');
  assert.equal(afterHandoff.data.totals.conversations, a.data.totals.conversations + 1);
  assert.equal(afterHandoff.data.totals.deflected, a.data.totals.deflected);
  assert.equal(afterHandoff.data.totals.escalated_open, a.data.totals.escalated_open + 1);
  const conv = (await api('GET', '/api/inbox/conversations?view=all')).data.conversations[0];
  const exp = await api('GET', `/api/workspace/privacy/export?visitor=${conv.visitor_id}`);
  assert.equal(exp.data.conversations.length, 1);
  const erased = await api('POST', '/api/workspace/privacy/erase', { visitor: conv.visitor_id });
  assert.equal(erased.data.deleted, 1);
  const audit = await api('GET', '/api/workspace/audit');
  assert.ok(audit.data.some((x: any) => x.action === 'privacy.erased'));
});

test('BYOK keys are encrypted and never returned', async () => {
  await api('PUT', '/api/workspace/model', { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test-abcdefghijklmnop' });
  const m = await api('GET', '/api/workspace/model');
  assert.equal(m.data.provider, 'openai');
  assert.equal(JSON.stringify(m.data).includes('abcdefghijklmnop'), false);
  assert.match(m.data.keyHint, /…mnop$/);
  await api('PUT', '/api/workspace/model', { provider: 'default' });
});

test('public demo dashboard is read-only and hides admin data', async () => {
  await api('POST', '/api/auth/logout', {});
  assert.equal((await api('POST', '/api/auth/demo', {})).status, 200);
  const me = await api('GET', '/api/me');
  assert.equal(me.data.role, 'viewer');
  assert.equal(me.data.orgs.length, 1);
  const list = await api('GET', '/api/inbox/conversations');
  assert.equal(list.status, 200);
  const id = list.data.conversations[0].id;
  assert.equal((await api('POST', `/api/inbox/conversations/${id}/resolve`, {})).status, 403);
  assert.equal((await api('PATCH', '/api/workspace/settings', {})).status, 403);
  assert.equal((await api('GET', '/api/workspace/team')).status, 403);
  assert.equal((await api('GET', '/api/workspace/model')).status, 403);
  assert.equal((await api('POST', '/api/knowledge/ask', { question: 'How long does delivery take?' })).status, 200);
  const cfg = await api('GET', '/api/public/config');
  assert.equal('demoEmail' in cfg.data, false);
  await api('POST', '/api/auth/logout', {});
});
