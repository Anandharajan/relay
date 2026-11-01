import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
process.env.DATA_DIR = ":memory:";
process.env.DATABASE_URL = "";
process.env.DEMO_SEED = "false";
process.env.LLM_PROVIDER = "extractive";
process.env.RELAY_SECRET = "voice-test-secret-not-a-production-secret";
const { ctx } = await import("../src/ctx.ts");
const { openDb } = await import("../src/db.ts");
const { buildApp } = await import("../src/app.ts");
const { processVoiceDocument, processVoiceRun, renderVoiceRun, verifyClaims, chunkVoiceDocument } = await import(
  "../src/services/voice-desk.ts"
);
const { speakable } = await import("../src/lib/speakable.ts");
const { decrypt, signJwt, uuid, hashPassword } = await import(
  "../src/lib/crypto.ts"
);
const app = buildApp();
let cookie = "",
  otherCookie = "",
  orgId = "",
  clientId = "",
  otherClient = "",
  voiceId = "",
  runId = "",
  calls = 0;
// A contract fixture, deliberately not represented as a real voice model.
const wav = Buffer.alloc(1644);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24);
wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
let failAudio = false,
  modelReply = "The workshop begins on Monday at 9 AM [1].",
  modelInput = "",
  transcript = "When does the onboarding workshop begin?",
  consentCalls = 0,
  spokenInput = "";
