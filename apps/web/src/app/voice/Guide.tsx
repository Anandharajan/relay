import { useState } from "react";

export type GuideStep = {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  /** Cannot be done yet, for a reason the detail explains. The guide moves on to the next step. */
  blocked?: boolean;
  action?: { label: string; run: () => void };
};

const remember = (open: boolean) => {
  try {
    localStorage.setItem("vd-guide-open", open ? "1" : "0");
  } catch {
    /* The guide still works without storage. */
  }
};
const remembered = () => {
  try {
    return localStorage.getItem("vd-guide-open") === "1";
  } catch {
    return false;
  }
};

/** The next thing to do, with every step one tap away. */
export function Guide({ steps }: { steps: GuideStep[] }) {
  const [open, setOpen] = useState(remembered);
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.blocked) ?? steps.find((s) => !s.done);
  const toggle = () => {
    remember(!open);
    setOpen(!open);
  };
  return (
    <section className={"vd-guide " + (open ? "open" : "")} aria-label="Getting started">
      <div className="vd-guide-next">
        <span className="vd-guide-count" aria-hidden="true">
          {done}/{steps.length}
        </span>
        <div className="vd-guide-text">
          {next ? (
            <>
              <strong>
                Step {steps.indexOf(next) + 1} of {steps.length}: {next.title}
              </strong>
              <span>{next.detail}</span>
            </>
          ) : (
            <>
              <strong>All set</strong>
              <span>Ask a question, approve the reply and play it in your voice.</span>
            </>
          )}
        </div>
        {next?.action && !next.blocked && (
          <button type="button" className="btn primary sm" onClick={next.action.run}>
            {next.action.label}
          </button>
        )}
        <button type="button" className="vd-text-button" aria-expanded={open} onClick={toggle}>
          {open ? "Hide steps" : "All steps"}
        </button>
      </div>
      {open && (
        <ol className="vd-guide-steps">
          {steps.map((s, i) => (
            <li key={s.id} className={s.done ? "done" : s.blocked ? "blocked" : s === next ? "next" : ""}>
              <span className="vd-guide-mark" aria-hidden="true">
                {s.done ? "✓" : i + 1}
              </span>
              <div>
                <strong>
                  {s.title}
                  <span className="sr-only">{s.done ? " (done)" : s.blocked ? " (waiting)" : ""}</span>
                </strong>
                {!s.done && <small>{s.detail}</small>}
              </div>
              {!s.done && s.action && !s.blocked && (
                <button type="button" className="vd-text-button" onClick={s.action.run}>
                  {s.action.label}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
