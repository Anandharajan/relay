import { useState } from 'react';
import { inr, langLabel, pct, useApi } from '../lib/api';
import { Loading } from '../components/ui';

const ranges = [7, 30, 90];

function HBars({ rows, label }: { rows: { key: string; n: number }[]; label: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="small muted">No data yet.</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {rows.map((r) => (
        <div className="hbar" key={r.key} title={`${label(r.key)}: ${r.n}`}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(r.key)}</span>
          <div className="track"><div className="fill" style={{ width: `${(r.n / max) * 100}%` }} /></div>
          <span className="num">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

export function Analytics() {
  const [days, setDays] = useState(30);
  const [table, setTable] = useState(false);
  const { data } = useApi<any>(`/api/analytics?days=${days}`);
  if (!data) return <Loading />;
  const t = data.totals;
  const daily: { day: string; conversations: number; ai_resolved: number; human_resolved: number }[] = data.daily;
  const max = Math.max(1, ...daily.map((d) => Math.max(d.conversations, d.ai_resolved + d.human_resolved)));
  const savings = data.perResolutionEquivalentInr - data.costInr;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p>Resolution, deflection, satisfaction and what the AI actually costs you.</p>
        </div>
        <div className="tabs">
          {ranges.map((r) => (
            <button key={r} className={days === r ? 'active' : ''} onClick={() => setDays(r)}>Last {r} days</button>
          ))}
        </div>
      </div>

      <div className="grid4">
        <div className="card stat"><div className="label">AI resolution rate</div><div className="value">{pct(data.resolutionRate)}</div><div className="sub">{t.ai_resolved} of {t.conversations} conversations</div></div>
        <div className="card stat"><div className="label">Deflection</div><div className="value">{pct(data.deflectionRate)}</div><div className="sub">no human needed</div></div>
        <div className="card stat"><div className="label">CSAT</div><div className="value">{pct(data.csat)}</div><div className="sub">{t.csat_positive} 👍 of {t.csat_count} ratings</div></div>
        <div className="card stat"><div className="label">Cost per resolution</div><div className="value">{inr(data.costPerResolutionInr, 2)}</div><div className="sub">{inr(data.costInr, 2)} total · {data.tokens.toLocaleString('en-IN')} tokens</div></div>
      </div>

      <div className="card pad stack">
        <div className="row between wrap">
          <h2>Conversations per day</h2>
          <div className="row wrap">
            <div className="legend">
              <span><i style={{ background: 'var(--series-1)' }} />Resolved by AI</span>
              <span><i style={{ background: 'var(--series-2)' }} />Resolved by team</span>
              <span><i style={{ background: 'var(--series-3)' }} />Other / open</span>
            </div>
            <button className="btn sm" onClick={() => setTable(!table)}>{table ? 'Chart view' : 'Table view'}</button>
          </div>
        </div>
        {table ? (
          <div className="table-wrap" style={{ maxHeight: 320 }}>
            <table className="table">
              <thead><tr><th>Day</th><th>Conversations</th><th>Resolved by AI</th><th>Resolved by team</th></tr></thead>
              <tbody>
                {[...daily].reverse().map((d) => (
                  <tr key={d.day}><td>{d.day}</td><td>{d.conversations}</td><td>{d.ai_resolved}</td><td>{d.human_resolved}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div>
            <div className="bars" role="img" aria-label="Daily conversations stacked by outcome">
              {daily.map((d) => {
                const other = Math.max(0, d.conversations - d.ai_resolved - d.human_resolved);
                const segs = [
                  { n: other, c: 'var(--series-3)' },
                  { n: d.human_resolved, c: 'var(--series-2)' },
                  { n: d.ai_resolved, c: 'var(--series-1)' },
                ].filter((s) => s.n > 0);
                return (
                  <div
                    key={d.day}
                    className="col"
                    data-tip={`${new Date(d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${d.conversations} new · ${d.ai_resolved} AI · ${d.human_resolved} team`}
                  >
                    {segs.map((s, i) => <div key={i} className="seg" style={{ height: `${(s.n / max) * 100}%`, background: s.c }} />)}
                  </div>
                );
              })}
            </div>
            <div className="axis-x">
              <span>{daily[0]?.day.slice(5)}</span>
              <span>{daily[Math.floor(daily.length / 2)]?.day.slice(5)}</span>
              <span>{daily[daily.length - 1]?.day.slice(5)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid3">
        <div className="card pad stack">
          <h3>Languages</h3>
          <HBars rows={data.languages.map((l: any) => ({ key: l.lang, n: l.n }))} label={(k) => langLabel[k] ?? k} />
        </div>
        <div className="card pad stack">
          <h3>Channels</h3>
          <HBars rows={data.channels.map((c: any) => ({ key: c.channel, n: c.n }))} label={(k) => ({ web: 'Web chat', whatsapp: 'WhatsApp', email: 'Email' })[k] ?? k} />
        </div>
        <div className="card pad stack">
          <h3>Why the AI handed off</h3>
          <HBars
            rows={data.handoffReasons.map((r: any) => ({ key: r.reason, n: r.n }))}
            label={(k) => ({ customer_requested: 'Customer asked for a human', low_confidence: 'Low confidence', not_in_knowledge: 'Not in knowledge', no_knowledge: 'No knowledge found', plan_limit: 'Plan limit', model_refused: 'Model declined', 'action_failed:': 'Action failed' })[k] ?? k.replace(/_/g, ' ')}
          />
        </div>
      </div>

      <div className="grid2">
        <div className="card pad stack">
          <h3>Questions the AI couldn't answer</h3>
          {data.unanswered.length ? (
            <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {data.unanswered.map((u: any) => <li key={u.question}>{u.question} <span className="muted">×{u.n}</span></li>)}
            </ul>
          ) : (
            <p className="small muted">None — nice. 🎉</p>
          )}
        </div>
        <div className="card pad stack">
          <h3>vs. per-resolution pricing</h3>
          <p className="small muted">At a typical $0.99 per AI resolution, these would have cost about</p>
          <div style={{ fontSize: 26, fontWeight: 750 }}>{inr(data.perResolutionEquivalentInr)}</div>
          <p className="small">for these {t.ai_resolved} AI resolutions. Your model spend: <strong>{inr(data.costInr, 2)}</strong>{savings > 0 && <> — <span style={{ color: 'var(--ok)' }}>{inr(savings)} saved</span></>}.</p>
        </div>
      </div>
    </div>
  );
}
