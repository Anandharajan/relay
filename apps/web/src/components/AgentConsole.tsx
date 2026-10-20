import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';

type Status = 'waiting' | 'working' | 'done' | 'failed' | 'skipped';
interface Agent { id: string; role: string; action: string; stage: number; status: Status; ms?: number; result?: string }
interface Section { id: string; title: string; kind: 'reply' | 'text' | 'list' | 'table' | 'callout' | 'chips'; tone?: string; body?: string; items?: string[]; rows?: string[][]; head?: string[] }
interface Run { id: string; kind: 'message' | 'report' | 'day'; title: string; status: 'running' | 'done' | 'failed'; stages: string[]; agents: Agent[]; report: Section[]; ms?: number }

export const SAMPLE_REPORT = `SYNTHETIC LAB REPORT (fictional patient)
Date: 18/10/2026
Haemoglobin 9.4 g/dL 12.0 - 15.5
HbA1c 8.6 % 4.0 - 5.6
Fasting Blood Sugar 172 mg/dL 70 - 100
Serum Creatinine 1.6 mg/dL 0.6 - 1.2
Potassium 6.7 mmol/L 3.5 - 5.1
LDL Cholesterol 158 mg/dL < 100
Tab. Metformin 500 mg 1-0-1
Tab. Telmisartan 40 mg 1-0-0`;

const publicExamples = [
  { label: 'Book in Tamil', text: 'அப்பாயின்ட்மென்ட் வேண்டும், சர்க்கரை நோய் மருத்துவர்' },
  { label: 'Emergency', text: 'My father has chest pain and is sweating' },
  { label: 'Lab report status', text: 'Is my report LAB-2041 ready?' },
  { label: 'Read a lab report', text: SAMPLE_REPORT },
  { label: 'Insurance question', text: 'Do you accept health insurance?' },
];

/** Visual replay of a finished run, stage by stage (used when the run finished before the stream connected). */
function replay(final: Run): Run[] {
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
 * One input → a team of agents works in stages (side by side when they run in parallel) → a report fills in.
 * Durations shown are the real server timings; the board reveals updates a beat apart so people can follow them.
 */
export function AgentConsole({ mode, extraExamples = [], placeholder }: { mode: 'public' | 'workspace'; extraExamples?: { label: string; text: string }[]; placeholder?: string }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const queue = useRef<Run[]>([]);
  const timer = useRef<number | null>(null);
  const source = useRef<EventSource | null>(null);
  const base = mode === 'public' ? '/api/public/runs' : '/api/runs';
  const examples = [...publicExamples, ...extraExamples];

  // Apply streamed snapshots one beat apart, so a 30 ms pipeline is still readable.
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

  const start = async (input?: string, e?: FormEvent) => {
    e?.preventDefault();
    const value = (input ?? text).trim();
    if (!value && !file) return;
    if (input !== undefined) setText(input);
    setError(null);
    setBusy(true);
    source.current?.close();
    queue.current = [];
    try {
      let first: Run;
      if (file && input === undefined) {
        const form = new FormData();
        form.append('file', file);
        if (value) form.append('text', value);
        first = await api<Run>(base, { form });
      } else {
        first = await api<Run>(base, { body: { text: value } });
      }
      setRun(first);
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
        // Fall back to one fetch of the final state.
        api<Run>(`${base}/${first.id}`).then((r) => {
          queue.current.push(...(r.status === 'running' ? [r] : replay(r)));
          pump();
        }).catch(() => {}).finally(() => setBusy(false));
      };
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const stages = run ? run.stages.map((name, i) => ({ name, agents: run.agents.filter((a) => a.stage === i) })) : [];
  const working = run?.agents.filter((a) => a.status === 'working').length ?? 0;
  const done = run?.agents.filter((a) => a.status === 'done').length ?? 0;

  return (
    <div className="console">
      <form className="console-input card" onSubmit={(e) => start(undefined, e)}>
        <textarea
          className="textarea"
          rows={run ? 2 : 3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !text.includes('\n')) {
              e.preventDefault();
              void start();
            }
          }}
          placeholder={placeholder ?? 'Type a patient message in any language, or paste a lab report…'}
          aria-label="Your input"
        />
        <div className="row between wrap" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            {examples.map((x) => (
              <button type="button" key={x.label} className="chip" onClick={() => start(x.text)} disabled={busy}>{x.label}</button>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()} title="PDF, Word or text file">
              📎 {file ? file.name.slice(0, 18) : 'Attach'}
            </button>
            <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button className="btn primary" disabled={busy || (!text.trim() && !file)}>{busy ? 'Agents working…' : 'Run agents →'}</button>
          </div>
        </div>
        <p className="small muted">Preview only: no booking, staff alert or patient message is created. {mode === 'public' ? 'Use fictional data only; do not upload real patient reports.' : 'Save reports through Patients for clinical review.'}</p>
        {error && <div className="error-box">{error}</div>}
      </form>

      {run && (
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

          <section className="report" aria-live="polite">
            <header className="row between">
              <strong>{run.kind === 'report' ? 'Doctor report' : run.kind === 'day' ? 'Today’s brief' : 'Result'}</strong>
              {run.status === 'done' && (
                <button className="btn sm" onClick={() => navigator.clipboard?.writeText(run.report.map((s) => `${s.title}\n${s.body ?? (s.items ?? []).join('\n') ?? ''}${s.rows ? s.rows.map((r) => r.join(' | ')).join('\n') : ''}`).join('\n\n'))}>Copy</button>
              )}
            </header>
            {!run.report.length && <p className="small muted">The report fills in as agents finish…</p>}
            {run.report.map((s) => <ReportBlock key={s.id} s={s} />)}
          </section>
        </div>
      )}
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