const engine = createServer(async (req, res) => {
  calls++;
  const body: Buffer[] = [];
  for await (const chunk of req) body.push(Buffer.from(chunk));
  if (req.url === "/profiles" && req.method === "POST") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "fixture-profile" }));
  } else if (req.url === "/v1/audio/transcriptions") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ text: transcript }),
    );
  } else if (req.url === "/v1/audio/speech") {
    if (failAudio) {
      res.statusCode = 503;
      res.end("unavailable");
      return;
    }
    spokenInput = JSON.parse(Buffer.concat(body).toString()).input;
    res.setHeader("content-type", "audio/wav");
    res.end(wav);
  } else if (req.url === "/v1/chat/completions") {
    modelInput = Buffer.concat(body).toString();
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: modelReply } }],
        usage: { prompt_tokens: 100, completion_tokens: 30 },
      }),
    );
  } else if (/^\/profiles\/[^/]+\/(consent|attestation)$/.test(req.url!)) {
    consentCalls++;
    res.setHeader("content-type", "application/json");
    res.end("{}");
  } else if (req.url === "/health") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "ok", device: "cpu", version: "9.9.9" }));
  } else if (req.url === "/.well-known/voicestudio-speech") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        protocol: "voicestudio.speech.v1",
        features: { streaming_transcription: true },
      }),
    );
  } else if (req.url === "/engines/tts") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        active: "omnivoice",
        backends: [
          { id: "omnivoice", display_name: "OmniVoice", available: true },
          { id: "kittentts", supports_cloning: false },
        ],
      }),
    );
  } else if (req.method === "DELETE") {
    res.end("{}");
  } else {
    res.statusCode = 404;
    res.end();
  }
});
async function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    form?: FormData;
    jar?: string;
    csrf?: boolean;
  } = {},
) {
  const headers: Record<string, string> = { cookie: options.jar ?? cookie };
  if (options.csrf !== false) headers["x-relay-csrf"] = "1";
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return app.request("http://localhost" + path, {
    method: options.method || (options.form || options.body ? "POST" : "GET"),
    headers,
    body:
      options.form ?? (options.body ? JSON.stringify(options.body) : undefined),
  });
}
async function json(path: string, options: Parameters<typeof request>[1] = {}) {
  const res = await request(path, options);
  const data = (await res.json()) as any;
  assert.ok(res.ok, `${res.status} ${JSON.stringify(data)}`);
  return data;
}
function audioForm() {
  const f = new FormData();
  f.set("file", new Blob([wav], { type: "audio/wav" }), "sample.wav");
  return f;
}
function runForm(client = clientId, profession = "general") {
  const f = audioForm();
  f.set("clientId", client);
  f.set("profession", profession);
  f.set("task", "summary");
  f.set("voiceId", voiceId);
  f.set("providerConsent", "yes");
  return f;
}
before(async () => {
  ctx.db = await openDb({
    databaseUrl: process.env.TEST_VOICE_DATABASE_URL || "",
    dataDir: ":memory:",
  });
  await new Promise<void>((resolve) => engine.listen(0, "127.0.0.1", resolve));
  process.env.VOICESTUDIO_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
  for (const n of ["first", "second"]) {
    const res = await request("/api/auth/signup", {
      body: {
        name: n,
        email: `${n}-${uuid()}@voice.test`,
        password: "voice-test-password",
        orgName: `${n} voice team`,
      },
      jar: "",
    });
    assert.equal(res.status, 200);
    const jar = res.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; ");
    if (n === "first") cookie = jar;
    else otherCookie = jar;
  }
  orgId = (await json("/api/me")).org.id;
});
after(async () => {
  engine.closeAllConnections();
  await new Promise<void>((resolve) => engine.close(() => resolve()));
  await ctx.db.close();
});
test("voice routes require authentication, CSRF and an explicitly allowed speech host", async () => {
  assert.equal(
    (await request("/api/voice/bootstrap", { jar: "" })).status,
    401,
  );
  assert.equal(
    (
      await request("/api/voice/clients", {
        body: { name: "Blocked" },
        csrf: false,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/voice/settings", {
        method: "PUT",
        body: {
          sttUrl: "https://169.254.169.254/latest",
          sttModel: "whisper-1",
          ttsProvider: "none",
          ttsModel: "x",
          engine: "",
        },
      })
    ).status,
    400,
  );
  await json("/api/voice/settings", {
    method: "PUT",
    body: {
      sttUrl: "",
      sttModel: "whisper-1",
      ttsProvider: "voicestudio",
      ttsModel: "eleven_multilingual_v2",
      engine: "",
      sttKey: "secret-test-key",
    },
  });
  const settings = await ctx.db.one(
    "select secrets_enc from voice_settings where org_id=$1",
    [orgId],
  );
  assert.ok(!settings!.secrets_enc.includes("secret-test-key"));
  assert.match(decrypt(settings!.secrets_enc), /secret-test-key/);
  assert.ok(
    !JSON.stringify(await json("/api/voice/bootstrap")).includes(
      "secret-test-key",
    ),
  );
});
test("widget voice is off by default, hidden, and never spends the operator speech service", async () => {
  const before = (await ctx.db.one("select count(*)::int as n from voice_runs"))!.n;
  const token = await signJwt({ sub: uuid(), org: orgId, typ: "visitor" }, "1h");
  const post = (form: FormData) =>
    app.request("http://localhost/widget/voice/transcribe", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  const siteKey = (await json("/api/me")).org.siteKey;
  const session = async () =>
    (await (
      await app.request("http://localhost/widget/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteKey }),
      })
    ).json()) as any;
  assert.equal(
    (await app.request("http://localhost/widget/voice/transcribe", { method: "POST", body: audioForm() })).status,
    401,
  );
  const consented = () => {
    const f = audioForm();
    f.set("providerConsent", "yes");
    return f;
  };
  assert.equal((await post(consented())).status, 403);
  assert.equal((await session()).config.voiceInput, false);
  const settings = {
    sttUrl: "",
    sttModel: "whisper-1",
    ttsProvider: "voicestudio",
    ttsModel: "eleven_multilingual_v2",
    engine: "",
  };
  // Enabled, but the only speech service is the operator's: still unavailable to visitors.
  await json("/api/voice/settings", { method: "PUT", body: { ...settings, widgetVoice: true } });
  assert.equal((await post(consented())).status, 403);
  assert.equal((await session()).config.voiceInput, false);
  process.env.SPEECH_ALLOW_PRIVATE_HOSTS = "true";
  await json("/api/voice/settings", {
    method: "PUT",
    body: { ...settings, widgetVoice: true, sttUrl: process.env.VOICESTUDIO_URL + "/v1" },
  });
  delete process.env.SPEECH_ALLOW_PRIVATE_HOSTS;
  assert.equal((await session()).config.voiceInput, true);
  // A saved local address stops working the moment the operator's opt-in is gone.
  assert.equal((await post(consented())).status, 400);
  process.env.SPEECH_ALLOW_PRIVATE_HOSTS = "true";
  assert.equal((await post(audioForm())).status, 400);
  const response = await post(consented());
  assert.equal(response.status, 200);
  assert.match(((await response.json()) as any).text, /workshop/);
  delete process.env.SPEECH_ALLOW_PRIVATE_HOSTS;
  assert.equal((await ctx.db.one("select count(*)::int as n from voice_runs"))!.n, before);
  assert.equal(
    (await app.request("http://localhost/api/voice/bootstrap", { headers: { authorization: `Bearer ${token}` } })).status,
    401,
  );
  await json("/api/voice/settings", { method: "PUT", body: settings });
});
test("workspaces cannot point speech at internal addresses unless the operator opts in", async () => {
  for (const url of ["http://localhost:8821", "http://127.0.0.1:8821", "http://host.docker.internal:3900", "http://169.254.169.254/latest", "http://[::1]:3900"]) {
    for (const key of ["sttUrl", "voicestudioUrl"]) {
      const res = await request("/api/voice/settings", {
        method: "PUT",
        body: { sttUrl: "", sttModel: "whisper-1", ttsProvider: "none", ttsModel: "x", engine: "", [key]: url },
      });
      assert.equal(res.status, 400, `${key}=${url}`);
    }
  }
  process.env.SPEECH_ALLOW_PRIVATE_HOSTS = "true";
  try {
    assert.equal(
      (
        await request("/api/voice/settings", {
          method: "PUT",
          body: { sttUrl: "http://169.254.169.254/latest", sttModel: "whisper-1", ttsProvider: "none", ttsModel: "x", engine: "" },
        })
      ).status,
      400,
    );
  } finally {
    delete process.env.SPEECH_ALLOW_PRIVATE_HOSTS;
  }
  await json("/api/voice/settings", {
    method: "PUT",
    body: { sttUrl: "", sttModel: "whisper-1", ttsProvider: "voicestudio", ttsModel: "eleven_multilingual_v2", engine: "" },
  });
});
test("a workspace connects its own VoiceStudio and sees its engines", async () => {
  const base = { sttUrl: "", sttModel: "whisper-1", ttsProvider: "voicestudio", ttsModel: "eleven_multilingual_v2", engine: "" };
  process.env.SPEECH_ALLOW_PRIVATE_HOSTS = "true";
  try {
    await json("/api/voice/settings", {
      method: "PUT",
      body: { ...base, voicestudioUrl: process.env.VOICESTUDIO_URL, voicestudioKey: "studio-secret" },
    });
    const status = await json("/api/voice/voicestudio/status");
    assert.equal(status.state, "connected");
    assert.equal(status.version, "9.9.9");
    assert.equal(status.streaming, true);
    assert.deepEqual(status.engines, [{ id: "omnivoice", name: "OmniVoice", available: true }]);
    const boot = await json("/api/voice/bootstrap");
    assert.equal(boot.speech.voicestudioKeySaved, true);
    assert.ok(!JSON.stringify(boot).includes("studio-secret"));
  } finally {
    delete process.env.SPEECH_ALLOW_PRIVATE_HOSTS;
    await json("/api/voice/settings", { method: "PUT", body: base });
  }
});
test("client documents index with org and client isolation", async () => {
  clientId = (
    await json("/api/voice/clients", { body: { name: "Workshop team" } })
  ).id;
  otherClient = (
    await json("/api/voice/clients", { body: { name: "Private team" } })
  ).id;
  for (const [id, text] of [
    [
      clientId,
      "The onboarding workshop begins on Monday at 9 AM. Bring your employee handbook.",
    ],
    [otherClient, "CONFIDENTIAL_ZEBRA: Private salary planning only."],
  ]) {
    const f = new FormData();
    f.set("file", new Blob([text!]), "policy.txt");
    const d = await json(`/api/voice/clients/${id}/documents`, { form: f });
    await processVoiceDocument({ documentId: d.id, orgId });
    const row = await ctx.db.one(
      "select raw_enc,status from voice_documents where id=$1",
      [d.id],
    );
    assert.equal(row!.status, "ready");
    assert.ok(!row!.raw_enc.includes(text!));
  }
  assert.equal(
    (
      await request(`/api/voice/clients/${clientId}/documents`, {
        jar: otherCookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (await request("/api/voice/runs", { form: runForm(), jar: otherCookie }))
      .status,
    404,
  );
});
function enrollForm(challengeId: string) {
  const f = audioForm();
  f.set("challengeId", challengeId);
  f.set("name", "My authorized voice");
  f.set("consent", "live-phrase-v2");
  f.set("providerConsent", "yes");
  return f;
}
test("enrollment requires reading a fresh server phrase; a recording of anything else is refused", async () => {
  const challenge = () => json("/api/voice/profiles/challenge", { body: {} });
  const first = await challenge();
  assert.match(first.phrase, /own voice/);
  assert.notEqual((await challenge()).phrase, first.phrase);
  // No consent: the speech engine is never contacted.
  const noConsent = audioForm();
  noConsent.set("challengeId", first.id);
  const before = calls;
  assert.equal((await request("/api/voice/profiles", { form: noConsent })).status, 400);
  assert.equal(calls, before);
  // Someone else's recording says something else.
  transcript = "This is a clip of another person talking about their holiday.";
  const wrong = await request("/api/voice/profiles", { form: enrollForm(first.id) });
  assert.equal(wrong.status, 400);
  assert.match(((await wrong.json()) as any).error, /did not match/);
  // One attempt per phrase, even with the right words.
  transcript = first.phrase;
  assert.equal((await request("/api/voice/profiles", { form: enrollForm(first.id) })).status, 400);
  // Expired and other users' phrases are refused too.
  const expired = await challenge();
  await ctx.db.query("update voice_challenges set expires_at=now()-interval '1 minute' where id=$1", [expired.id]);
  transcript = expired.phrase;
  assert.equal((await request("/api/voice/profiles", { form: enrollForm(expired.id) })).status, 400);
  const foreign = await challenge();
  assert.equal(
    (await request("/api/voice/profiles", { form: enrollForm(foreign.id), jar: otherCookie })).status,
    400,
  );
  const live = await challenge();
  // Recognition may differ slightly, but the code words must be heard.
  transcript = live.phrase.toLowerCase().replace(/[.,]/g, "").replace("for relay", "for really");
  const consentBefore = consentCalls;
  voiceId = (await json("/api/voice/profiles", { form: enrollForm(live.id) })).id;
  assert.equal(consentCalls, consentBefore + 2);
  transcript = "When does the onboarding workshop begin?";
  const row = await ctx.db.one("select * from voice_profiles where id=$1", [
    voiceId,
  ]);
  assert.equal(row!.consent_version, "live-phrase-v2");
  assert.ok(row!.sample_enc);
  assert.deepEqual(Buffer.from(decrypt(row!.sample_enc), "base64"), wav);
  const userId = uuid();
  await ctx.db.query(
    "insert into users(id,email,name,password_hash) values($1,$2,$3,$4)",
    [
      userId,
      `${userId}@voice.test`,
      "Coworker",
      await hashPassword("password123"),
    ],
  );
  await ctx.db.query(
    "insert into members(org_id,user_id,role) values($1,$2,'agent')",
    [orgId, userId],
  );
  const jwt = await signJwt({ sub: userId, typ: "user" }, "1h");
  const jar = `relay_session=${jwt}`;
  assert.equal((await json("/api/voice/bootstrap", { jar })).voices.length, 0);
  assert.equal(
    (await request(`/api/voice/profiles/${voiceId}`, { method: "DELETE", jar }))
      .status,
    404,
  );
});
test("recording → transcription → scoped retrieval → encrypted audio → download", async () => {
  const f = runForm();
  runId = (await json("/api/voice/runs", { form: f })).id;
  await processVoiceRun({ runId, orgId });
  const row = await ctx.db.one("select * from voice_runs where id=$1", [runId]);
  assert.equal(row!.status, "ready");
  assert.equal(row!.input_enc, null);
  assert.match(row!.question, /onboarding/);
  assert.match(row!.answer, /Monday/);
  assert.ok(!row!.answer.includes("CONFIDENTIAL_ZEBRA"));
  assert.equal(row!.citations.length, 1);
  assert.ok(row!.steps.length >= 4);
  assert.deepEqual(Buffer.from(decrypt(row!.output_enc), "base64"), wav);
  const result = await request(`/api/voice/runs/${runId}/audio?download=1`);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("content-disposition")!, /attachment/);
  assert.match(result.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), wav);
  assert.equal(
    (await request(`/api/voice/runs/${runId}/audio`, { jar: otherCookie }))
      .status,
    404,
  );
});
test("healthcare drafts require approval before synthesis", async () => {
  const id = (
    await json("/api/voice/runs", { form: runForm(clientId, "healthcare") })
  ).id;
  await processVoiceRun({ runId: id, orgId });
  let row = await ctx.db.one("select * from voice_runs where id=$1", [id]);
  assert.equal(row!.status, "review");
  assert.equal(row!.output_enc, null);
  assert.equal((await request(`/api/voice/runs/${id}/audio`)).status, 404);
  await json(`/api/voice/runs/${id}/approve`, {
    body: { answer: "Reviewed: the workshop begins on Monday at 9 AM." },
  });
  await renderVoiceRun({ runId: id, orgId });
  row = await ctx.db.one("select * from voice_runs where id=$1", [id]);
  assert.equal(row!.status, "ready");
  assert.ok(row!.approved_at);
});
test("BYOK receives only redacted client context; uncited answers fall back for review", async () => {
  await json("/api/workspace/model", {
    method: "PUT",
    body: {
      provider: "openai-compatible",
      model: "fixture-model",
      baseUrl: process.env.VOICESTUDIO_URL + "/v1",
    },
  });
  try {
    const f = runForm();
    f.set("voiceId", "");
    f.set(
      "question",
      "My email is private@example.test. Summarize the workshop.",
    );
    const { id } = await json("/api/voice/runs", { form: f });
    await processVoiceRun({ runId: id, orgId });
    const r = (await ctx.db.one("select * from voice_runs where id=$1", [id]))!;
    assert.equal(r.status, "ready_text");
    assert.match(r.answer, /Monday/);
    assert.match(r.question, /Additional instructions/);
    assert.ok(!modelInput.includes("private@example.test"));
    assert.ok(!modelInput.includes("CONFIDENTIAL_ZEBRA"));
    modelReply = "Unsupported claim without a citation.";
    const f2 = runForm();
    f2.set("voiceId", "");
    const invalid = await json("/api/voice/runs", { form: f2 });
    await processVoiceRun({ runId: invalid.id, orgId });
    const checked = (await ctx.db.one("select * from voice_runs where id=$1", [
      invalid.id,
    ]))!;
    assert.equal(checked.status, "review");
    assert.ok(!checked.answer.includes("Unsupported claim"));
    assert.match(checked.answer, /Monday/);
  } finally {
    await json("/api/workspace/model", {
      method: "PUT",
      body: { provider: "extractive" },
    });
  }
});
test("spoken audio omits citations while the on-screen reply keeps them", async () => {
  const { id } = await json("/api/voice/runs", { form: runForm() });
  spokenInput = "";
  await processVoiceRun({ runId: id, orgId });
  const r = (await ctx.db.one("select answer from voice_runs where id=$1", [id]))!;
  assert.match(r.answer, /\[1\]/);
  assert.match(spokenInput, /Monday/);
  assert.ok(!/\[\d+\]/.test(spokenInput));
});
test("speech failures retain a retryable draft, and retry succeeds", async () => {
  const { id } = await json("/api/voice/runs", { form: runForm() });
  failAudio = true;
  try {
    await assert.rejects(() => processVoiceRun({ runId: id, orgId }), /503/);
    const failed = (await ctx.db.one("select * from voice_runs where id=$1", [
      id,
    ]))!;
    assert.equal(failed.status, "audio_failed");
    assert.match(failed.answer, /Monday/);
    assert.equal(failed.output_enc, null);
  } finally {
    failAudio = false;
  }
  await json(`/api/voice/runs/${id}/approve`,{body:{answer:'Human-reviewed workshop reply.'}});
  await processVoiceRun({ runId: id, orgId });
  assert.equal((await ctx.db.one('select answer from voice_runs where id=$1',[id]))!.answer,'Human-reviewed workshop reply.');
  assert.equal(
    (await ctx.db.one("select status from voice_runs where id=$1", [id]))!
      .status,
    "ready",
  );
});
test("revocation removes local reference and blocks all linked audio", async () => {
  await json(`/api/voice/profiles/${voiceId}`, { method: "DELETE" });
  const p = await ctx.db.one("select * from voice_profiles where id=$1", [
    voiceId,
  ]);
  assert.ok(p!.revoked_at);
  assert.equal(p!.sample_enc, null);
  assert.equal((await request(`/api/voice/runs/${runId}/audio`)).status, 404);
  const outputs = await ctx.db.query(
    "select output_enc from voice_runs where voice_id=$1",
    [voiceId],
  );
  assert.ok(outputs.every((r) => r.output_enc === null));
  assert.equal(
    (await request("/api/voice/runs", { form: runForm() })).status,
    404,
  );
});
test("PDF and DOCX files use the real extraction libraries", async () => {
  for (const ext of ["pdf", "docx"]) {
    const bytes = await readFile(
      new URL(`./fixtures/voice-policy.${ext}`, import.meta.url),
    );
    const f = new FormData();
    f.set("file", new Blob([bytes]), `policy.${ext}`);
    const { id } = await json(`/api/voice/clients/${clientId}/documents`, {
      form: f,
    });
    await processVoiceDocument({ documentId: id, orgId });
    const chunk = await ctx.db.one(
      "select content from voice_chunks where document_id=$1",
      [id],
    );
    assert.match(chunk!.content, /workshop begins on Monday/);
  }
});
test("the durable queue executes a typed question without a speech engine", async () => {
  const { registerJob, startJobs, drainJobs } = await import(
    "../src/jobs/runner.ts"
  );
  // Earlier tests called handlers directly to inspect each boundary.
  await ctx.db.query("update jobs set status='done' where type like 'voice_%'");
  registerJob("voice_document", processVoiceDocument);
  registerJob("voice_process", processVoiceRun);
  registerJob("voice_render", renderVoiceRun);
  const f = new FormData();
  f.set("clientId", clientId);
  f.set("profession", "general");
  f.set("task", "summary");
  f.set("question", "Summarize the onboarding workshop");
  f.set("providerConsent", "yes");
  const { id } = await json("/api/voice/runs", { form: f });
  await startJobs([]);
  try {
    let status = "";
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      status = (await ctx.db.one("select status from voice_runs where id=$1", [
        id,
      ]))!.status;
      if (status === "ready_text") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(status, "ready_text");
    const run = await ctx.db.one("select answer from voice_runs where id=$1", [
      id,
    ]);
    assert.match(run!.answer, /Monday/);
  } finally {
    await drainJobs();
  }
});
test("extractive replies pick the sentences that answer, not the whole passage", async () => {
  const { id: client } = await json("/api/voice/clients", { body: { name: "Student" } });
  const f = new FormData();
  f.set("file", new Blob(["The physics exam is on 12 March in hall B. Tuition fees of 40000 rupees are due in June. Attendance must stay above 75 percent all year."]), "notes.txt");
  const doc = await json(`/api/voice/clients/${client}/documents`, { form: f });
  await processVoiceDocument({ documentId: doc.id, orgId });
  const q = new FormData();
  q.set("clientId", client);
  q.set("profession", "general");
  q.set("task", "answer");
  q.set("question", "When is the physics exam?");
  q.set("providerConsent", "yes");
  const { id } = await json("/api/voice/runs", { form: q });
  await processVoiceRun({ runId: id, orgId });
  const r = (await ctx.db.one("select answer,status from voice_runs where id=$1", [id]))!;
  assert.match(r.answer, /12 March/);
  assert.ok(!/fees|Attendance/i.test(r.answer), r.answer);
  assert.match(r.answer, /\[1\]$/);
});
test("a failed document no longer blocks the client; the reply says what was not searched", async () => {
  const { id: client } = await json("/api/voice/clients", { body: { name: "Partial" } });
  const good = new FormData();
  good.set("file", new Blob(["The induction session starts at 10 AM on Tuesday in room four."]), "good.txt");
  const doc = await json(`/api/voice/clients/${client}/documents`, { form: good });
  await processVoiceDocument({ documentId: doc.id, orgId });
  const bad = new FormData();
  bad.set("file", new Blob(["x"]), "scan.txt");
  const failed = await json(`/api/voice/clients/${client}/documents`, { form: bad });
  await assert.rejects(() => processVoiceDocument({ documentId: failed.id, orgId }), /No readable text/);
  const q = new FormData();
  q.set("clientId", client);
  q.set("profession", "general");
  q.set("task", "answer");
  q.set("question", "When does the induction session start?");
  q.set("providerConsent", "yes");
  const { id } = await json("/api/voice/runs", { form: q });
  await processVoiceRun({ runId: id, orgId });
  const r = (await ctx.db.one("select * from voice_runs where id=$1", [id]))!;
  assert.equal(r.status, "review");
  assert.match(r.answer, /Tuesday/);
  assert.deepEqual(r.skipped_documents, [{ name: "scan.txt", reason: "could not be read" }]);
});
test("a vague request asks one clarifying question, then continues", async () => {
  const q = new FormData();
  q.set("clientId", clientId);
  q.set("profession", "general");
  q.set("task", "answer");
  q.set("question", "what about that?");
  q.set("providerConsent", "yes");
  const { id } = await json("/api/voice/runs", { form: q });
  await processVoiceRun({ runId: id, orgId });
  let r = (await ctx.db.one("select * from voice_runs where id=$1", [id]))!;
  assert.equal(r.status, "needs_input");
  assert.ok(r.clarify_question);
  assert.equal(r.steps.find((s: any) => s.id === "plan").status, "done");
  await json(`/api/voice/runs/${id}/clarify`, { body: { answer: "When does the onboarding workshop begin?" } });
  await processVoiceRun({ runId: id, orgId });
  r = (await ctx.db.one("select * from voice_runs where id=$1", [id]))!;
  assert.match(r.answer, /Monday/);
  assert.equal(r.clarify_question, null);
  assert.equal((await request(`/api/voice/runs/${id}/clarify`, { body: { answer: "again" } })).status, 409);
});
test("the verifier rejects a cited claim its source does not contain", () => {
  const citations = [{ n: 1, title: "t", documentId: "d", excerpt: "The onboarding workshop begins on Monday at 9 AM." }];
  assert.equal(verifyClaims("The workshop begins on Monday at 9 AM [1].", citations).ok, true);
  assert.equal(verifyClaims("The workshop begins on Monday at 11 AM [1].", citations).ok, false);
  assert.equal(verifyClaims("Parking permits cost extra for visiting contractors [1].", citations).ok, false);
  assert.equal(verifyClaims("The workshop begins on Monday [2].", citations).ok, false);
  assert.equal(verifyClaims("The workshop begins on Monday at 9 AM.", citations).ok, false);
  assert.equal(verifyClaims("The workshop begins on Monday. [1]", citations).ok, true);
});
test("speech text drops citations and formatting; chunks keep whole sentences with overlap", () => {
  assert.equal(speakable("**Bring** your `handbook` [1]. See [2, 3].\n- Arrive early [4]"), "Bring your handbook. See.\nArrive early");
  const text = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} says something useful about the policy.`).join(" ");
  const chunks = chunkVoiceDocument(text);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.match(c, /\.$/);
  assert.ok(chunks[1]!.startsWith(chunks[0]!.split(/(?<=\.)\s+/).at(-1)!));
});
test("permanent failures do not retry", async () => {
  const { enqueue, registerJob, startJobs, drainJobs } = await import("../src/jobs/runner.ts");
  const { PermanentError } = await import("../src/lib/permanent-error.ts");
  let attempts = 0;
  registerJob("voice_test_permanent", async () => {
    attempts++;
    throw new PermanentError("missing key");
  });
  const id = await enqueue("voice_test_permanent", {});
  await startJobs([]);
  const until = Date.now() + 5000;
  let status = "";
  while (Date.now() < until && status !== "failed") {
    status = (await ctx.db.one("select status from jobs where id=$1", [id]))!.status;
    await new Promise((r) => setTimeout(r, 50));
  }
  await drainJobs();
  assert.equal(status, "failed");
  assert.equal(attempts, 1);
});
test("HR handbook: multi-part answers and checklists stay complete without a model", async () => {
  const handbook = await readFile(new URL("../../../docs/icp/hr/sample-handbook.txt", import.meta.url), "utf8");
  const { id: client } = await json("/api/voice/clients", { body: { name: "Northstar" } });
  const f = new FormData();
  f.set("file", new Blob([handbook]), "handbook.txt");
  const doc = await json(`/api/voice/clients/${client}/documents`, { form: f });
  await processVoiceDocument({ documentId: doc.id, orgId });
  const ask = async (task: string, question: string) => {
    const q = new FormData();
    q.set("clientId", client);
    q.set("profession", "hr");
    q.set("task", task);
    q.set("question", question);
    q.set("providerConsent", "yes");
    const { id } = await json("/api/voice/runs", { form: q });
    await processVoiceRun({ runId: id, orgId });
    return (await ctx.db.one("select answer,status from voice_runs where id=$1", [id]))!;
  };
  const leave = await ask("answer", "How many annual leave days do full-time employees get, and how do they request leave?");
  assert.match(leave.answer, /18 paid/);
  assert.match(leave.answer, /PeoplePortal at least 5 working days/);
  assert.match(leave.answer, /manager approves/);
  const list = (await ask("checklist", "Prepare a first-day onboarding checklist for a new employee, ordered by time, with who is responsible for each step.")).answer;
  const at = (s: string) => list.indexOf(s);
  for (const step of ["9:30 AM", "10:30 AM", "2:00 PM", "security training"]) assert.ok(at(step) >= 0, list);
  assert.ok(at("9:30 AM") < at("10:30 AM") && at("10:30 AM") < at("2:00 PM") && at("2:00 PM") < at("security training"), list);
  assert.equal(list.split("security training").length, 2, list);
  const relocation = await ask("answer", "What relocation reimbursement amount will a new hire receive?");
  assert.match(relocation.answer, /does not define relocation/);
  assert.ok(!/Do not invent|\d{3,}/.test(relocation.answer), relocation.answer);
});
test("recordings are refused up front when no transcription is connected", async () => {
  const url = process.env.VOICESTUDIO_URL;
  delete process.env.VOICESTUDIO_URL;
  try {
    const boot = await json("/api/voice/bootstrap");
    assert.equal(boot.speech.transcriptionAvailable, false);
    assert.equal(boot.reasoning.connected, false);
    const f = audioForm();
    f.set("clientId", clientId);
    f.set("profession", "general");
    f.set("task", "answer");
    f.set("providerConsent", "yes");
    assert.equal((await request("/api/voice/runs", { form: f })).status, 409);
  } finally {
    process.env.VOICESTUDIO_URL = url;
  }
});
