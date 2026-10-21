/**
 * End-to-end: boots the real server with the demo workspace, then drives it over HTTP like the
 * dashboard and the widget would. Uses in-memory PGlite by default; set TEST_DATABASE_URL to an
 * EMPTY Postgres+pgvector database to run the same suite against real Postgres (CI does this).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';

const PORT = 8791;
process.env.PORT = String(PORT);
process.env.PUBLIC_URL = `http://localhost:${PORT}`;
process.env.DATA_DIR = ':memory:';
process.env.DATABASE_URL = '';
process.env.LLM_PROVIDER = 'extractive';
process.env.DEMO_SEED = 'true';
process.env.RELAY_SECRET = 'test-secret-test-secret-test-secret';
process.env.PLATFORM_ADMIN_EMAILS = 'demo@relay.local';

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
  const { processRecord } = await import('../src/services/records.ts');
  registerJob('record_process', processRecord);
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
  const r = await api('POST', '/api/auth/signup', { email: 'owner@test.in', password: 'password123', name: 'Asha', orgName: 'Test Clinic' });
  assert.equal(r.status, 200);
  const me = await api('GET', '/api/me');
  assert.equal(me.data.org.name, 'Test Clinic');
  assert.equal(me.data.role, 'owner');
  // Tenant isolation: the new workspace sees none of the demo hospital's knowledge, patients or conversations.
  assert.equal((await api('GET', '/api/knowledge')).data.length, 0);
  assert.equal((await api('GET', '/api/inbox/conversations?view=all')).data.conversations.length, 0);
  assert.equal((await api('GET', '/api/visits/clients')).data.length, 0);
  const ask = await api('POST', '/api/knowledge/ask', { question: 'What are the OPD timings?' });
  assert.equal(ask.data.kind, 'handoff');
  // Workspace owners are not platform admins.
  assert.equal((await api('GET', '/api/admin/overview')).status, 404);
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

test('answers in Tamil and Hindi from vernacular knowledge', async () => {
  const ta = await api('POST', '/api/knowledge/ask', { question: 'ஆலோசனைக் கட்டணம் எவ்வளவு?' });
  assert.equal(ta.data.lang, 'ta');
  assert.equal(ta.data.kind, 'answer');
  assert.match(ta.data.text, /₹500/);
  assert.ok(ta.data.citations.length);
  const lab = await api('POST', '/api/knowledge/ask', { question: 'பரிசோதனைக் கூட நேரம் என்ன?' });
  assert.equal(lab.data.kind, 'answer');
  assert.match(lab.data.text, /காலை 7/);
  const hi = await api('POST', '/api/knowledge/ask', { question: 'परामर्श शुल्क कितना है?' });
  assert.equal(hi.data.lang, 'hi');
  assert.equal(hi.data.kind, 'answer');
  assert.match(hi.data.text, /₹500/);
});

test('PII never reaches the model input', async () => {
  const r = await api('POST', '/api/knowledge/ask', { question: 'my number is 9876543210, what are the visiting hours?' });
  assert.ok(!r.data.redactedQuestion.includes('9876543210'));
  assert.match(r.data.redactedQuestion, /\[PHONE_1\]/);
});

test('keyword-only lab question without an ID is answered from knowledge', async () => {
  const r = await api('POST', '/api/knowledge/ask', { question: 'When will my lab report be ready?' });
  assert.equal(r.data.kind, 'answer');
  assert.match(r.data.text, /same evening/);
});

test('safety: emergencies and medical-advice questions are escalated, never answered', async () => {
  const pub = await api('GET', '/api/public/config');
  const s = await api('POST', '/widget/session', { siteKey: pub.data.demoSiteKey });
  const W = { authorization: `Bearer ${s.data.token}` };
  const em = await api('POST', '/widget/messages', { content: 'என் அப்பாவுக்கு நெஞ்சு வலி, மூச்சு திணறல்' }, W);
  const t1 = await waitFor(async () => {
    const t = (await api('GET', '/widget/conversation', undefined, W)).data;
    return t.messages.find((m: any) => m.role === 'ai') && t;
  }, 'emergency reply');
  assert.match(t1.messages.at(-1).content, /108/);
  assert.equal(t1.conversation.status, 'escalated');
  assert.ok(em.data.conversationId);
  const s2 = await api('POST', '/widget/session', { siteKey: pub.data.demoSiteKey });
  const W2 = { authorization: `Bearer ${s2.data.token}` };
  await api('POST', '/widget/messages', { content: 'Can I take paracetamol with metformin?' }, W2);
  const t2 = await waitFor(async () => {
    const t = (await api('GET', '/widget/conversation', undefined, W2)).data;
    return t.messages.find((m: any) => m.role === 'ai') && t;
  }, 'medical advice reply');
  assert.match(t2.messages.at(-1).content, /can't give medical advice/);
  assert.equal(t2.conversation.status, 'escalated');
});

test('widget conversation: answer, action, sensitive action approval, resolution', async () => {
  const pub = await api('GET', '/api/public/config');
  const session = await fetch(`${base}/widget/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteKey: pub.data.demoSiteKey }) }).then((r) => r.json());
  const W = { authorization: `Bearer ${session.token}`, cookie: '' };
  const send = (content: string, conversationId?: string) =>
    fetch(`${base}/widget/messages`, { method: 'POST', headers: { 'content-type': 'application/json', ...W }, body: JSON.stringify({ content, conversationId }) }).then((r) => r.json());
  const thread = () => fetch(`${base}/widget/conversation`, { headers: W }).then((r) => r.json());

  const first = await send('Is parking available?');
  const convId = first.conversationId;
  await waitFor(async () => (await thread()).messages.find((m: any) => m.role === 'ai'), 'AI answer');
  assert.match((await thread()).messages[1].content, /basement/);

  await send('Is my report LAB-2042 ready?', convId);
  const labReply = await waitFor(async () => (await thread()).messages.filter((m: any) => m.role === 'ai')[1], 'lab action');
  assert.match(labReply.content, /LAB-2042/);

  await send('Cancel home collection LAB-3003', convId);
  await waitFor(async () => (await thread()).conversation.status === 'escalated', 'escalation');

  const detail = await api('GET', `/api/inbox/conversations/${convId}`);
  const run = detail.data.actionRuns.find((r: any) => r.status === 'pending_approval');
  assert.ok(run, 'pending approval run exists');
  const approved = await api('POST', `/api/inbox/action-runs/${run.id}`, { approve: true });
  assert.equal(approved.data.ok, true);
  const t = await thread();
  assert.match(t.messages.at(-1).content, /LAB-3003 has been cancelled/);
  assert.equal(t.conversation.status, 'ai');

  const fb = await fetch(`${base}/widget/feedback`, { method: 'POST', headers: { 'content-type': 'application/json', ...W }, body: JSON.stringify({ conversationId: convId, helpful: true }) });
  assert.equal(fb.status, 200);
  const after = await api('GET', `/api/inbox/conversations/${convId}`);
  assert.equal(after.data.conversation.status, 'resolved');
  assert.equal(after.data.conversation.csat, 5);
  assert.equal(after.data.conversation.resolved_by, 'human'); // a human approved an action in this thread
});

test('booking in Tamil over chat, visit page, QR check-in and live waiting time', async () => {
  const pub = await api('GET', '/api/public/config');
  const s = await api('POST', '/widget/session', { siteKey: pub.data.demoSiteKey });
  const W = { authorization: `Bearer ${s.data.token}` };
  const lastAi = async (n: number) =>
    waitFor(async () => {
      const t = (await api('GET', '/widget/conversation', undefined, W)).data;
      const ai = t.messages.filter((m: any) => m.role === 'ai');
      return ai.length >= n && ai[n - 1].content;
    }, `reply ${n}`);
  const sent = await api('POST', '/widget/messages', { content: 'அப்பாயின்ட்மென்ட் வேண்டும், சர்க்கரை நோய் மருத்துவர்' }, W);
  assert.match(await lastAi(1), /Dr\. Lakshmi Narayanan/);
  await api('POST', '/widget/messages', { content: '1', conversationId: sent.data.conversationId }, W);
  assert.match(await lastAi(2), /முழுப் பெயர்/); // the booking stays in Tamil after a numeric reply
  await api('POST', '/widget/messages', { content: 'Test Patient Kumar 9876501234', conversationId: sent.data.conversationId }, W);
  const booked = await lastAi(3);
  assert.doesNotMatch(booked, /Fasting/); // the confirmation comes before any prep instructions
  assert.match(booked, /டோக்கன் \d+/);
  const code = booked.match(/\/v\/([A-Z0-9x]+)/i)![1]!;
  const visit = await api('GET', `/api/public/visit/${code}`);
  assert.equal(visit.status, 200);
  assert.equal(visit.data.staff.name, 'Dr. Lakshmi Narayanan');
  assert.equal(visit.data.client.lang, 'ta');
  // Prep instructions approved by the medical director are attached automatically (diabetes → fasting).
  const appt = (await api('GET', '/api/visits/appointments?date=' + new Date(visit.data.visit.startsAt).toISOString().slice(0, 10))).data.find((a: any) => a.code === code);
  assert.ok(appt);
  if (visit.data.visit.today) {
    const ci = await api('POST', `/api/public/visit/${code}/checkin`, {});
    assert.equal(ci.status, 200);
    assert.ok(ci.data.etaMin >= 0);
  }
  assert.equal((await api('GET', '/api/public/visit/NOPE00')).status, 404);
});

test('records: intake and findings agents, doctor approval before the patient is told', async () => {
  const c = await api('POST', '/api/visits/clients', { name: 'Synthetic Test Patient', phone: '9000000999', lang: 'en' });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const rec = await api('POST', `/api/visits/clients/${c.data.id}/records`, { title: 'Lab', text: 'Date: 01/10/2026\nPotassium 6.9 mmol/L 3.5 - 5.1\nHbA1c 9.2 % 4.0 - 5.6\nTab. Metformin 500 mg 1-0-1' });
  assert.equal(rec.status, 200);
  const brief = await waitFor(async () => {
    const b = (await api('GET', `/api/visits/clients/${c.data.id}`)).data;
    return b.findings.length && b;
  }, 'findings');
  assert.ok(brief.latest.find((o: any) => o.test === 'k' && o.flag === 'critical_high'));
  assert.ok(brief.findings.find((f: any) => f.severity === 'urgent'));
  assert.deepEqual(brief.medicines, ['Tab. Metformin 500 mg']);
  const draft = brief.outbox.find((o: any) => o.kind === 'finding');
  assert.equal(draft.status, 'pending_approval'); // nothing clinical goes out on its own
  const ok = await api('POST', `/api/visits/outbox/${draft.id}/approve`, { body: 'Dr. Rao reviewed your results. Please call us today.' });
  assert.equal(ok.status, 200);
  const after = (await api('GET', `/api/visits/clients/${c.data.id}`)).data;
  assert.equal(after.outbox.find((o: any) => o.id === draft.id).status, 'sent');
  assert.ok(after.findings.filter((f: any) => f.severity !== 'info').every((f: any) => f.status === 'shared'));
});

test('review routing: reports reach the booked doctor\'s queue until signed off', async () => {
  const me = (await api('GET', '/api/me')).data;
  const staff = (await api('GET', '/api/visits/staff')).data.find((s: any) => /Narmadha/.test(s.name)) ?? (await api('GET', '/api/visits/staff')).data[0];
  // Only workspace members can be linked to a calendar.
  assert.equal((await api('PATCH', `/api/visits/staff/${staff.id}`, { userId: '00000000-0000-4000-8000-000000000000' })).status, 400);
  assert.equal((await api('PATCH', `/api/visits/staff/${staff.id}`, { userId: me.user.id })).status, 200);
  try {
    const slot = (await api('GET', `/api/visits/slots?staffId=${staff.id}`)).data[0];
    const appt = await api('POST', '/api/visits/appointments', { client: { name: 'Synthetic Routing Patient', phone: '9000000777', lang: 'en' }, staffId: staff.id, startsAt: slot });
    assert.equal(appt.status, 200, JSON.stringify(appt.data));
    const clientId = appt.data.client_id ?? appt.data.clientId;
    const rec = await api('POST', `/api/visits/clients/${clientId}/records`, { title: 'Routine lab', text: 'Haemoglobin 13.1 g/dL 12.0 - 15.5\nTSH 2.0 µIU/mL 0.4 - 4.5' });
    assert.equal(rec.status, 200);
    const item = await waitFor(async () => (await api('GET', '/api/visits/reviews?mine=1')).data.find((r: any) => r.client_id === clientId), 'routed review');
    assert.equal(item.staff_name, staff.name);
    assert.equal(item.urgent_findings, 0); // a routine report still waits for review
    const counts = (await api('GET', '/api/visits/reviews/count')).data;
    assert.ok(counts.mine >= 1 && counts.all >= counts.mine);
    const other = (await api('POST', '/api/visits/clients', { name: 'Unrelated review test', lang: 'en' })).data;
    await api('POST', `/api/visits/clients/${other.id}/records`, { title: 'Unrelated routine report', text: 'Haemoglobin 13.1 g/dL 12.0 - 15.5' });
    const unrelated = await waitFor(async () => (await api('GET', '/api/visits/reviews')).data.find((r: any) => r.client_id === other.id), 'unrelated review');
    const { ctx } = await import('../src/ctx.ts');
    // Exercise the HTTP permission boundary as an ordinary linked doctor, not an owner.
    await ctx.db.query("update members set role = 'agent' where org_id = $1 and user_id = $2", [me.org.id, me.user.id]);
    try {
      assert.equal((await api('POST', `/api/visits/records/${unrelated.id}/reviewed`, {})).status, 403);
      assert.equal((await api('POST', `/api/visits/records/${item.id}/reviewed`, {})).status, 200);
    } finally {
      await ctx.db.query("update members set role = 'owner' where org_id = $1 and user_id = $2", [me.org.id, me.user.id]);
    }
    assert.equal((await api('POST', `/api/visits/records/${item.id}/reviewed`, {})).status, 409);
    assert.ok(!(await api('GET', '/api/visits/reviews')).data.some((r: any) => r.id === item.id));
  } finally {
    await api('PATCH', `/api/visits/staff/${staff.id}`, { userId: staff.user_id ?? null });
  }
});

test('review routing: demo doctors are linked, admins reassign, clinical drafts need sign-off to discard', async () => {
  const staff = (await api('GET', '/api/visits/staff')).data;
  const narmadha = staff.find((s: any) => s.name === 'Dr. Narmadha Vasu');
  assert.ok(narmadha.user_id, 'demo doctor linked to a login');
  const queue = (await api('GET', '/api/visits/reviews')).data;
  const seeded = queue.filter((r: any) => r.client_name === 'Ananya Krishnan');
  assert.ok(seeded.length && seeded.every((r: any) => r.staff_name === 'Dr. Narmadha Vasu'), 'seeded reports are assigned to their doctor');
  const item = queue[0];
  assert.equal((await api('POST', `/api/visits/records/${item.id}/assign`, { staffId: narmadha.id })).status, 200);
  assert.equal((await api('GET', '/api/visits/reviews')).data.find((r: any) => r.id === item.id).staff_name, 'Dr. Narmadha Vasu');
  assert.equal((await api('POST', `/api/visits/records/${item.id}/assign`, { staffId: '00000000-0000-4000-8000-000000000000' })).status, 404);
  const draft = (await api('GET', '/api/visits/approvals')).data.messages[0];
  if (draft) {
    const me = (await api('GET', '/api/me')).data;
    const { ctx } = await import('../src/ctx.ts');
    // An ordinary staff login that is not this patient's doctor cannot discard a clinical draft.
    await ctx.db.query("update members set role = 'agent' where org_id = $1 and user_id = $2", [me.org.id, me.user.id]);
    try {
      assert.equal((await api('POST', `/api/visits/outbox/${draft.id}/discard`, {})).status, 403);
      assert.equal((await api('POST', `/api/visits/records/${item.id}/assign`, { staffId: null })).status, 403);
    } finally {
      await ctx.db.query("update members set role = 'owner' where org_id = $1 and user_id = $2", [me.org.id, me.user.id]);
    }
  }
});

test('telecalling add-on: simulated reminder call and keypad answer', async () => {
  const appts = (await api('GET', '/api/visits/appointments')).data.filter((a: any) => a.status === 'booked');
  if (!appts.length) return;
  const placed = await api('POST', '/api/visits/calls', { appointmentId: appts[0].id, purpose: 'reminder' });
  assert.equal(placed.status, 200);
  const r = await api('POST', `/api/visits/calls/${placed.data.id}/simulate`, { digit: '1' });
  assert.match(r.data.reply, /confirm|உறுதி/);
  const calls = (await api('GET', '/api/visits/calls')).data.calls;
  assert.equal(calls.find((c: any) => c.id === placed.data.id).outcome, 'confirmed');
});

test('platform admin console: admins only, with agent runs and leads', async () => {
  const lead = await api('POST', '/api/public/leads', { name: 'Dr. Test', email: 'lead@example.com', orgName: 'Test Clinic', institutionType: 'clinic' });
  assert.equal(lead.status, 200);
  const o = await api('GET', '/api/admin/overview');
  assert.equal(o.status, 200);
  assert.ok(o.data.runs.total > 0);
  const agents = (await api('GET', '/api/admin/agents')).data;
  assert.ok(agents.byAgent.find((a: any) => a.agent === 'safety'));
  assert.ok(agents.byAgent.find((a: any) => a.agent === 'intake'));
  const fails = (await api('GET', '/api/admin/failures')).data;
  assert.ok(fails.byTag.find((t: any) => t.tag === 'handoff.emergency'));
  const leads = (await api('GET', '/api/admin/leads')).data;
  assert.ok(leads.find((l: any) => l.email === 'lead@example.com'));
  for (const p of ['usage', 'providers', 'workspaces', 'audit']) assert.equal((await api('GET', `/api/admin/${p}`)).status, 200);
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
  const sent = await fetch(`${base}/widget/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` }, body: JSON.stringify({ content: 'Do you have a branch in Tambaram?' }) }).then((r) => r.json());
  const conv = await waitFor(async () => {
    const d = await api('GET', `/api/inbox/conversations/${sent.conversationId}`);
    return d.data.conversation.status === 'escalated' && d.data;
  }, 'escalation');
  // Ask the AI for a suggestion via an @AI note, then edit and send it.
  await api('POST', `/api/inbox/conversations/${sent.conversationId}/messages`, { content: '@AI tell them we only have the Anna Nagar hospital for now', note: true });
  const withDraft = await api('GET', `/api/inbox/conversations/${sent.conversationId}`);
  const draft = withDraft.data.drafts.find((d: any) => d.status === 'pending');
  const finalText = 'We have only one hospital, in Anna Nagar, for now. There is no branch in Tambaram yet.';
  if (draft) {
    assert.equal((await api('POST', `/api/inbox/conversations/${sent.conversationId}/drafts/${draft.id}`, { decision: 'send', text: finalText })).status, 200);
  } else {
    // No draft could be produced from knowledge: reply manually and teach the AI.
    const msg = await api('POST', `/api/inbox/conversations/${sent.conversationId}/messages`, { content: finalText });
    await api('POST', `/api/inbox/messages/${msg.data.id}/learn`, {});
  }
  assert.ok(conv);
  const ask = await api('POST', '/api/knowledge/ask', { question: 'Do you have a branch in Tambaram?' });
  assert.equal(ask.data.kind, 'answer');
  assert.match(ask.data.text, /Anna Nagar/);
});

test('simulation reports a pass rate', async () => {
  const created = await api('POST', '/api/simulations', { name: 'CI', questions: 'What are the OPD timings? => 8:00 AM\nDo you sell green tea?\nIs parking available? => basement' });
  assert.equal(created.status, 200);
  const sim = await waitFor(async () => {
    const d = await api('GET', `/api/simulations/${created.data.id}`);
    return d.data.simulation.status === 'done' && d.data;
  }, 'simulation');
  assert.equal(sim.simulation.total, 3);
  assert.equal(sim.cases.find((c: any) => c.question.includes('green tea')).passed, false);
  assert.equal(sim.cases.find((c: any) => c.question.includes('OPD')).passed, true);
});

test('analytics and DPDP export/erase', async () => {
  const a = await api('GET', '/api/analytics?days=30');
  assert.ok(a.data.totals.conversations >= 10);
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

test('patient chat collects reports, links staff context and isolates visitor identity', async () => {
  const pub = await api('GET', '/api/public/config');
  const s = await api('POST', '/widget/session', { siteKey: pub.data.demoSiteKey });
  const W = { authorization: `Bearer ${s.data.token}` };
  let id: string;
  const send = async (content: string, count: number) => {
    const r = await api('POST', '/widget/messages', { content, conversationId: id }, W);
    id = r.data.conversationId;
    return waitFor(async () => {
      const t = (await api('GET', '/widget/conversation', undefined, W)).data;
      const replies = t.messages.filter((m: any) => m.role === 'ai');
      return replies.length >= count && replies[count - 1].content;
    }, 'patient reply');
  };
  assert.match(await send('book appointment with Dr. Narmadha Vasu', 1), /Narmadha/);
  await send('1', 2);
  await send('Synthetic Upload Patient 9876501234', 3);
  const detail = (await api('GET', `/api/inbox/conversations/${id!}`)).data;
  assert.ok(detail.patient.client.id);
  assert.equal(detail.patient.appointment.staff_name, 'Dr. Narmadha Vasu');
  assert.equal(detail.conversation.meta.clientId, detail.patient.client.id);
  const { ctx } = await import('../src/ctx.ts');
  const other = await ctx.db.one(`select id from clients where name = 'Test Patient Kumar'`);
  assert.notEqual(detail.patient.client.id, other?.id); // same phone must not join another visitor's record
  assert.match(await send('I want to upload a report', 4), /Attach report|visit page/);
  const form = new FormData(); form.set('conversationId', id!);
  form.set('file', new Blob(['Synthetic only\nHbA1c 5.2 % 4.0 - 5.6'], { type: 'text/plain' }), 'chat-report.txt');
  const r = await fetch(base + '/widget/records', { method: 'POST', headers: W, body: form });
  assert.equal(r.status, 200);
  await waitFor(async () => {
    const d = (await api('GET', `/api/inbox/conversations/${id!}`)).data;
    return d.patient.records.some((x: any) => x.title === 'chat-report.txt' && x.status === 'processed');
  }, 'chat report ingested');
  const outsider = (await api('POST', '/widget/session', { siteKey: pub.data.demoSiteKey })).data;
  const attack = new FormData(); attack.set('conversationId', id!); attack.set('file', new Blob(['test']), 'other.txt');
  assert.equal((await fetch(base + '/widget/records', { method: 'POST', headers: { authorization: `Bearer ${outsider.token}` }, body: attack })).status, 404);
});

test('concurrent proactive deliveries emit one patient message and recover an expired claim', async () => {
  const { ctx } = await import('../src/ctx.ts');
  const { getOrg } = await import('../src/services/orgs.ts');
  const { queueMessage, deliverDue } = await import('../src/services/visits.ts');
  const me = (await api('GET', '/api/me')).data;
  const org = (await getOrg(me.org.id))!;
  const client = (await ctx.db.one<{ id: string }>("select id from clients where org_id = $1 and name = 'Synthetic Upload Patient'", [org.id]))!;
  const id = await queueMessage(org, client.id, 'custom', 'One synthetic notification.', { sendAt: new Date(Date.now() + 60_000) });
  await ctx.db.query('update outbox set send_at = now() where id = $1', [id]);
  await Promise.all([deliverDue(id), deliverDue(id), deliverDue(id)]);
  assert.equal((await ctx.db.one<{ n: number }>('select count(*)::int as n from messages where id = $1', [id]))!.n, 1);
  await ctx.db.query(`update outbox set status = 'sending', meta = meta || jsonb_build_object('deliveryClaimedAt', now() - interval '11 minutes') where id = $1`, [id]);
  await deliverDue(id);
  assert.equal((await ctx.db.one<{ n: number }>('select count(*)::int as n from messages where id = $1', [id]))!.n, 1);
  assert.equal((await ctx.db.one<{ status: string }>('select status from outbox where id = $1', [id]))!.status, 'sent');
});

test('burst messages give one consolidated reply and unrelated requests are flagged', async () => {
  const pub = (await api('GET', '/api/public/config')).data;
  const s = (await api('POST', '/widget/session', { siteKey: pub.demoSiteKey })).data;
  const W = { authorization: `Bearer ${s.token}` };
  const sent = await api('POST', '/widget/messages', { content: 'What is the consultation fee?' }, W);
  const id = sent.data.conversationId;
  await api('POST', '/widget/messages', { content: 'What is the consultation fee?', conversationId: id }, W);
  await waitFor(async () => (await api('GET', '/widget/conversation', undefined, W)).data.messages.some((m: any) => m.role === 'ai'), 'consolidated reply');
  await sleep(450);
  const repeat = await api('POST', '/widget/messages', { content: 'What is the consultation fee?', conversationId: id }, W);
  assert.equal(repeat.data.duplicate, true); // also after the batching window / original reply
  await sleep(450);
  assert.equal((await api('GET', '/widget/conversation', undefined, W)).data.messages.filter((m: any) => m.role === 'ai').length, 1);
  assert.match((await api('GET', '/widget/conversation', undefined, W)).data.messages.find((m: any) => m.role === 'ai').content, /₹500/);
  await api('POST', '/widget/messages', { content: 'write me a poem', conversationId: id }, W);
  await waitFor(async () => (await api('GET', `/api/inbox/conversations/${id}`)).data.conversation.meta.reviewFlag === 'off_topic', 'off-topic flag');
  assert.ok((await api('GET', '/api/inbox/conversations?view=attention')).data.conversations.some((c: any) => c.id === id));
  assert.equal((await api('POST', `/api/inbox/conversations/${id}/clear-flag`, {})).status, 200);
});

test('Gemini BYOK routes redacted questions and rejects uncited model answers', async () => {
  let cited = true;
  let received = '';
  const model = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    received = text;
    assert.equal(req.headers.authorization, 'Bearer local-gemini-test-key');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model: 'gemini-2.5-flash', choices: [{ message: { content: JSON.stringify({ answer: 'Consultation is ₹500.', cited: cited ? [1] : [], confidence: .95, handoff: false }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  try {
    await api('PUT', '/api/workspace/model', { provider: 'gemini', apiKey: 'local-gemini-test-key', baseUrl: `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1` });
    const first = await api('POST', '/api/knowledge/ask', { question: 'my number is 9876543210. What is the consultation fee?' });
    assert.equal(first.data.kind, 'answer');
    assert.match(first.data.engine, /gemini/);
    assert.ok(first.data.citations.length);
    assert.ok(!received.includes('9876543210'));
    cited = false;
    const invalid = await api('POST', '/api/knowledge/ask', { question: 'What are consultation fees for new patients?' });
    assert.equal(invalid.data.kind, 'handoff');
  } finally {
    await api('PUT', '/api/workspace/model', { provider: 'extractive' });
    await new Promise<void>(resolve => model.close(() => resolve()));
  }
});

test('Gemini without a key uses a visible safe fallback', async () => {
  await api('PUT', '/api/workspace/model', { provider: 'gemini', model: 'gemini-2.5-flash' });
  assert.equal((await api('GET', '/api/workspace/model')).data.connected, false);
  assert.equal((await api('POST', '/api/workspace/model/test', {})).data.ok, false);
  const q = await api('POST', '/api/knowledge/ask', { question: 'What is the consultation fee?' });
  assert.equal(q.data.kind, 'answer');
  assert.match(q.data.engine, /BYOK key required/);
  await api('PUT', '/api/workspace/model', { provider: 'extractive' });
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
  assert.equal((await api('POST', '/api/knowledge/ask', { question: 'What are the OPD timings?' })).status, 200);
  const cfg = await api('GET', '/api/public/config');
  assert.equal('demoEmail' in cfg.data, false);
  await api('POST', '/api/auth/logout', {});
});

test('agent pipelines: public message/report runs stream to done; day brief needs staff', async () => {
  const run = async (path: string, text: string) => {
    const r = await api('POST', path, { text });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return waitFor(async () => {
      const s = (await api('GET', `${path}/${r.data.id}`)).data;
      return s.status !== 'running' && s;
    }, 'pipeline');
  };
  const book = await run('/api/public/runs', 'அப்பாயின்ட்மென்ட் வேண்டும், சர்க்கரை நோய் மருத்துவர்');
  assert.equal(book.kind, 'message');
  assert.equal(book.agents.find((a: any) => a.id === 'booking').status, 'done');
  assert.ok(book.agents.filter((a: any) => a.stage === 1).length >= 3, 'parallel stage');
  assert.match(book.report.find((s: any) => s.id === 'reply').body, /Dr\. Lakshmi Narayanan/);
  const em = await run('/api/public/runs', 'My father has chest pain and is sweating');
  assert.match(em.report.find((s: any) => s.id === 'reply').body, /108/);
  assert.equal(em.agents.find((a: any) => a.id === 'knowledge').status, 'skipped');
  assert.match(em.report.find((s: any) => s.id === 'next').items.join(' '), /no staff alert/);
  const rep = await run('/api/public/runs', 'Potassium 6.9 mmol/L 3.5 - 5.1\nHbA1c 9.0 % 4.0 - 5.6\nTab. Metformin 500 mg');
  assert.equal(rep.kind, 'report');
  assert.ok(rep.report.find((s: any) => s.id === 'critical'));
  assert.ok(rep.report.find((s: any) => s.id === 'draft'));
  assert.match(rep.report.find((s: any) => s.id === 'note').body, /no approval request is created/);
  // "Brief me on today" is a normal message for the public; staff get the day pipeline.
  const pub = await run('/api/public/runs', 'Brief me on today');
  assert.equal(pub.kind, 'message');
  const loggedIn = await api('POST', '/api/auth/login', { email: 'demo@relay.local', password: 'relay-demo-1234' });
  assert.equal(loggedIn.status, 200);
  const day = await run('/api/runs', 'Brief me on today');
  assert.equal(day.kind, 'day');
  assert.ok(day.report.find((s: any) => s.id === 'priorities'));
  const res = await fetch(`${base}/api/runs/${day.id}/stream`, { headers: { cookie } });
  assert.match(await res.text(), /event: run/);
});
