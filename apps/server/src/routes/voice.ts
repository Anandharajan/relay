import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { ctx } from "../ctx.ts";
import {
  body,
  fail,
  requireOrg,
  requireRole,
  requireUser,
  type AppEnv,
} from "../http.ts";
import { encrypt, decrypt, uuid } from "../lib/crypto.ts";
import {
  speechConfig,
  enrollVoice,
  privateHostsAllowed,
  removeProviderVoice,
  transcribeAudio,
  transcriptionAvailable,
  validateSpeechUrl,
  validateVoiceStudioUrl,
  voiceStudioStatus,
  widgetVoiceAvailable,
} from "../adapters/speech.ts";
import { professions, tasks, voiceChanged } from "../services/voice-desk.ts";
import {
  challengeTtlMinutes,
  consentVersion,
  createPhrase,
  phraseMatches,
} from "../services/voice-consent.ts";
import { audit } from "../services/orgs.ts";
import { rateLimit } from "../lib/ratelimit.ts";
export const voiceApi = new Hono<AppEnv>();
voiceApi.use("*", requireUser, requireOrg);
voiceApi.use(
  "*",
  bodyLimit({
    maxSize: 22 * 1024 * 1024,
    onError: (c) => c.json({ error: "Request exceeds 22 MB." }, 413),
  }),
);
voiceApi.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
const clientSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z
    .enum(["client", "student", "patient", "employee", "customer"])
    .default("client"),
});
async function client(orgId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) fail(404, "Client not found");
  const row = await ctx.db.one(
    "select * from voice_clients where id=$1 and org_id=$2",
    [id, orgId],
  );
  if (!row) fail(404, "Client not found");
  return row;
}
const audioMimes = [
  "audio/webm",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/ogg",
];
function audio(file: unknown) {
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > 12 * 1024 * 1024 ||
    !audioMimes.includes(file.type.split(";")[0]!)
  )
    fail(
      400,
      "Use a non-empty WebM, WAV, M4A, MP3 or Ogg recording up to 12 MB.",
    );
  return file;
}
const runSelect =
  "id,client_id,voice_id,profession,task,question,answer,citations,steps,status,error,output_mime,approved_at,clarify_question,skipped_documents,created_at,updated_at";
