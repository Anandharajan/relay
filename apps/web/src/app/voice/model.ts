import type { Agent } from "../../components/RunBoard";
export const stages = ["Listen", "Plan", "Research", "Write", "Verify", "Speak"];
export const settled = ["ready", "ready_text", "review", "failed", "audio_failed", "needs_input"];
/** Text for a voice to read, matching what the server sends to the cloning engine. */
export const spoken = (text: string) =>
  text
    .replace(/\s*\[\d+(?:\s*[,-]\s*\d+)*\]/g, "")
    .replace(/^\s*(?:[-*+•]|#{1,6})\s+/gm, "")
    .replace(/(\*\*|__|\*|`|~~)/g, "");
export type Client = {
  id: string;
  name: string;
  kind: string;
};
export type Run = {
  id: string;
  client_id: string;
  voice_id: string | null;
  question: string;
  answer: string;
  status: string;
  error: string | null;
  citations: {
    n: number;
    title: string;
    excerpt: string;
  }[];
  steps: (Partial<Agent> & { label?: string })[];
  clarify_question: string | null;
  skipped_documents: { name: string; reason: string }[];
};
export type Bootstrap = {
  clients: Client[];
  voices: Profile[];
  runs: Run[];
  professions: Record<string, string>;
  tasks: Record<string, string>;
  reasoning: { connected: boolean; provider: string | null; local?: boolean };
  speech: Speech;
};
export type Check = { ok: boolean; detail: string };
export type Readiness = { db: Check; model: Check; transcription: Check; cloning: Check };
export type Doc = {
  id: string;
  name: string;
  status: string;
  error: string | null;
  chunks: number;
};
export type Tab = "run" | "documents" | "voices" | "settings";
export const isDocActive = (d: Doc) => ["queued", "processing"].includes(d.status);
export const statusLabels: Record<string, string> = {
  review: "Needs review",
  ready_text: "Approved",
  ready: "Audio ready",
  audio_failed: "Audio failed",
  needs_input: "Needs a detail",
  queued_audio: "Approved, generating audio",
};
/** The reply the server gives when the files do not answer the question. */
export const isNotFound = (answer: string) => answer.startsWith("I could not find supporting information");
export type Profile = {
  id: string;
  name: string;
  provider: string;
  revoked_at: string | null;
};
export type Speech = {
  sttUrl: string;
  sttModel: string;
  ttsProvider: string;
  ttsModel: string;
  engine: string;
  voicestudioUrl: string;
  widgetVoice: boolean;
  sttKeySaved: boolean;
  ttsKeySaved: boolean;
  voicestudioKeySaved: boolean;
  localAvailable: boolean;
  privateHostsAllowed: boolean;
  transcriptionAvailable: boolean;
  widgetVoiceActive: boolean;
};
export type StudioStatus = {
  state: "connected" | "starting" | "unauthorized" | "unreachable" | "error";
  message: string;
  version: string | null;
  device?: string | null;
  streaming?: boolean;
  activeEngine?: string | null;
  engines?: { id: string; name: string; available: boolean }[];
};
