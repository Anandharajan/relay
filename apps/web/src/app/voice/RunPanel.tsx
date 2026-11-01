import { useEffect, useRef } from "react";
import { RunBoard, type Agent, type Run as BoardRun } from "../../components/RunBoard";
import { settled, stages, type Run } from "./model";
export function RunPanel({
  runs,
  run: r,
  picked,
  pick,
  focus,
}: {
  runs: Run[];
  run: Run | null;
  picked: string | null;
  pick: (id: string | null) => void;
  focus: { run: string; n: number; at: number } | null;
}) {
  const sources = useRef<HTMLDivElement>(null);
  const target = focus && focus.run === r?.id ? focus.n : null;
  useEffect(() => {
    if (target !== null)
      sources.current
        ?.querySelector(`[data-source="${target}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [target, focus?.at]);
  if (!r)
    return (
      <p className="vd-empty">
        Agents appear here as soon as you ask a question. You’ll see each step
        and the sources it used.
      </p>
    );
  const agents = r.steps.filter((s) => s.id) as Agent[];
  const isSettled = settled.includes(r.status);
  const board: BoardRun = {
    id: r.id,
    kind: "message",
    title: r.question,
    status: isSettled ? (r.status === "failed" ? "failed" : "done") : "running",
    stages,
    agents,
    report: [],
    ms: agents.reduce((sum, a) => sum + (a.ms ?? 0), 0),
  };
  return (
    <>
      <label className="vd-run-pick">
        Showing
        <select
          value={picked && picked === r.id ? picked : ""}
          onChange={(e) => pick(e.target.value || null)}
        >
          <option value="">Newest active run</option>
          {runs.map((x) => (
            <option key={x.id} value={x.id}>
              {x.status.replaceAll("_", " ")} ·{" "}
              {(x.question || "Voice question").slice(0, 60)}
            </option>
          ))}
        </select>
      </label>
      <p className="vd-run-title">
        <span className={"vd-status " + r.status}>
          {r.status.replaceAll("_", " ")}
        </span>{" "}
        {r.question || "Processing your voice question…"}
      </p>
      {agents.length > 0 ? (
        <RunBoard run={board} boardOnly />
      ) : r.steps.length > 0 ? (
        <ol>
          {r.steps.map((s, i) => (
            <li key={i}>{s.label}</li>
          ))}
        </ol>
      ) : (
        <p className="vd-muted" role="status">
          {isSettled ? "No agent steps were recorded for this run." : "Agents are starting…"}
        </p>
      )}
      <div className="vd-sources" ref={sources}>
        <h3>Sources for this run · {r.citations.length}</h3>
        {r.citations.map((c) => (
          <blockquote
            key={c.n}
            data-source={c.n}
            className={c.n === target ? "focused" : ""}
          >
            <strong>
              [{c.n}] {c.title}
            </strong>
            <p>{c.excerpt}</p>
          </blockquote>
        ))}
        {!r.citations.length && (
          <p className="vd-muted">
            {isSettled
              ? "This run did not use any source passages."
              : "Source passages appear here once the research step finds them."}
          </p>
        )}
      </div>
    </>
  );
}
