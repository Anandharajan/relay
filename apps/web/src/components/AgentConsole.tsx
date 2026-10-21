import { useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { RunBoard, useRunFollower, type Run } from './RunBoard';

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

/**
 * One input → a team of agents works in stages (side by side when they run in parallel) → a report fills in.
 * Durations shown are the real server timings; the board reveals updates a beat apart so people can follow them.
 */
export function AgentConsole({ mode, extraExamples = [], placeholder }: { mode: 'public' | 'workspace'; extraExamples?: { label: string; text: string }[]; placeholder?: string }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = mode === 'public' ? '/api/public/runs' : '/api/runs';
  const { run, busy, setBusy, follow } = useRunFollower(base);
  const examples = [...publicExamples, ...extraExamples];

  const start = async (input?: string, e?: FormEvent) => {
    e?.preventDefault();
    const value = (input ?? text).trim();
    if (!value && !file) return;
    if (input !== undefined) setText(input);
    setError(null);
    setBusy(true);
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
      follow(first);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

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

      {run && <RunBoard run={run} />}
    </div>
  );
}
