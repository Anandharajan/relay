import { publish } from "../../lib/events.ts";
export const professions = {
  general: "Professional assistant",
  education: "Teacher / tutor",
  healthcare: "Clinician / patient administration",
  hr: "HR / employee support",
  advisory: "Advisor / consultant",
  services: "Field / service team",
} as const;
export const tasks = {
  answer: "Answer a question",
  summary: "Summarize relevant passages",
  checklist: "Prepare a checklist",
  reply: "Draft a client reply",
} as const;
export function voiceChanged(orgId: string) {
  publish(`org:${orgId}`, "voice.updated", {});
}
export interface Source {
  id: string;
  title: string;
  document_id: string;
  content: string;
  score: number;
}
export interface Citation {
  n: number;
  title: string;
  documentId: string;
  excerpt: string;
}
export const notFoundReply =
  "I could not find supporting information in this client’s files. Add a relevant document or ask the responsible professional.";