voiceApi.get("/bootstrap", async (c) => {
  const orgId = c.get("org").id,
    userId = c.get("user").id;
  const { settings, secrets } = await speechConfig(orgId);
  const [clients, voices, runs] = await Promise.all([
    ctx.db.query(
      "select id,name,kind,created_at from voice_clients where org_id=$1 order by created_at desc",
      [orgId],
    ),
    ctx.db.query(
      "select id,name,provider,consent_at,revoked_at,created_at from voice_profiles where org_id=$1 and user_id=$2 order by created_at desc",
      [orgId, userId],
    ),
    ctx.db.query(
      `select ${runSelect} from voice_runs where org_id=$1 and user_id=$2 order by created_at desc limit 50`,
      [orgId, userId],
    ),
  ]);
  return c.json({
    clients,
    voices,
    runs,
    professions,
    tasks,
    speech: {
      ...settings,
      sttKeySaved: !!secrets.sttKey,
      ttsKeySaved: !!secrets.ttsKey,
      voicestudioKeySaved: !!secrets.voicestudioKey,
      localAvailable: !!process.env.VOICESTUDIO_URL,
      privateHostsAllowed: privateHostsAllowed(),
      transcriptionAvailable: transcriptionAvailable(settings),
      widgetVoiceActive: widgetVoiceAvailable(settings),
    },
    limits: { documentMB: 20, audioMB: 12 },
  });
});
voiceApi.put("/settings", requireRole("admin"), async (c) => {
  const b = await body(
    c,
    z.object({
      sttUrl: z.string().max(300),
      sttModel: z.string().min(1).max(100),
      ttsProvider: z.enum(["none", "voicestudio", "elevenlabs"]),
      ttsModel: z.string().min(1).max(100),
      engine: z.string().max(100),
      sttKey: z.string().max(1000).optional(),
      ttsKey: z.string().max(1000).optional(),
      voicestudioUrl: z.string().max(300).default(""),
      voicestudioKey: z.string().max(1000).optional(),
      widgetVoice: z.boolean().default(false),
      clearKeys: z.boolean().optional(),
    }),
  );
  try {
    if (b.sttUrl) validateSpeechUrl(b.sttUrl);
    if (b.voicestudioUrl) validateVoiceStudioUrl(b.voicestudioUrl);
  } catch (e) {
    fail(400, (e as Error).message);
  }
  const old = await speechConfig(c.get("org").id);
  const secrets = b.clearKeys ? {} : { ...old.secrets };
  if (b.sttKey) secrets.sttKey = b.sttKey;
  if (b.ttsKey) secrets.ttsKey = b.ttsKey;
  if (b.voicestudioKey) secrets.voicestudioKey = b.voicestudioKey;
  const { sttKey, ttsKey, voicestudioKey, clearKeys, ...settings } = b;
  await ctx.db.query(
    "insert into voice_settings(org_id,settings,secrets_enc) values($1,$2::jsonb,$3) on conflict(org_id) do update set settings=excluded.settings,secrets_enc=excluded.secrets_enc,updated_at=now()",
    [c.get("org").id, settings, encrypt(JSON.stringify(secrets))],
  );
  await audit(c.get("org").id, c.get("user").id, "voice.settings.updated");
  return c.json({ ok: true });
});
voiceApi.get("/voicestudio/status", requireRole("admin"), async (c) => {
  if (!rateLimit(`voicestudio-status:${c.get("org").id}`, 20, 60000).ok)
    fail(429, "Please wait before testing again.");
  const { settings, secrets } = await speechConfig(c.get("org").id);
  try {
    return c.json(await voiceStudioStatus(settings, secrets));
  } catch (e) {
    const timedOut = (e as Error).name === "TimeoutError";
    return c.json({
      state: "unreachable",
      message: timedOut
        ? "VoiceStudio did not answer in time."
        : (e as { permanent?: boolean }).permanent
          ? (e as Error).message
          : "VoiceStudio could not be reached at this address.",
      version: null,
    });
  }
});
voiceApi.post("/clients", requireRole("agent"), async (c) => {
  const b = await body(c, clientSchema),
    id = uuid();
  await ctx.db.query(
    "insert into voice_clients(id,org_id,name,kind) values($1,$2,$3,$4)",
    [id, c.get("org").id, b.name, b.kind],
  );
  voiceChanged(c.get("org").id);
  return c.json({ id }, 201);
});
voiceApi.delete("/clients/:id", requireRole("admin"), async (c) => {
  await client(c.get("org").id, c.req.param("id"));
  await ctx.db.query("delete from voice_clients where id=$1 and org_id=$2", [
    c.req.param("id"),
    c.get("org").id,
  ]);
  await audit(
    c.get("org").id,
    c.get("user").id,
    "voice.client.deleted",
    c.req.param("id"),
  );
  voiceChanged(c.get("org").id);
  return c.json({ ok: true });
});
voiceApi.get("/clients/:id/documents", async (c) => {
  await client(c.get("org").id, c.req.param("id"));
  return c.json(
    await ctx.db.query(
      "select id,name,status,error,created_at,(select count(*)::int from voice_chunks where document_id=d.id) as chunks from voice_documents d where client_id=$1 and org_id=$2 order by created_at desc",
      [c.req.param("id"), c.get("org").id],
    ),
  );
});
voiceApi.post("/clients/:id/documents", requireRole("agent"), async (c) => {
  const orgId = c.get("org").id;
  await client(orgId, c.req.param("id"));
  const form = await c.req.parseBody(),
    file = form.file;
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > 20 * 1024 * 1024 ||
    !/\.(pdf|docx|txt|md|markdown|csv|json)$/i.test(file.name)
  )
    fail(
      400,
      "Upload PDF, DOCX, TXT, Markdown, CSV or JSON up to 20 MB. Scans require OCR.",
    );
  const count = await ctx.db.one(
    "select count(*)::int as total from voice_documents where client_id=$1 and org_id=$2",
    [c.req.param("id"), orgId],
  );
  if (count!.total >= 50)
    fail(400, "Limit of 50 documents per client reached.");
  const id = uuid();
  await ctx.db.tx(async (db) => {
    await db.query(
      "insert into voice_documents(id,org_id,client_id,name,raw_enc) values($1,$2,$3,$4,$5)",
      [
        id,
        orgId,
        c.req.param("id"),
        file.name.slice(0, 180),
        encrypt(Buffer.from(await file.arrayBuffer()).toString("base64")),
      ],
    );
    await db.query(
      "insert into jobs(id,type,payload) values($1,'voice_document',$2::jsonb)",
      [uuid(), { documentId: id, orgId }],
    );
  });
  voiceChanged(orgId);
  return c.json({ id }, 201);
});
voiceApi.delete("/documents/:id", requireRole("agent"), async (c) => {
  const rows = await ctx.db.query(
    "delete from voice_documents where id=$1 and org_id=$2 returning id",
    [c.req.param("id"), c.get("org").id],
  );
  if (!rows.length) fail(404, "Document not found");
  voiceChanged(c.get("org").id);
  return c.json({ ok: true });
});
voiceApi.post("/profiles/challenge", requireRole("agent"), async (c) => {
  const orgId = c.get("org").id,
    userId = c.get("user").id;
  if (!rateLimit(`clone-phrase:${orgId}:${userId}`, 10, 10 * 60000).ok)
    fail(429, "Wait before requesting another phrase.");
  const { settings } = await speechConfig(orgId);
  if (settings.ttsProvider === "none")
    fail(409, "Connect a cloning engine in Voice settings first.");
  // The match is the safeguard, so enrollment fails closed without a way to hear the recording.
  if (!transcriptionAvailable(settings))
    fail(409, "Voice enrollment needs transcription. Connect it in Voice settings first.");
  const id = uuid(),
    phrase = createPhrase();
  const expiresAt = new Date(Date.now() + challengeTtlMinutes * 60000);
  await ctx.db.query(
    "insert into voice_challenges(id,org_id,user_id,phrase,expires_at) values($1,$2,$3,$4,$5)",
    [id, orgId, userId, phrase, expiresAt],
  );
  return c.json({ id, phrase, expiresAt }, 201);
});
voiceApi.post("/profiles", requireRole("agent"), async (c) => {
  const orgId = c.get("org").id,
    userId = c.get("user").id;
  const f = await c.req.parseBody();
  if (f.consent !== consentVersion || f.providerConsent !== "yes")
    fail(
      400,
      "Explicitly confirm that this is your own voice and allow the selected speech provider to process it.",
    );
  if (!rateLimit(`clone:${orgId}:${userId}`, 6, 10 * 60000).ok)
    fail(429, "Wait before enrolling another voice.");
  const file = audio(f.file),
    name = String(f.name || "My voice")
      .trim()
      .slice(0, 100),
    challengeId = String(f.challengeId || "");
  if (!z.string().uuid().safeParse(challengeId).success)
    fail(400, "Request a phrase and record yourself reading it.");
  // One attempt per phrase: consume it first so a recording can never be retried against it.
  const [challenge] = await ctx.db.query(
    "update voice_challenges set used_at=now() where id=$1 and org_id=$2 and user_id=$3 and used_at is null and expires_at>now() returning phrase",
    [challengeId, orgId, userId],
  );
  if (!challenge)
    fail(400, "This phrase has expired or was already used. Get a new one.");
  const reference: string = challenge.phrase;
  const { settings, secrets } = await speechConfig(orgId);
  const data = new Uint8Array(await file.arrayBuffer());
  let providerId: string;
  try {
    const heard = await transcribeAudio(data, file.type, settings, secrets);
    if (!phraseMatches(heard, reference)) {
      await audit(orgId, userId, "voice.consent.phrase_mismatch", challengeId);
      fail(
        400,
        "The recording did not match the phrase. Get a new phrase and read it clearly.",
      );
    }
    providerId = await enrollVoice(
      name,
      data,
      file.type,
      reference,
      settings,
      secrets,
    );
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    fail(400, (e as Error).message);
  }
  const id = uuid();
  await ctx.db.query(
    "insert into voice_profiles(id,org_id,user_id,name,provider,provider_id,sample_enc,sample_mime,reference_text,consent_at,consent_version) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10)",
    [
      id,
      orgId,
      userId,
      name,
      settings.ttsProvider,
      providerId,
      encrypt(Buffer.from(data).toString("base64")),
      file.type,
      reference,
      consentVersion,
    ],
  );
  await audit(orgId, userId, "voice.consent.granted", id, {
    version: consentVersion,
    provider: settings.ttsProvider,
    challengeId,
  });
  voiceChanged(orgId);
  return c.json({ id }, 201);
});
voiceApi.delete("/profiles/:id", requireRole("agent"), async (c) => {
  const orgId = c.get("org").id,
    userId = c.get("user").id;
  const profile = await ctx.db.one(
    "select * from voice_profiles where id=$1 and org_id=$2 and user_id=$3",
    [c.req.param("id"), orgId, userId],
  );
  if (!profile) fail(404, "Voice not found");
  await ctx.db.tx(async (db) => {
    await db.query(
      "update voice_profiles set revoked_at=now(),sample_enc=null,reference_text='' where id=$1",
      [profile.id],
    );
    await db.query(
      "update voice_runs set output_enc=null,output_mime=null,status=case when status in ('ready','synthesizing') then 'ready_text' else status end where voice_id=$1 and org_id=$2",
      [profile.id, orgId],
    );
  });
  let warning: string | null = null;
  try {
    const { settings, secrets } = await speechConfig(orgId);
    await removeProviderVoice(
      { provider: profile.provider, provider_id: profile.provider_id },
      settings,
      secrets,
    );
  } catch {
    warning =
      "Local consent is revoked and audio access removed. Provider deletion could not be confirmed; remove the remote profile in the provider console.";
  }
  await audit(orgId, userId, "voice.consent.revoked", profile.id);
  voiceChanged(orgId);
  return c.json({ ok: true, warning });
});
voiceApi.post("/runs", requireRole("agent"), async (c) => {
  const orgId = c.get("org").id,
    userId = c.get("user").id;
  if (!rateLimit(`voice-run:${orgId}:${userId}`, 15, 60000).ok)
    fail(429, "Please wait before starting another run.");
  const f = await c.req.parseBody();
  if (f.providerConsent !== "yes")
    fail(400, "Confirm processing by your configured AI and speech providers.");
  const clientId = String(f.clientId || "");
  await client(orgId, clientId);
  const profession = String(f.profession || "general"),
    task = String(f.task || "answer"),
    question = String(f.question || "").trim();
  if (
    !Object.hasOwn(professions, profession) ||
    !Object.hasOwn(tasks, task) ||
    question.length > 6000
  )
    fail(
      400,
      "Choose a supported profession and task; questions are limited to 6,000 characters.",
    );
  const profileId = String(f.voiceId || "");
  if (
    profileId &&
    !(await ctx.db.one(
      "select id from voice_profiles where id=$1 and org_id=$2 and user_id=$3 and revoked_at is null",
      [profileId, orgId, userId],
    ))
  )
    fail(404, "Active voice not found");
  let input: string | null = null,
    mime: string | null = null;
  if (f.file instanceof File && f.file.size) {
    const file = audio(f.file);
    input = encrypt(Buffer.from(await file.arrayBuffer()).toString("base64"));
    mime = file.type;
  }
  if (!input && question.length < 3)
    fail(400, "Record a question or enter at least three characters.");
  const id = uuid();
  await ctx.db.tx(async (db) => {
    await db.query(
      "insert into voice_runs(id,org_id,user_id,client_id,voice_id,profession,task,question,input_enc,input_mime) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        orgId,
        userId,
        clientId,
        profileId || null,
        profession,
        task,
        question,
        input,
        mime,
      ],
    );
    await db.query(
      "insert into jobs(id,type,payload) values($1,'voice_process',$2::jsonb)",
      [uuid(), { runId: id, orgId }],
    );
  });
  voiceChanged(orgId);
  return c.json({ id }, 202);
});
voiceApi.post("/runs/:id/clarify", requireRole("agent"), async (c) => {
  const orgId = c.get("org").id,
    userId = c.get("user").id;
  const { answer } = await body(
    c,
    z.object({ answer: z.string().trim().min(1).max(2000) }),
  );
  await ctx.db.tx(async (db) => {
    const rows = await db.query(
      "update voice_runs set question=left(question||E'\\nClarification: '||$4,6000),clarify_question=null,status='queued',updated_at=now() where id=$1 and org_id=$2 and user_id=$3 and status='needs_input' returning id",
      [c.req.param("id"), orgId, userId, answer],
    );
    if (!rows.length) fail(409, "This reply is not waiting for an answer.");
    await db.query(
      "insert into jobs(id,type,payload) values($1,'voice_process',$2::jsonb)",
      [uuid(), { runId: rows[0]!.id, orgId }],
    );
  });
  voiceChanged(orgId);
  return c.json({ ok: true }, 202);
});
voiceApi.post("/runs/:id/approve", requireRole("agent"), async (c) => {
  const orgId = c.get("org").id,
    userId = c.get("user").id;
  const { answer } = await body(
    c,
    z.object({ answer: z.string().trim().min(1).max(4000) }),
  );
  const id = await ctx.db.tx(async (db) => {
    const rows = await db.query(
      "update voice_runs set answer=$4,approved_at=now(),status='queued_audio',error=null where id=$1 and org_id=$2 and user_id=$3 and status in ('review','audio_failed','ready_text') returning id",
      [c.req.param("id"), orgId, userId, answer],
    );
    if (!rows.length)
      fail(409, "This draft cannot be approved in its current state.");
    await db.query(
      "insert into jobs(id,type,payload) values($1,'voice_render',$2::jsonb)",
      [uuid(), { runId: rows[0]!.id, orgId }],
    );
    return rows[0]!.id;
  });
  await audit(orgId, userId, "voice.draft.approved", id);
  voiceChanged(orgId);
  return c.json({ ok: true }, 202);
});
voiceApi.get("/runs/:id/audio", async (c) => {
  const row = await ctx.db.one(
    "select r.output_enc,r.output_mime from voice_runs r join voice_profiles p on p.id=r.voice_id and p.revoked_at is null where r.id=$1 and r.org_id=$2 and r.user_id=$3 and r.status=$4",
    [c.req.param("id"), c.get("org").id, c.get("user").id, "ready"],
  );
  if (!row?.output_enc)
    fail(404, "Audio is unavailable or consent was revoked.");
  c.header("Content-Type", row.output_mime);
  const ext = row.output_mime.includes("wav")
    ? "wav"
    : row.output_mime.includes("ogg")
      ? "ogg"
      : row.output_mime.includes("mp4")
        ? "m4a"
        : "mp3";
  c.header(
    "Content-Disposition",
    `${c.req.query("download") === "1" ? "attachment" : "inline"}; filename="relay-voice-reply.${ext}"`,
  );
  return c.body(new Uint8Array(Buffer.from(decrypt(row.output_enc), "base64")));
});
voiceApi.delete("/runs/:id", requireRole("agent"), async (c) => {
  await ctx.db.query(
    "delete from voice_runs where id=$1 and org_id=$2 and user_id=$3",
    [c.req.param("id"), c.get("org").id, c.get("user").id],
  );
  voiceChanged(c.get("org").id);
  return c.json({ ok: true });
});
