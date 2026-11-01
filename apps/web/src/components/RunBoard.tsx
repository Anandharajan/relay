import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export type Status = 'waiting' | 'working' | 'done' | 'failed' | 'skipped';
export interface Agent { id: string; role: string; action: string; stage: number; status: Status; ms?: number; result?: string }
export interface Section { id: string; title: string; kind: 'reply' | 'text' | 'list' | 'table' | 'callout' | 'chips'; tone?: string; body?: string; items?: string[]; rows?: string[][]; head?: string[] }
export interface Run { id: string; kind: 'message' | 'report' | 'day' | 'copilot'; title: string; status: 'running' | 'done' | 'failed'; stages: string[]; agents: Agent[]; report: Section[]; ms?: number }


/** Visual replay of a finished run, stage by stage (used when the run finished before the stream connected). */
export function replay(final: Run): Run[] {
  const frames: Run[] = [];
  const stages = final.stages.length;
  for (let i = 0; i < stages; i++) {
    const at = (state: 'working' | 'done') => ({
      ...final,
      status: 'running' as const,
      agents: final.agents.map((a) => (a.stage < i || (a.stage === i && state === 'done') ? a : a.stage === i ? { ...a, status: a.status === 'skipped' ? a.status : ('working' as Status), ms: undefined } : { ...a, status: 'waiting' as Status, ms: undefined })),
      report: final.report.slice(0, Math.round((final.report.length * (i + (state === 'done' ? 1 : 0))) / stages)),
    });
    frames.push(at('working'), at('done'));
  }
  frames.push(final);
  return frames;
}

const icon: Record<Status, string> = { waiting: '○', working: '◌', done: '✓', failed: '✕', skipped: '–' };


/**
 * Follows one run: applies streamed snapshots a beat apart (so a 30 ms pipeline is still readable)
 * and replays runs that finished before the stream connected.
 */
export function useRunFollower(base: string) {
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<Run[]>([]);
  const timer = useRef<number | null>(null);
  const source = useRef<EventSource | null>(null);

  const pump = () => {
    if (timer.current) return;
    timer.current = window.setInterval(() => {
      const next = queue.current.shift();
      if (next) setRun(next);
      if (!queue.current.length && timer.current) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    }, 180);
  };
  useEffect(() => () => {
    source.current?.close();
    if (timer.current) window.clearInterval(timer.current);
  }, []);

  const follow = (first: Run) => {
    source.current?.close();
    queue.current = [];
    setRun(first);
    setBusy(true);
    const es = new EventSource(`${base}/${first.id}/stream`);
    source.current = es;
    let sawRunning = false;
    es.addEventListener('run', (ev) => {
      const r = JSON.parse((ev as MessageEvent).data) as Run;
      if (r.status === 'running' && r.agents.some((a) => a.status !== 'waiting')) sawRunning = true;
      if (r.status !== 'running' && !sawRunning) queue.current.push(...replay(r));
      else queue.current.push(r);
      pump();
      if (r.status !== 'running') {
        es.close();
        setBusy(false);
      }
    });
    es.onerror = () => {
      es.close();
      api<Run>(`${base}/${first.id}`).then((r) => {
        queue.current.push(...(r.status === 'running' ? [r] : replay(r)));
        pump();
      }).catch(() => {}).finally(() => setBusy(false));
    };
  };
  return { run, busy, setBusy, follow };
}

/** The agent board (stages, agents side by side when parallel) and the report filling in. */
export function RunBoard({ run, reportTitle, boardOnly }: { run: Run; reportTitle?: string; boardOnly?: boolean }) {
  const stages = run.stages.map((name, i) => ({ name, agents: run.agents.filter((a) => a.stage === i) }));
  const working = run.agents.filter((a) => a.status === 'working').length;
  const done = run.agents.filter((a) => a.status === 'done').length;
  return (
        <div className="console-out">
          <section className="board" aria-live="polite">
            <header className="row between">
              <strong>Agent team</strong>
              <span className="small muted">
                {run.status === 'running' ? (working ? `${working} working${working > 1 ? ' in parallel' : ''}` : 'Starting…') : `${done} agents · ${run.ms ?? 0} ms`}
              </span>
            </header>
            <ol className="stages">
              {stages.map((s, i) => (
                <li key={s.name} className="stage">
                  <div className="stage-name"><span>{i + 1}</span> {s.name}{s.agents.length > 1 && <em> · {s.agents.length} in parallel</em>}</div>
                  <div className="stage-agents">
                    {s.agents.map((a) => (
                      <article key={a.id} className={`agent ${a.status}`}>
                        <div className="row between">
                          <span className="agent-state">{icon[a.status]} {a.status === 'working' ? 'Working' : a.status === 'waiting' ? 'Waiting' : a.status === 'skipped' ? 'Skipped' : a.status === 'failed' ? 'Failed' : 'Done'}</span>
                          {a.ms !== undefined && a.status !== 'skipped' && <span className="small muted">{a.ms < 1 ? '<1' : a.ms} ms</span>}
                        </div>
                        <strong>{a.role}</strong>
                        <span className="small">{a.status === 'done' || a.status === 'failed' || a.status === 'skipped' ? a.result : a.action}</span>
                      </article>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {!boardOnly && <section className="report" aria-live="polite">
            <header className="row between">
              <strong>{reportTitle ?? (run.kind === 'report' ? 'Doctor report' : run.kind === 'day' ? 'Today’s brief' : 'Result')}</strong>
              {run.status === 'done' && (
                <button className="btn sm" onClick={() => navigator.clipboard?.writeText(run.report.map((s) => `${s.title}\n${s.body ?? (s.items ?? []).join('\n') ?? ''}${s.rows ? s.rows.map((r) => r.join(' | ')).join('\n') : ''}`).join('\n\n'))}>Copy</button>
              )}
            </header>
            {!run.report.length && <p className="small muted">The report fills in as agents finish…</p>}
            {run.report.map((s) => <ReportBlock key={s.id} s={s} />)}
          </section>}
        </div>
  );
}

function ReportBlock({ s }: { s: Section }) {
  return (
    <div className={`rblock ${s.kind} ${s.tone ?? ''}`}>
      <h4>{s.title}</h4>
      {s.kind === 'chips' && <div className="row wrap" style={{ gap: 6 }}>{s.items?.map((i) => <span key={i} className="badge">{i}</span>)}</div>}
      {(s.kind === 'reply' || s.kind === 'text' || s.kind === 'callout') && <p style={{ whiteSpace: 'pre-wrap' }}>{s.body}</p>}
      {s.kind === 'list' && <ul>{s.items?.map((i) => <li key={i}>{i}</li>)}</ul>}
      {s.kind === 'table' && (
        <div className="table-wrap">
          <table className="table compact">
            {s.head && <thead><tr>{s.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>}
            <tbody>{s.rows?.map((r, i) => <tr key={i} className={/critical/.test(r[r.length - 1] ?? '') ? 'crit' : /high|low/.test(r[r.length - 1] ?? '') ? 'warnrow' : ''}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
