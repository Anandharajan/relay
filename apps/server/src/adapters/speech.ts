import { ctx } from "../ctx.ts";
import { decrypt } from "../lib/crypto.ts";
import { PermanentError } from "../lib/permanent-error.ts";
export interface SpeechConfig {
  sttUrl: string;
  sttModel: string;
  ttsProvider: "none" | "voicestudio" | "elevenlabs";
  ttsModel: string;
  engine: string;
  voicestudioUrl: string;
  widgetVoice: boolean;
}
export interface SpeechSecrets {
  sttKey?: string;
  ttsKey?: string;
  voicestudioKey?: string;
}
export const speechDefaults: SpeechConfig = {
  sttUrl: "",
  sttModel: "whisper-1",
  ttsProvider: "none",
  ttsModel: "eleven_multilingual_v2",
  engine: "",
  voicestudioUrl: "",
  widgetVoice: false,
};
export async function speechConfig(orgId: string) {
  const row = await ctx.db.one("select * from voice_settings where org_id=$1", [
    orgId,
  ]);
  return {
    settings: { ...speechDefaults, ...row?.settings } as SpeechConfig,
    secrets: row?.secrets_enc
      ? (JSON.parse(decrypt(row.secrets_enc)) as SpeechSecrets)
      : ({} as SpeechSecrets),
  };
}
const privateHosts = [
  "localhost",
  "127.0.0.1",
  "host.docker.internal",
  "voicestudio",
];
export const privateHostsAllowed = () =>
  process.env.SPEECH_ALLOW_PRIVATE_HOSTS === "true";
/**
 * Workspace admins supply these URLs, so a shared server must not let them reach internal
 * services: private hosts need the operator's opt-in, everything else an allow-listed HTTPS host.
 */
