import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, inr, timeAgo, useApi } from '../lib/api';
import { useSession } from '../lib/session';
import { Empty, Loading, Modal, useToast } from '../components/ui';

const pages = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'usage', label: 'Usage & cost', icon: '💸' },
  { id: 'agents', label: 'Agents & quality', icon: '🤖' },
  { id: 'failures', label: 'Failures', icon: '🧯' },
  { id: 'providers', label: 'AI providers', icon: '🔌' },
  { id: 'workspaces', label: 'Workspaces', icon: '🏥' },
  { id: 'leads', label: 'Leads & early access', icon: '🌱' },
  { id: 'audit', label: 'Audit log', icon: '📜' },
] as const;

const agentInfo: Record<string, string> = {
  frontdesk: 'Answers questions from knowledge with citations',
  booking: 'Books, checks in, reports waiting time',
  safety: 'Stops emergencies and medical-advice questions',
  actions: 'Calls institution APIs (lab status, orders …)',
  intake: 'Reads uploaded reports into structured results',
  findings: 'Flags abnormal, critical, worsening and overdue results',
  followup: 'Post-visit check-ins and review reminders',
  telecaller: 'Reminder and follow-up phone calls',
  channel: 'Delivery to WhatsApp / chat',
  jobs: 'Background jobs (ingest, simulations …)',
  pipeline: 'Agent console runs (message, report and day-brief pipelines)',
};

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const num = (n: number) => Math.round(n).toLocaleString('en-IN');

