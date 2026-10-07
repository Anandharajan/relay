import { Link } from 'react-router-dom';
import { pct, useApi } from '../lib/api';
import { useSession } from '../lib/session';
import { Loading } from '../components/ui';

/** Onboarding checklist + headline numbers. */
export function Home() {
  const { me } = useSession();
  const sources = useApi<any[]>('/api/knowledge');
  const sims = useApi<any[]>('/api/simulations');
  const stats = useApi<any>('/api/analytics?days=30');
  const team = useApi<any>('/api/workspace/team');
  if (!me || sources.loading || sims.loading || stats.loading || !stats.data) return <Loading />;

  const readySources = (sources.data ?? []).filter((s) => s.status === 'ready' && s.type !== 'learned').length;
  const steps = [
    { done: readySources > 0, title: 'Add knowledge', text: 'Crawl your help center, upload PDFs/DOCX or paste FAQs.', to: '/app/knowledge', cta: 'Add a source' },
    { done: (sims.data ?? []).some((s) => s.status === 'done'), title: 'Run a simulation', text: 'Test 20–50 real questions and check the pass rate before going live.', to: '/app/simulations', cta: 'Run simulation' },
    { done: (stats.data?.totals?.conversations ?? 0) > 0, title: 'Install the widget', text: 'Paste one script tag on your site, or connect WhatsApp.', to: '/app/settings/install', cta: 'Get the snippet' },
    { done: (team.data?.members?.length ?? 0) > 1, title: 'Invite your team', text: 'AI and humans share one inbox. Approve drafts, take over, @AI in notes.', to: '/app/settings/team', cta: 'Invite' },
  ];
  const s = stats.data!;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Namaste, {me.user.name.split(' ')[0]} 👋</h1>
          <p>Here's how {me.org.settings.botName} is doing for {me.org.name} over the last 30 days.</p>
        </div>
        <Link className="btn primary" to="/app/inbox">Open inbox</Link>
      </div>

      <div className="grid4">
        <div className="card stat"><div className="label">Conversations</div><div className="value">{s.totals.conversations}</div><div className="sub">last 30 days</div></div>
        <div className="card stat"><div className="label">AI resolution rate</div><div className="value">{pct(s.resolutionRate)}</div><div className="sub">{s.totals.ai_resolved} resolved by AI</div></div>
        <div className="card stat"><div className="label">CSAT</div><div className="value">{pct(s.csat)}</div><div className="sub">{s.totals.csat_count} ratings</div></div>
        <div className="card stat"><div className="label">Needs a human</div><div className="value">{s.totals.escalated_open}</div><div className="sub">escalated, open</div></div>
      </div>

      <div className="card pad stack">
        <h2>Get set up</h2>
        {steps.map((st, i) => (
          <div className="row" key={st.title} style={{ alignItems: 'flex-start' }}>
            <span className={`badge ${st.done ? 'ok' : ''}`} style={{ marginTop: 2 }}>{st.done ? '✓' : i + 1}</span>
            <div className="grow">
              <strong>{st.title}</strong>
              <p className="muted small">{st.text}</p>
            </div>
            <Link className="btn sm" to={st.to}>{st.cta}</Link>
          </div>
        ))}
      </div>

      <div className="grid2">
        <div className="card pad stack">
          <h3>Answer mode</h3>
          <p className="muted small">
            {me.org.settings.mode === 'auto'
              ? `AI replies directly when confident (≥ ${Math.round(me.org.settings.confidenceThreshold * 100)}%) and escalates otherwise.`
              : 'Draft mode: every AI reply waits for a teammate to approve it.'}
          </p>
          <Link to="/app/settings" className="small">Change in settings →</Link>
        </div>
        <div className="card pad stack">
          <h3>Top unanswered questions</h3>
          {s.unanswered.length ? (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {s.unanswered.slice(0, 4).map((u: any) => <li key={u.question}>{u.question} <span className="muted">×{u.n}</span></li>)}
            </ul>
          ) : (
            <p className="muted small">Nothing yet — questions the AI couldn't answer show up here so you can add knowledge.</p>
          )}
        </div>
      </div>
    </div>
  );
}
