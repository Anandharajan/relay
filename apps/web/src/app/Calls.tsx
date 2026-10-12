import { Link } from 'react-router-dom';
import { api, timeAgo, useApi, useEvents } from '../lib/api';
import { useSession } from '../lib/session';
import { Empty, Loading, useToast } from '../components/ui';

const outcomeTone: Record<string, string> = { confirmed: 'ok', better: 'ok', same: 'info', reschedule: 'warn', worse: 'bad', none: '' };

/** Telecalling add-on: AI reminder and follow-up calls, with a simulator when no telephony account is connected. */
export function Calls() {
  const { me } = useSession();
  const toast = useToast();
  const d = useApi<any>('/api/visits/calls');
  useEvents({ 'calls.updated': () => void d.reload() });
  if (d.loading && !d.data) return <Loading />;
  const { enabled, provider, calls = [] } = d.data ?? {};
  const press = async (id: string, digit: string) => {
    try {
      const r = await api(`/api/visits/calls/${id}/simulate`, { body: { digit } });
      toast(r.reply || 'Recorded');
      await d.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Calls</h1>
          <p>AI telecaller: appointment reminders (press 1 to confirm, 2 to reschedule) and post-visit check-ins (1 better, 2 same, 3 worse) in the patient's language.</p>
        </div>
        <span className={`badge ${enabled ? 'ok' : ''}`}>{enabled ? `Add-on active · ${provider}` : 'Add-on not active'}</span>
      </div>
      {!enabled ? (
        <div className="card pad stack">
          <h3>AI telecalling is a paid add-on</h3>
          <p className="muted">Reminder calls cut no-shows for patients who don't read WhatsApp. Start a 14-day trial, then connect Twilio or keep using the simulator.</p>
          {me?.role === 'owner' && <Link className="btn primary" to="/app/settings/billing">Start free trial</Link>}
        </div>
      ) : (
        <div className="card">
          {!calls.length ? (
            <Empty icon="📞" title="No calls yet">Calls are placed automatically 26 hours before appointments and a few hours after unanswered follow-ups.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>Patient</th><th>Purpose</th><th>Provider</th><th>Status</th><th>Outcome</th><th>Transcript</th></tr></thead>
                <tbody>
                  {calls.map((c: any) => (
                    <tr key={c.id}>
                      <td className="small">{timeAgo(c.created_at)}</td>
                      <td>{c.client_id ? <Link to={`/app/clients/${c.client_id}`}>{c.client_name}</Link> : c.to_number}</td>
                      <td className="small">{c.direction} · {c.purpose}</td>
                      <td className="small">{c.provider}</td>
                      <td><span className={`badge ${c.status === 'failed' ? 'bad' : c.status === 'completed' ? 'ok' : 'info'}`}>{c.status}</span></td>
                      <td>{c.outcome ? <span className={`badge ${outcomeTone[c.outcome] ?? ''}`}>{c.outcome}</span> : '—'}</td>
                      <td className="small" style={{ maxWidth: 320 }}>
                        {(c.transcript ?? []).map((t: any, i: number) => <div key={i}><strong>{t.who}:</strong> {t.text}</div>)}
                        {c.provider === 'simulated' && c.status === 'ringing' && me?.role !== 'viewer' && (
                          <div className="row" style={{ gap: 4, marginTop: 6 }}>
                            <span className="muted">Answer as patient:</span>
                            {['1', '2', ...(c.purpose === 'followup' ? ['3'] : [])].map((k) => <button key={k} className="btn sm" onClick={() => press(c.id, k)}>{k}</button>)}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
