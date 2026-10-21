import { useState } from 'react';
import type { AgentActivity } from '../lib/patientChat';

const names: Record<string, string> = {
  frontdesk: '💬 Front desk', safety: '🛡️ Safety', booking: '📅 Booking', actions: '🔌 Lookup', intake: '📄 Intake', findings: '🩺 Findings', followup: '🔁 Follow-up',
};

/** A compact, expandable line showing which agent acted on the last message and what it decided. */
export function AgentTrace({ a }: { a: AgentActivity }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className={`agent-trace ${a.status}`} onClick={() => setOpen(!open)} aria-expanded={open}>
      <span>{names[a.agent] ?? a.agent} · {a.status === 'handoff' ? 'handed to staff' : a.status === 'failed' ? 'failed' : 'done'} · {a.latencyMs} ms</span>
      {a.outcome && <span className="muted">{a.outcome}</span>}
      {open && a.steps.length > 0 && (
        <ol>{a.steps.map((s, i) => <li key={i}>{s.name}{s.detail ? `: ${s.detail}` : ''}</li>)}</ol>
      )}
    </button>
  );
}