/** Platform admin console. Server-side gated by PLATFORM_ADMIN_EMAILS; the client check only hides the UI. */
export function Admin() {
  const { me, loading } = useSession();
  const { page = 'overview' } = useParams();
  const nav = useNavigate();
  const [days, setDays] = useState(30);
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  if (!me.isPlatformAdmin) return <Navigate to="/app" replace />;
  const i = Math.max(0, pages.findIndex((p) => p.id === page));
  const prev = pages[(i - 1 + pages.length) % pages.length]!;
  const next = pages[(i + 1) % pages.length]!;
  return (
    <div className="admin">
      <header className="admin-bar">
        <div className="row" style={{ gap: 10 }}>
          <img src="/icon.svg" alt="" width={24} />
          <strong>Relay · Platform admin</strong>
          <span className="badge bad">admins only</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <select className="select" style={{ width: 130, height: 32 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
          <Link className="btn sm" to="/app">← Back to workspace</Link>
        </div>
      </header>
      <nav className="admin-tabs">
        <button className="btn sm ghost" aria-label="Previous page" onClick={() => nav(`/admin/${prev.id}`)}>‹</button>
        {pages.map((p) => (
          <Link key={p.id} to={`/admin/${p.id}`} className={p.id === pages[i]!.id ? 'active' : ''}>{p.icon} {p.label}</Link>
        ))}
        <button className="btn sm ghost" aria-label="Next page" onClick={() => nav(`/admin/${next.id}`)}>›</button>
      </nav>
      <main className="admin-main">
        {pages[i]!.id === 'overview' && <Overview days={days} />}
        {pages[i]!.id === 'usage' && <Usage days={days} />}
        {pages[i]!.id === 'agents' && <Agents days={days} />}
        {pages[i]!.id === 'failures' && <Failures days={days} />}
        {pages[i]!.id === 'providers' && <Providers />}
        {pages[i]!.id === 'workspaces' && <Workspaces />}
        {pages[i]!.id === 'leads' && <Leads />}
        {pages[i]!.id === 'audit' && <Audit />}
        <div className="row between" style={{ marginTop: 8 }}>
          <Link className="btn" to={`/admin/${prev.id}`}>‹ {prev.label}</Link>
          <Link className="btn" to={`/admin/${next.id}`}>{next.label} ›</Link>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/** Stacked daily bars: ok / handoff / failed. */
function RunBars({ rows }: { rows: any[] }) {
  if (!rows.length) return <p className="small muted">No agent activity in this period.</p>;
  const max = Math.max(...rows.map((r) => r.runs), 1);
  return (
    <div>
      <div className="bars" role="img" aria-label="Agent runs per day">
        {rows.map((r) => (
          <div className="bar" key={r.day} title={`${new Date(r.day).toLocaleDateString('en-IN')}: ${r.ok} ok, ${r.handoff} handoff, ${r.failed} failed`}>
            <div style={{ height: `${(r.failed / max) * 100}%`, background: 'var(--bad)' }} />
            <div style={{ height: `${(r.handoff / max) * 100}%`, background: 'var(--warn)' }} />
            <div style={{ height: `${(r.ok / max) * 100}%`, background: 'var(--ok)' }} />
          </div>
        ))}
      </div>
      <div className="row small muted" style={{ gap: 14, marginTop: 6 }}>
        <span><span className="dot" style={{ background: 'var(--ok)' }} /> resolved by agent</span>
        <span><span className="dot" style={{ background: 'var(--warn)' }} /> handed to a human</span>
        <span><span className="dot" style={{ background: 'var(--bad)' }} /> failed</span>
      </div>
    </div>
  );
}

function Overview({ days }: { days: number }) {
  const d = useApi<any>(`/api/admin/overview?days=${days}`, [days]);
  if (!d.data) return <Loading />;
  const o = d.data;
  return (
    <div className="stack lg">
      <div className="grid4">
        <Stat label="Workspaces" value={o.orgs.total} sub={`${o.orgs.active} active · ${o.orgs.healthcare} healthcare`} />
        <Stat label="Agent runs" value={num(o.runs.total)} sub={`${pct(o.runs.ok, o.runs.total)} succeeded · ${pct(o.runs.handoff, o.runs.total)} handed off`} />
        <Stat label="Failures" value={o.runs.failed} sub={pct(o.runs.failed, o.runs.total) + ' of runs'} tone={o.runs.failed ? 'bad' : undefined} />
        <Stat label="Est. cost per response" value={inr(o.costPerResponseInr, 2)} sub={`${inr(o.runs.cost, 2)} total · ${num(o.runs.tokens)} tokens`} />
        <Stat label="Conversations" value={num(o.conversations.c)} sub={`${pct(o.conversations.resolved_ai, o.conversations.c)} resolved by AI`} />
        <Stat label="User satisfaction (CSAT)" value={o.ratings.csatAvg ? `${o.ratings.csatAvg.toFixed(1)} / 5` : '—'} sub={`${o.ratings.csatCount} chat ratings`} />
        <Stat label="Staff / doctor rating" value={o.ratings.staffAvg ? `${o.ratings.staffAvg.toFixed(1)} ★` : '—'} sub={`assistant ${o.ratings.aiAvg ? o.ratings.aiAvg.toFixed(1) + ' ★' : '—'} · ${o.ratings.visits} visits`} />
        <Stat label="Leads" value={o.leads.total} sub={`${o.leads.fresh} new · ${o.leads.early} early access`} />
      </div>
      <div className="card pad stack">
        <div className="row between"><h3>Agent outcomes per day</h3><span className="small muted">avg latency {Math.round(o.runs.latency)} ms</span></div>
        <RunBars rows={o.runsByDay} />
      </div>
    </div>
  );
}

function Usage({ days }: { days: number }) {
  const d = useApi<any>(`/api/admin/usage?days=${days}`, [days]);
  if (!d.data) return <Loading />;
  const u = d.data;
  const totalCost = u.byModel.reduce((s: number, r: any) => s + r.cost, 0);
  const calls = u.byModel.reduce((s: number, r: any) => s + r.calls, 0);
  const forecast = u.workspaces.reduce((s: number, r: any) => s + r.projectedCost, 0);
  return (
    <div className="stack lg">
      <div className="grid4">
        <Stat label="Model + rules calls" value={num(calls)} sub={`last ${days} days`} />
        <Stat label="Inference cost" value={inr(totalCost, 2)} sub="platform keys; BYOK billed to the customer" />
        <Stat label="Forecast this month" value={inr(forecast, 0)} sub={`${Math.round(u.monthProgress * 100)}% of month elapsed`} />
        <Stat label="Tokens" value={num(u.byModel.reduce((s: number, r: any) => s + r.input_tokens + r.output_tokens, 0))} sub="input + output (estimated split)" />
      </div>
      <div className="card">
        <h3 style={{ padding: '14px 14px 0' }}>By provider and model</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Provider</th><th>Model</th><th>Calls</th><th>Input tok</th><th>Output tok</th><th>Cost</th><th>Cost / call</th><th>Failed</th><th>Avg latency</th></tr></thead>
            <tbody>
              {u.byModel.map((r: any) => (
                <tr key={r.provider + r.model}>
                  <td>{r.provider === 'none' ? 'no model (rules)' : r.provider}</td><td className="small">{r.model || '—'}</td><td>{num(r.calls)}</td><td>{num(r.input_tokens)}</td><td>{num(r.output_tokens)}</td>
                  <td>{inr(r.cost, 2)}</td><td>{inr(r.calls ? r.cost / r.calls : 0, 3)}</td><td>{r.failed ? <span className="badge bad">{r.failed}</span> : 0}</td><td>{Math.round(r.latency)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h3 style={{ padding: '14px 14px 0' }}>Customer cost forecast (month end)</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Workspace</th><th>Plan</th><th>MTD responses</th><th>MTD cost</th><th>Cost / response</th><th>Projected cost</th><th>Plan revenue</th><th>Margin</th></tr></thead>
            <tbody>
              {u.workspaces.map((w: any) => (
                <tr key={w.id}>
                  <td><strong>{w.name}</strong><div className="small muted">{w.vertical} · model {w.model_provider ?? 'default'}</div></td>
                  <td>{w.plan}</td><td>{num(w.mtd_responses)} <span className="small muted">→ {num(w.projectedResponses)}</span></td><td>{inr(w.mtd_cost, 2)}</td>
                  <td>{inr(w.costPerResponse, 3)}</td><td>{inr(w.projectedCost, 2)}</td><td>{inr(w.planRevenue)}</td>
                  <td><span className={`badge ${w.margin >= 0 ? 'ok' : 'bad'}`}>{inr(w.margin, 0)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Agents({ days }: { days: number }) {
  const d = useApi<any>(`/api/admin/agents?days=${days}`, [days]);
  const [run, setRun] = useState<any | null>(null);
  if (!d.data) return <Loading />;
  const a = d.data;
  const ff = a.findingsFeedback;
  const cx = ['', 'Simple (one question)', 'Multi-step (booking, actions, follow-ups)', 'Complex / sensitive (safety, worse, approvals)'];
  return (
    <div className="stack lg">
      <div className="card">
        <h3 style={{ padding: '14px 14px 0' }}>Agents</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Agent</th><th>Runs</th><th>Success</th><th>Handed off</th><th>Failed</th><th>Avg latency</th><th>Cost</th></tr></thead>
            <tbody>
              {a.byAgent.map((r: any) => (
                <tr key={r.agent}>
                  <td><strong>{r.agent}</strong><div className="small muted">{agentInfo[r.agent] ?? ''}</div></td>
                  <td>{num(r.runs)}</td>
                  <td><div className="meter sm"><div style={{ width: pct(r.ok, r.runs) }} /></div><span className="small">{pct(r.ok, r.runs)}</span></td>
                  <td className="small">{pct(r.handoff, r.runs)}</td>
                  <td>{r.failed ? <span className="badge bad">{r.failed}</span> : 0}</td>
                  <td className="small">{Math.round(r.latency)} ms</td>
                  <td className="small">{inr(r.cost, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid2">
        <div className="card pad stack">
          <h3>How agents handle harder situations</h3>
          {a.byComplexity.map((c: any) => (
            <div key={c.complexity} className="stack" style={{ gap: 4 }}>
              <div className="row between small"><strong>{cx[c.complexity]}</strong><span>{num(c.runs)} runs</span></div>
              <div className="meter stacked">
                <div style={{ width: pct(c.ok, c.runs), background: 'var(--ok)' }} />
                <div style={{ width: pct(c.handoff, c.runs), background: 'var(--warn)' }} />
                <div style={{ width: pct(c.failed, c.runs), background: 'var(--bad)' }} />
              </div>
              <div className="small muted">{pct(c.ok, c.runs)} handled by agents · {pct(c.handoff, c.runs)} escalated safely · {pct(c.failed, c.runs)} failed</div>
            </div>
          ))}
          {a.csatByComplexity.length > 0 && (
            <p className="small">User satisfaction by complexity: {a.csatByComplexity.map((c: any) => `${cx[c.complexity]?.split(' ')[0]} ${c.csat.toFixed(1)}/5 (${c.rated})`).join(' · ')}</p>
          )}
        </div>
        <div className="card pad stack">
          <h3>Doctors' verdict on the findings agent</h3>
          <div className="grid3">
            <Stat label="Useful" value={ff.useful} sub="reviewed or shared" tone="ok" />
            <Stat label="Dismissed" value={ff.dismissed} sub="not relevant" />
            <Stat label="Awaiting" value={ff.pending} sub={`${ff.urgent} urgent raised`} />
          </div>
          <p className="small muted">Precision as judged by doctors: {pct(ff.useful, ff.useful + ff.dismissed)}</p>
        </div>
      </div>
      <div className="card">
        <h3 style={{ padding: '14px 14px 0' }}>Doctor / staff ratings from visits</h3>
        {!a.staffRatings.length ? <Empty icon="⭐" title="No ratings yet" /> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Workspace</th><th>Ratings</th><th>Visit rating</th><th>Assistant rating</th></tr></thead>
            <tbody>
              {a.staffRatings.map((s: any) => (
                <tr key={s.name + s.org_name}><td><strong>{s.name}</strong><div className="small muted">{s.specialty}</div></td><td className="small">{s.org_name}</td><td>{s.ratings}</td><td>{s.avg.toFixed(1)} ★</td><td>{s.ai_avg ? `${s.ai_avg.toFixed(1)} ★` : '—'}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h3 style={{ padding: '14px 14px 0' }}>Recent complex cases</h3>
        <RunsTable rows={a.recentComplex} onOpen={setRun} />
      </div>
      {run && <RunModal run={run} onClose={() => setRun(null)} />}
    </div>
  );
}

function RunsTable({ rows, onOpen }: { rows: any[]; onOpen: (r: any) => void }) {
  if (!rows.length) return <Empty icon="✨" title="Nothing here" />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>When</th><th>Workspace</th><th>Agent</th><th>Status</th><th>Outcome</th><th>Tags</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(r)}>
              <td className="small">{timeAgo(r.created_at)}</td><td className="small">{r.org_name ?? '—'}</td><td>{r.agent}</td>
              <td><span className={`badge ${r.status === 'ok' ? 'ok' : r.status === 'handoff' ? 'warn' : 'bad'}`}>{r.status}</span></td>
              <td className="small">{r.outcome}</td>
              <td>{(r.tags ?? []).map((t: string) => <span key={t} className="badge tag">{t}</span>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunModal({ run, onClose }: { run: any; onClose: () => void }) {
  return (
    <Modal title={`${run.agent} · ${run.status}`} onClose={onClose}>
      <div className="small muted">{new Date(run.created_at).toLocaleString('en-IN')} · {run.org_name ?? 'platform'} {run.provider ? `· ${run.provider}${run.model ? ':' + run.model : ''}` : ''}</div>
      <div><strong>Outcome:</strong> {run.outcome}</div>
      <div>{(run.tags ?? []).map((t: string) => <span key={t} className="badge tag">{t}</span>)}</div>
      <ol className="steps">
        {(run.steps ?? []).map((s: any, i: number) => <li key={i}><code>{s.name}</code>{s.detail ? ` · ${s.detail}` : ''}</li>)}
      </ol>
    </Modal>
  );
}

const tagHelp: Record<string, string> = {
  'llm.error': 'Model call failed: check provider status and the API key',
  'llm.auth': 'Model rejected the key: the workspace BYOK key is wrong or revoked',
  'llm.rate_limited': 'Provider rate limit: raise limits or add a fallback model',
  'llm.timeout': 'Model too slow: consider a faster model',
  'llm.refused': 'Model refused to answer: review the prompt or content',
  'action.http_error': 'Institution API returned an error',
  'action.schema_drift': 'Institution API changed shape: approve the self-healing mapping',
  'action.error': 'Action failed before reaching the API',
  'outbox.delivery_failed': 'Proactive message not delivered (WhatsApp token/number?)',
  'intake.unreadable_file': 'Scanned image: needs manual entry or model-assisted extraction',
  'intake.nothing_extracted': 'Report text had no recognisable results',
  'handoff.low_confidence': 'Not sure from the knowledge: add knowledge for this topic',
  'handoff.no_knowledge': 'No knowledge matched: add an FAQ',
  'handoff.not_in_knowledge': 'The model found no answer in the sources',
  'handoff.emergency': 'Safety stop: emergency (by design)',
  'handoff.medical_advice': 'Safety stop: medical advice (by design)',
};

function Failures({ days }: { days: number }) {
  const [tag, setTag] = useState('');
  const d = useApi<any>(`/api/admin/failures?days=${days}&tag=${encodeURIComponent(tag)}`, [days, tag]);
  const [run, setRun] = useState<any | null>(null);
  if (!d.data) return <Loading />;
  return (
    <div className="stack lg">
      <div className="card pad stack">
        <h3>Procedural tags</h3>
        <p className="small muted">Every failed or escalated step is tagged with where it broke. Click a failure tag to filter.</p>
        {!d.data.byTag.length && <p className="small muted">No failures or escalations recorded. 🎉</p>}
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {d.data.byTag.map((t: any) => (
                <tr key={t.tag}>
                  <td><button className={`badge tag ${tag === t.tag ? 'active' : ''}`} onClick={() => setTag(tag === t.tag ? '' : t.tag)}>{t.tag}</button></td>
                  <td>{t.n}</td><td className="small muted">{tagHelp[t.tag] ?? ''}</td><td className="small muted">{timeAgo(t.last_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h3 style={{ padding: '14px 14px 0' }}>Failed agent runs {tag && <span className="badge tag">{tag}</span>}</h3>
        <RunsTable rows={d.data.runs} onOpen={setRun} />
      </div>
      <div className="card">
        <h3 style={{ padding: '14px 14px 0' }}>Failed background jobs</h3>
        {!d.data.jobs.length ? <Empty icon="✅" title="No failed jobs" /> : (
          <table className="table">
            <thead><tr><th>Job</th><th>Attempts</th><th>Error</th><th>When</th></tr></thead>
            <tbody>{d.data.jobs.map((j: any) => <tr key={j.id}><td>{j.type}</td><td>{j.attempts}</td><td className="small">{j.last_error}</td><td className="small">{timeAgo(j.updated_at)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      {run && <RunModal run={run} onClose={() => setRun(null)} />}
    </div>
  );
}

function Providers() {
  const d = useApi<any>('/api/admin/providers');
  if (!d.data) return <Loading />;
  return (
    <div className="stack lg">
      <div className="card pad"><strong>Platform default model:</strong> {d.data.platformDefault.provider}{d.data.platformDefault.model ? ` · ${d.data.platformDefault.model}` : ''} <span className="small muted">(used by workspaces without their own key)</span></div>
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Workspace</th><th>Provider</th><th>Model</th><th>Key</th><th>Budget / month</th><th>30-day cost</th><th>Model failures</th><th>Last used</th></tr></thead>
            <tbody>
              {d.data.workspaces.map((w: any) => (
                <tr key={w.id}>
                  <td><strong>{w.name}</strong><div className="small muted">{w.plan}</div></td>
                  <td>{w.provider ?? 'default'}</td><td className="small">{w.model ?? '—'}{w.base_url ? <div className="muted">{w.base_url}</div> : null}</td>
                  <td>{w.byok ? <span className="badge brand">BYOK {w.key_hint}</span> : <span className="badge">platform</span>}</td>
                  <td>{w.monthly_budget_inr ? inr(w.monthly_budget_inr) : '—'}</td><td>{inr(w.cost_30d, 2)}</td>
                  <td>{w.llm_failures_30d ? <span className="badge bad">{w.llm_failures_30d}</span> : 0}</td><td className="small">{w.last_used ? timeAgo(w.last_used) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Workspaces() {
  const d = useApi<any[]>('/api/admin/workspaces');
  if (!d.data) return <Loading />;
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Workspace</th><th>Type</th><th>Plan</th><th>Add-ons</th><th>Members</th><th>Staff</th><th>30d chats</th><th>30d bookings</th><th>Last active</th></tr></thead>
          <tbody>
            {d.data.map((w) => (
              <tr key={w.id}>
                <td><strong>{w.name}</strong><div className="small muted">{w.owners}</div></td><td>{w.vertical ?? 'general'}</td><td><span className="badge brand">{w.plan}</span></td>
                <td className="small">{w.addons ?? '—'}</td><td>{w.members}</td><td>{w.staff}</td><td>{w.conversations_30d}</td><td>{w.appointments_30d}</td><td className="small">{w.last_active ? timeAgo(w.last_active) : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const leadStatuses = ['new', 'contacted', 'early_access', 'converted', 'rejected'];

function Leads() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const d = useApi<any[]>(`/api/admin/leads?status=${status}`, [status]);
  const update = async (id: string, body: object) => {
    try {
      await api(`/api/admin/leads/${id}`, { method: 'PATCH', body });
      await d.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="stack lg">
      <div className="tabs">
        {['', ...leadStatuses].map((s) => <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>{s ? s.replace('_', ' ') : 'All'}</button>)}
      </div>
      <div className="card">
        {!d.data ? <Loading /> : !d.data.length ? <Empty icon="🌱" title="No leads yet">Early-access requests from the landing page land here.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Name</th><th>Institution</th><th>Message</th><th>Status</th><th>Notes</th></tr></thead>
              <tbody>
                {d.data.map((l) => (
                  <tr key={l.id}>
                    <td className="small">{timeAgo(l.created_at)}</td>
                    <td><strong>{l.name}</strong><div className="small"><a href={`mailto:${l.email}`}>{l.email}</a>{l.phone ? ` · ${l.phone}` : ''}</div></td>
                    <td className="small">{l.org_name}<div className="muted">{l.institution_type}{l.size ? ` · ${l.size}` : ''}</div></td>
                    <td className="small" style={{ maxWidth: 260 }}>{l.message}</td>
                    <td><select className="select" style={{ height: 30 }} value={l.status} onChange={(e) => update(l.id, { status: e.target.value })}>{leadStatuses.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></td>
                    <td><input className="input" style={{ height: 30 }} defaultValue={l.notes} onBlur={(e) => e.target.value !== l.notes && update(l.id, { notes: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Audit() {
  const [q, setQ] = useState('');
  const d = useApi<any[]>(`/api/admin/audit?q=${encodeURIComponent(q)}`, [q]);
  return (
    <div className="stack lg">
      <input className="input" placeholder="Filter by action, workspace or actor (e.g. finding, billing, consent)" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 480 }} />
      <div className="card">
        {!d.data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Workspace</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>
                {d.data.map((a) => (
                  <tr key={a.id}><td className="small">{timeAgo(a.at)}</td><td className="small">{a.org_name}</td><td className="small">{a.actor}</td><td><code>{a.action}</code></td><td className="small" style={{ maxWidth: 380, wordBreak: 'break-word' }}>{JSON.stringify(a.payload)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
