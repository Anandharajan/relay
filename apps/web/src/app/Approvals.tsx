import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo, useApi, useEvents } from '../lib/api';
import { useSession } from '../lib/session';
import { terms } from '../lib/terms';
import { Empty, Loading, useToast } from '../components/ui';
import { ReviewQueue } from '../components/ReviewQueue';

/** Doctor-in-the-loop: AI-drafted messages and AI findings wait here until a clinician decides. */
export function Approvals() {
  const { me } = useSession();
  const T = terms(me);
  const toast = useToast();
  const a = useApi<any>('/api/visits/approvals');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const readOnly = me?.role === 'viewer';
  useEvents({ attention: () => void a.reload(), 'records.updated': () => void a.reload() });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      await a.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  if (a.loading && !a.data) return <Loading />;
  const { messages = [], findings = [] } = a.data ?? {};
  const urgent = findings.filter((f: any) => f.severity === 'urgent');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p>Nothing clinical reaches a {T.client.toLowerCase()} until a {T.staff.toLowerCase()} approves it. Edit the wording, send it, or discard it.</p>
        </div>
      </div>
      {urgent.length > 0 && (
        <div className="card pad stack" style={{ borderColor: 'var(--bad)' }}>
          <h3 style={{ color: 'var(--bad)' }}>⚠️ Urgent findings ({urgent.length})</h3>
          {urgent.map((f: any) => (
            <div key={f.id} className="row between">
              <span><Link to={`/app/clients/${f.client_id}`}><strong>{f.client_name}</strong></Link> · {f.title}</span>
              <span className="small muted">{timeAgo(f.created_at)}</span>
            </div>
          ))}
        </div>
      )}
      <ReviewQueue readOnly={readOnly} />
      <div className="grid2">
        <div className="card pad stack">
          <h3>Messages waiting for approval ({messages.length})</h3>
          {!messages.length && <Empty icon="✅" title="Nothing waiting" />}
          {messages.map((m: any) => (
            <div key={m.id} className="outbox-item stack" style={{ gap: 8 }}>
              <div className="row between small">
                <span><Link to={`/app/clients/${m.client_id}`}><strong>{m.client_name}</strong></Link> · {m.kind}{m.meta?.severity === 'urgent' ? ' · urgent' : ''}</span>
                <span className="muted">drafted by the findings agent · {timeAgo(m.created_at)}</span>
              </div>
              <textarea className="textarea" rows={3} disabled={readOnly} value={edits[m.id] ?? m.body} onChange={(e) => setEdits({ ...edits, [m.id]: e.target.value })} />
              {!readOnly && (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm primary" onClick={() => run(() => api(`/api/visits/outbox/${m.id}/approve`, { body: edits[m.id] ? { body: edits[m.id] } : {} }), 'Approved and sent')}>Approve and send</button>
                  <button className="btn sm ghost" onClick={() => run(() => api(`/api/visits/outbox/${m.id}/discard`, { body: {} }), 'Discarded')}>Discard</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="card pad stack">
          <h3>Open findings ({findings.length})</h3>
          {!findings.length && <Empty icon="🩺" title="All reviewed" />}
          {findings.map((f: any) => (
            <div key={f.id} className={`finding ${f.severity}`}>
              <div className="row between small">
                <Link to={`/app/clients/${f.client_id}`}><strong>{f.client_name}</strong></Link>
                <span className={`badge ${f.severity === 'urgent' ? 'bad' : f.severity === 'attention' ? 'warn' : 'info'}`}>{f.severity}</span>
              </div>
              <div>{f.title}</div>
              <div className="small muted">{f.detail}</div>
              {!readOnly && (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => run(() => api(`/api/visits/findings/${f.id}/review`, { body: { action: 'acknowledge' } }), 'Reviewed')}>Reviewed</button>
                  <button className="btn sm ghost" onClick={() => run(() => api(`/api/visits/findings/${f.id}/review`, { body: { action: 'dismiss' } }), 'Dismissed')}>Not relevant</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
