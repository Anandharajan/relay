import { useEffect, useRef, useState, type FormEvent } from 'react';
import { usePatientChat, type AgentActivity, type ChatMessage } from '../lib/patientChat';
import { AgentTrace } from './AgentTrace';
import { currentStep, SAMPLE_PATIENT_REPORT, visitPath, type TourStep } from './steps';

/** Messages and agent decisions in the order they happened. */
function timeline(messages: ChatMessage[], activity: AgentActivity[]): (ChatMessage | AgentActivity)[] {
  const at = (x: ChatMessage | AgentActivity) => new Date('content' in x ? x.created_at : x.at).getTime();
  return [...messages, ...activity].sort((a, b) => at(a) - at(b));
}

/** A phone-style patient chat that walks through `steps`, one suggested reply at a time. */
export function PatientChat({ siteKey, steps, title, onProgress }: { siteKey: string | null; steps: TourStep[]; title: string; onProgress?: (step: number) => void }) {
  const chat = usePatientChat(siteKey);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const step = currentStep(steps, chat.messages);
  const next = steps[step];
  const visit = visitPath(chat.messages);

  useEffect(() => onProgress?.(step), [step, onProgress]);
  useEffect(() => end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), [chat.messages.length, chat.typing]);

  const doStep = (s: TourStep) => {
    if (s.attach) void chat.attach(new File([SAMPLE_PATIENT_REPORT], 'antenatal-blood-tests.txt', { type: 'text/plain' }));
    else if (s.send) void chat.send(s.send);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText('');
    void chat.send(v);
  };

  return (
    <div className="phone" aria-label="Patient chat">
      <header className="phone-head">
        <span className="phone-avatar">🏥</span>
        <div>
          <strong>{title}</strong>
          <span className="small">{chat.typing ? 'typing…' : 'online'}</span>
        </div>
      </header>
      <div className="phone-body" aria-live="polite">
        {!chat.ready && !chat.error && <p className="small muted" style={{ textAlign: 'center' }}>Connecting…</p>}
        {chat.greeting && <div className="bubble in">{chat.greeting}</div>}
        {timeline(chat.messages, chat.activity).map((x) =>
          'content' in x
            ? <div key={x.id} className={`bubble ${x.role === 'customer' ? 'out' : 'in'}`}>{x.content}</div>
            : <AgentTrace key={`${x.at}-${x.agent}`} a={x} />,
        )}
        {chat.typing && <div className="bubble in typing" title="Agents working"><span /><span /><span /></div>}
        <div ref={end} />
      </div>
      {chat.error && <div className="error-box small">{chat.error}</div>}
      <div className="phone-suggest">
        {next ? (
          <button className="chip next" disabled={!chat.ready || chat.busy} onClick={() => doStep(next)} title={next.why}>
            {next.label}
          </button>
        ) : (
          <span className="small muted">That’s the patient journey. Try your own question.</span>
        )}
        {visit && <a className="chip" href={visit} target="_blank" rel="noreferrer">Open visit page ↗</a>}
      </div>
      <form className="phone-input" onSubmit={submit}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" aria-label="Message" disabled={!chat.ready} />
        <button className="btn primary" disabled={!chat.ready || chat.busy || !text.trim()} aria-label="Send">➤</button>
      </form>
    </div>
  );
}
