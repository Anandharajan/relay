import { useState } from "react";
import type { Bootstrap, Readiness } from "./model";
/** The first sentence of a readiness detail: the guide and the VoiceStudio tab give the rest. */
const brief = (detail: string) => {
  if (/no model yet/.test(detail)) return "VoiceStudio needs its models";
  const first = detail.split(/(?<=[.:])\s/)[0]!.replace(/[.:]$/, "");
  return first.length > 70 ? `${first.slice(0, 67)}…` : first;
};
/** What works in this workspace right now, using live readiness once the server has answered. */
export function CapabilityStrip({
  data,
  ready,
  liveVoices,
}: {
  data: Bootstrap;
  ready: Readiness | null;
  liveVoices: number;
}) {
  const [whyOpen, setWhyOpen] = useState(false);
  const modelOk = ready?.model.ok === true;
  const hearingOk = ready?.transcription.ok === true;
  const cloningOk = ready?.cloning.ok === true;
  const capabilities: { on: boolean; label: string; why: string }[] = [
    ...(ready && !ready.db.ok
      ? [{ on: false, label: "Database: off", why: `. ${ready.db.detail}` }]
      : []),
    modelOk
      ? {
          on: true,
          label: `Written answers: ${data.reasoning.provider ?? "on"}${data.reasoning.local ? " (local)" : ""}`,
          why: "",
        }
      : {
          on: false,
          label: "Written answers: off",
          why: ready
            ? `. ${ready.model.detail}`
            : ". Replies quote source sentences until an AI model is connected",
        },
    hearingOk
      ? { on: true, label: "Spoken questions: on", why: "" }
      : {
          on: false,
          label: "Spoken questions: off",
          why: ready
            ? `. ${brief(ready.transcription.detail)}`
            : ". Type your question, or connect transcription",
        },
    liveVoices && cloningOk
      ? { on: true, label: "Cloned replies: on", why: "" }
      : {
          on: false,
          label: "Cloned replies: off",
          why: !cloningOk
            ? `. ${brief(ready?.cloning.detail ?? "Checking the speech engine")}`
            : data.speech.ttsProvider === "none"
              ? ". Connect a cloning engine"
              : ". Enroll your voice",
        },
  ];
  return (
    <ul
      className={"vd-capabilities " + (whyOpen ? "open" : "")}
      aria-label="What is active in this workspace"
    >
      {capabilities.map((c) => (
        <li key={c.label} className={c.on ? "on" : "off"}>
          {c.label}
          {c.why && <span className="vd-cap-why">{c.why}</span>}
        </li>
      ))}
      {capabilities.some((c) => !c.on) && (
        <li className="vd-cap-toggle">
          <button
            type="button"
            className="vd-text-button"
            aria-expanded={whyOpen}
            onClick={() => setWhyOpen(!whyOpen)}
          >
            {whyOpen ? "Less" : "Why off?"}
          </button>
        </li>
      )}
    </ul>
  );
}
