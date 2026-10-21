import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useEvents } from '../lib/api';
import { AgentTrace } from '../tour/AgentTrace';
import type { AgentActivity as Activity } from '../lib/patientChat';

/** Live feed of what the agents are doing across the workspace, as patients message and reports arrive. */
export function AgentActivity() {
  const [items, setItems] = useState<(Activity & { conversationId: string | null; clientId: string | null })[]>([]);
  useEvents({ 'agent.activity': (a) => setItems((list) => [a, ...list].slice(0, 20)) });
  return (
    <div className="card pad stack activity">
      <div className="row between"><h3>Agents at work</h3><span className="small muted">live</span></div>
      {!items.length && <p className="small muted">Waiting for the next patient message or report…</p>}
      {items.map((a) => (
        <div key={`${a.at}-${a.agent}`} className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
          <AgentTrace a={a} />
          {a.conversationId ? <Link className="small" to={`/app/inbox/${a.conversationId}`}>Open</Link> : a.clientId ? <Link className="small" to={`/app/clients/${a.clientId}`}>Open</Link> : null}
        </div>
      ))}
    </div>
  );
}
