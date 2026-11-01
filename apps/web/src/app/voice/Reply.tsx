import { useEffect, useState } from "react";
import { isNotFound, spoken, statusLabels, type Run } from "./model";
export function Reply({
  run: r,
  shown,
  disabled,
  open,
  approve,
  clarify,
  remove,
}: {
  run: Run;
  shown: boolean;
  disabled: boolean;
  open: (n?: number) => void;
  approve: (s: string) => Promise<void>;
  clarify: (s: string) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(r.answer);
  const [clarification, setClarification] = useState("");
  useEffect(() => setDraft(r.answer), [r.answer]);
  const notFound = isNotFound(r.answer);
  const review = !notFound && ["review", "audio_failed", "ready_text"].includes(r.status);
  const approved = r.status === "ready_text";
  // Tall enough for the draft and no taller, so the thread stays readable.
  const draftRows = Math.min(
    12,
    Math.max(3, draft.split("\n").reduce((n, line) => n + Math.ceil((line.length + 1) / 70), 0)),
  );
  return (
    <article className="vd-turn">
      <p className="vd-bubble-me">
        {r.question || "Processing your voice question…"}
      </p>
      <div className={"vd-reply " + (shown ? "shown" : "")}>
        <div className="vd-reply-head">
          <span className={"vd-status " + r.status}>
            {notFound
              ? "No answer found"
              : (statusLabels[r.status] ?? r.status.replaceAll("_", " "))}
          </span>
          <span className="vd-reply-actions">
            <button className="vd-text-button" onClick={() => open()}>
              View agents
            </button>
            <button
              className="vd-text-button"
              disabled={disabled}
              onClick={() => void remove()}
            >
              Delete reply
            </button>
          </span>
        </div>
        {r.error && (
          <p role="alert" className="vd-alert">
            {r.error}
          </p>
        )}
        {r.status === "needs_input" && r.clarify_question && (
          <form
            className="vd-clarify"
            onSubmit={(e) => {
              e.preventDefault();
              void clarify(clarification);
            }}
          >
            <label>
              The planner needs one detail: {r.clarify_question}
              <input
                required
                maxLength={2000}
                value={clarification}
                onChange={(e) => setClarification(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={disabled}>
              Continue
            </button>
          </form>
        )}
        {r.skipped_documents?.length > 0 && (
          <p className="vd-alert">
            Not searched:{" "}
            {r.skipped_documents
              .map((d) => `${d.name} (${d.reason})`)
              .join(", ")}
            . This reply may be incomplete, so it needs your review.
          </p>
        )}
        {r.answer &&
          (review ? (
            <label>
              {approved
                ? "Approved. You can still edit it"
                : r.voice_id
                  ? "Review and edit before speaking"
                  : "Review and edit before approving"}
              <textarea
                rows={draftRows}
                maxLength={4000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
          ) : (
            <p className="vd-answer">{r.answer}</p>
          ))}
        {!notFound && r.citations.length > 0 && (
          <ul className="vd-cites" aria-label="Sources">
            {r.citations.map((c) => (
              <li key={c.n}>
                <button type="button" onClick={() => open(c.n)}>
                  [{c.n}] {c.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        {review && r.answer && (
          <button
            className="btn primary"
            disabled={disabled || !draft.trim() || (approved && draft === r.answer)}
            onClick={() => void approve(draft)}
          >
            {r.status === "audio_failed"
              ? "Approve and retry audio"
              : approved
                ? "Save edited reply"
                : r.voice_id
                  ? "Approve & generate audio"
                  : "Approve reply"}
          </button>
        )}
        {r.status === "ready" && (
          <div className="vd-playback">
            <audio
              controls
              preload="none"
              src={`/api/voice/runs/${r.id}/audio`}
            />
            <a
              className="btn"
              href={`/api/voice/runs/${r.id}/audio?download=1`}
              download
            >
              ↓ Download audio
            </a>
          </div>
        )}
        {r.answer && !notFound && r.status !== "ready" && "speechSynthesis" in window && (
          <button
            className="vd-text-button"
            onClick={() => {
              speechSynthesis.cancel();
              speechSynthesis.speak(
                new SpeechSynthesisUtterance(spoken(draft || r.answer)),
              );
            }}
          >
            Listen with standard device voice (not cloned)
          </button>
        )}
      </div>
    </article>
  );
}