function allowedUrl(url: string, publicHosts: string[]) {
  const parsed = new URL(url);
  const isPrivate = privateHosts.includes(parsed.hostname);
  if (isPrivate && !privateHostsAllowed())
    throw new PermanentError(
      "Local addresses are only accepted when the operator sets SPEECH_ALLOW_PRIVATE_HOSTS=true on a self-hosted install.",
    );
  const hosts = [
    ...publicHosts,
    ...(process.env.SPEECH_STT_ALLOWED_HOSTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  if (parsed.username || parsed.password || (!isPrivate && !hosts.includes(parsed.hostname)))
    throw new PermanentError(
      "This speech host must be explicitly allowed by the operator in SPEECH_STT_ALLOWED_HOSTS.",
    );
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isPrivate))
    throw new PermanentError(
      "Speech endpoints require HTTPS, except local hosts on a self-hosted install.",
    );
  return url.replace(/\/+$/, "");
}
export function validateSpeechUrl(url: string) {
  return allowedUrl(url, ["api.openai.com", "api.groq.com"]);
}
export function validateVoiceStudioUrl(url: string) {
  return allowedUrl(url, []);
}
/** The workspace's own VoiceStudio if connected, otherwise the operator's. */
function voiceStudio(config: SpeechConfig, secrets: SpeechSecrets) {
  if (config.voicestudioUrl)
    return {
      base: validateVoiceStudioUrl(config.voicestudioUrl),
      key: secrets.voicestudioKey,
    };
  const url = process.env.VOICESTUDIO_URL;
  if (!url)
    throw new PermanentError(
      "Connect VoiceStudio in Voice settings before using it.",
    );
  return { base: url.replace(/\/+$/, ""), key: process.env.VOICESTUDIO_API_KEY };
}
/** Public visitors may only spend the operator's speech capacity if the operator says so. */
export function widgetVoiceAvailable(config: SpeechConfig) {
  return (
    config.widgetVoice &&
    !!(
      config.sttUrl ||
      config.voicestudioUrl ||
      (process.env.WIDGET_SPEECH_USE_OPERATOR === "true" &&
        process.env.VOICESTUDIO_URL)
    )
  );
}
export function transcriptionAvailable(config: SpeechConfig) {
  return !!(config.sttUrl || config.voicestudioUrl || process.env.VOICESTUDIO_URL);
}
function headers(key?: string): Record<string, string> {
  return key ? { authorization: `Bearer ${key}` } : {};
}
async function engineDetail(response: Response) {
  const body = (await response.json().catch(() => null)) as any;
  // VoiceStudio refuses until a person accepts the model's licence, in its own interface.
  if (/licen[cs]e/.test(String(body?.error?.code ?? body?.detail?.code)))
    return " Accept the model licence in VoiceStudio first.";
  const text = [
    body?.error?.message,
    body?.detail?.message,
    body?.detail,
    body?.error,
  ].find((t) => typeof t === "string");
  return text ? ` ${text.slice(0, 200)}` : "";
}
async function checked(url: string, options: RequestInit, timeoutMs = 120000) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.ok) return response;
  const message = `Speech engine returned ${response.status}.${await engineDetail(response)} Check its model, key, consent and license settings.`;
  // Only overload and timeouts can clear by themselves; other refusals will repeat.
  if (response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status))
    throw new PermanentError(message);
  throw new Error(message);
}
export async function transcribeAudio(
  data: Uint8Array,
  mime: string,
  config: SpeechConfig,
  secrets: SpeechSecrets,
) {
  if (!transcriptionAvailable(config))
    throw new PermanentError(
      "Configure transcription in Voice settings or connect VoiceStudio.",
    );
  const studio = config.sttUrl ? null : voiceStudio(config, secrets);
  const base = studio ? studio.base + "/v1" : validateSpeechUrl(config.sttUrl);
  const form = new FormData();
  form.set("model", config.sttModel);
  form.set("response_format", "json");
  form.set(
    "file",
    new Blob([Buffer.from(data)], { type: mime }),
    mime.includes("mp4")
      ? "recording.m4a"
      : mime.includes("wav")
        ? "recording.wav"
        : "recording.webm",
  );
  const response = await checked(base + "/audio/transcriptions", {
    method: "POST",
    headers: headers(studio ? studio.key : secrets.sttKey),
    body: form,
  });
  const result = (await response.json()) as {
    text?: string;
  };
  if (typeof result.text !== "string" || !result.text.trim())
    throw new PermanentError("No speech was recognized. Try a clearer recording.");
  return result.text.trim().slice(0, 6000);
}
function referenceFile(data: Uint8Array, mime: string) {
  return [
    new Blob([Buffer.from(data)], { type: mime }),
    mime.includes("wav")
      ? "reference.wav"
      : mime.includes("mp4")
        ? "reference.m4a"
        : "reference.webm",
  ] as const;
}
export async function enrollVoice(
  name: string,
  data: Uint8Array,
  mime: string,
  reference: string,
  config: SpeechConfig,
  secrets: SpeechSecrets,
) {
  const form = new FormData();
  let url: string, h: Record<string, string>;
  if (config.ttsProvider === "voicestudio") {
    const studio = voiceStudio(config, secrets);
    url = studio.base + "/profiles";
    h = headers(studio.key);
    form.set("name", name);
    form.set("ref_audio", ...referenceFile(data, mime));
    form.set("ref_text", reference);
    form.set("kind", "clone");
    if (config.engine) form.set("engine", config.engine);
  } else if (config.ttsProvider === "elevenlabs") {
    if (!secrets.ttsKey)
      throw new Error("Save your ElevenLabs API key in Voice settings.");
    url = "https://api.elevenlabs.io/v1/voices/add";
    h = { "xi-api-key": secrets.ttsKey };
    form.set("name", name);
    form.set("files", ...referenceFile(data, mime));
  } else throw new Error("Select a cloning engine in Voice settings first.");
  const result = (await (
    await checked(url, { method: "POST", headers: h, body: form })
  ).json()) as any;
  const id = result.voice_id || result.id;
  if (typeof id !== "string" || !id.length || id.length > 200)
    throw new Error("Voice engine did not return a valid profile ID.");
  if (config.ttsProvider === "voicestudio") {
    // The spoken phrase is also the consent record VoiceStudio keeps with the profile.
    const studio = voiceStudio(config, secrets);
    const consent = new FormData();
    consent.set("consent_audio", ...referenceFile(data, mime));
    consent.set("consent_text", reference);
    const base = `${studio.base}/profiles/${encodeURIComponent(id)}`;
    await Promise.all([
      checked(base + "/consent", { method: "POST", headers: h, body: consent }),
      checked(base + "/attestation", {
        method: "POST",
        headers: { ...h, "content-type": "application/json" },
        body: JSON.stringify({ basis: "own_voice" }),
      }),
    ]).catch((e) =>
      console.warn("[voice] VoiceStudio consent not recorded:", (e as Error).message),
    );
  }
  return id;
}
export async function synthesizeSpeech(
  text: string,
  voice: {
    provider: string;
    provider_id: string;
  },
  config: SpeechConfig,
  secrets: SpeechSecrets,
) {
  let url: string, h: Record<string, string>, body: unknown;
  if (voice.provider === "voicestudio") {
    const studio = voiceStudio(config, secrets);
    url = studio.base + "/v1/audio/speech";
    h = {
      "content-type": "application/json",
      ...headers(studio.key),
    };
    body = {
      input: text.slice(0, 4000),
      voice: voice.provider_id,
      model: config.engine || "omnivoice",
      response_format: "wav",
    };
  } else if (voice.provider === "elevenlabs") {
    if (!secrets.ttsKey)
      throw new PermanentError("The cloning API key is missing.");
    url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.provider_id)}`;
    h = { "content-type": "application/json", "xi-api-key": secrets.ttsKey };
    body = { text: text.slice(0, 4000), model_id: config.ttsModel };
  } else throw new PermanentError("Unsupported cloning engine.");
  // VoiceStudio loads its model on first use, which can outlast a normal request.
  const response = await checked(
    url,
    { method: "POST", headers: h, body: JSON.stringify(body) },
    voice.provider === "voicestudio" ? 300000 : 120000,
  );
  const mime = (response.headers.get("content-type") || "").split(";")[0]!;
  if (
    ![
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
      "audio/ogg",
      "audio/mp4",
    ].includes(mime)
  )
    throw new Error("The speech engine did not return a supported audio file.");
  const data = new Uint8Array(await response.arrayBuffer());
  if (!data.length || data.length > 20 * 1024 * 1024)
    throw new Error("Generated audio is empty or exceeds 20 MB.");
  return { data, mime };
}
export async function removeProviderVoice(
  voice: {
    provider: string;
    provider_id: string;
  },
  config: SpeechConfig,
  secrets: SpeechSecrets,
) {
  if (voice.provider === "voicestudio") {
    const studio = voiceStudio(config, secrets);
    await checked(studio.base + "/profiles/" + encodeURIComponent(voice.provider_id), {
      method: "DELETE",
      headers: headers(studio.key),
    });
    return;
  }
  await checked(
    "https://api.elevenlabs.io/v1/voices/" + encodeURIComponent(voice.provider_id),
    { method: "DELETE", headers: { "xi-api-key": secrets.ttsKey || "" } },
  );
}
/** Read-only check of the connected VoiceStudio, for the settings panel. Never loads a model. */
export async function voiceStudioStatus(config: SpeechConfig, secrets: SpeechSecrets) {
  const studio = voiceStudio(config, secrets);
  const get = (path: string) =>
    fetch(studio.base + path, {
      headers: headers(studio.key),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  const health = await get("/health");
  const state = (await health.json().catch(() => null)) as any;
  if (health.status === 503)
    return {
      state: "starting" as const,
      message: state?.label || "VoiceStudio is starting.",
      version: state?.version ?? null,
    };
  if (!health.ok)
    return {
      state: "error" as const,
      message: `VoiceStudio health check returned ${health.status}.`,
      version: null,
    };
  const [speech, engines] = await Promise.all([
    get("/.well-known/voicestudio-speech"),
    get("/engines/tts"),
  ]);
  if (speech.status === 401 || speech.status === 403 || engines.status === 401 || engines.status === 403)
    return {
      state: "unauthorized" as const,
      message: "VoiceStudio rejected the API key. Use its OMNIVOICE_API_KEY.",
      version: state?.version ?? null,
    };
  const capabilities = speech.ok ? ((await speech.json()) as any) : null;
  const tts = engines.ok ? ((await engines.json()) as any) : null;
  return {
    state: "connected" as const,
    message: "Connected.",
    version: state?.version ?? capabilities?.service_version ?? null,
    device: state?.device ?? null,
    protocol: capabilities?.protocol ?? null,
    streaming: !!capabilities?.features?.streaming_transcription,
    activeEngine: tts?.active ?? null,
    engines: ((tts?.backends ?? []) as any[])
      .filter((b) => b.supports_cloning !== false)
      .map((b) => ({
        id: String(b.id),
        name: String(b.display_name ?? b.name ?? b.id),
        available: b.available !== false,
      })),
  };
}
