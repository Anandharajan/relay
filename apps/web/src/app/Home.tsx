import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useSession } from '../lib/session';
import { terms } from '../lib/terms';
import { AgentConsole } from '../components/AgentConsole';
import { useReviewCount } from '../components/ReviewQueue';

/** Home = the agent console, plus four numbers and what is left to set up. */
export function Home() {
  const { me } = useSession();
  const T = terms(me);
  const stats = useApi<any>('/api/analytics?days=30');
  const approvals = useApi<any>(T.healthcare ? '/api/visits/approvals' : null);
  const sources = useApi<any[]>('/api/knowledge');
  const staff = useApi<any[]>('/api/visits/staff');
  const reviews = useReviewCount();
  if (!me) return null;
  const s = stats.data?.totals;
  const viewer = me.role === 'viewer';
  const todo = viewer
    ? []
    : [
        { done: (sources.data ?? []).some((x) => x.status === 'ready'), label: 'Add your FAQ', to: '/app/knowledge' },
        { done: (staff.data ?? []).length > 0, label: `Add ${T.staffs.toLowerCase()}`, to: '/app/settings/staff' },
        { done: me.org.whatsappConnected, label: 'Connect WhatsApp', to: '/app/settings/channels' },
      ].filter((x) => !x.done);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>What do you need?</h1>
          <p>Type a patient message, paste a report, or ask for today’s brief. The agents do the rest.</p>
        </div>
      </div>

      <AgentConsole
        mode="workspace"
        extraExamples={viewer ? [] : [{ label: 'Brief me on today', text: 'Brief me on today' }]}
        placeholder={T.healthcare ? 'e.g. “appointment venum tomorrow”, a pasted lab report, or “Brief me on today”' : 'Type a customer message, or “Brief me on today”'}
      />

      <div className="grid4 mini-stats">
        <Link to="/app/inbox" className="card stat"><div className="label">Waiting for you</div><div className="value">{s?.escalated_open ?? '—'}</div></Link>
        {T.healthcare && <Link to="/app/approvals" className="card stat"><div className="label">To approve</div><div className="value">{approvals.data?.messages?.length ?? '—'}</div></Link>}
        {T.healthcare && <Link to="/app/approvals" className="card stat"><div className="label">Reports to review</div><div className="value">{reviews ? (reviews.mine ? `${reviews.mine} yours` : reviews.all) : '—'}</div></Link>}
        <Link to="/app/visits" className="card stat"><div className="label">{T.visits}</div><div className="value">→</div></Link>
        <Link to="/app/analytics" className="card stat"><div className="label">Solved by AI (30 d)</div><div className="value">{s ? `${Math.round((stats.data.resolutionRate ?? 0) * 100)}%` : '—'}</div></Link>
      </div>

      {todo.length > 0 && (
        <div className="row wrap small" style={{ gap: 8 }}>
          <span className="muted">To finish setup:</span>
          {todo.map((t) => <Link key={t.label} to={t.to} className="chip">{t.label} →</Link>)}
        </div>
      )}
    </div>
  );
}
