import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi, useEvents } from '../lib/api';
import { useSession } from '../lib/session';
import { fmtDateTime, fmtTime, terms } from '../lib/terms';
import { Empty, ErrorBox, Field, Loading, Modal, useToast } from '../components/ui';

const statusTone: Record<string, string> = { booked: '', checked_in: 'info', in_progress: 'brand', done: 'ok', cancelled: 'muted', no_show: 'bad' };
const statusText: Record<string, string> = { booked: 'Booked', checked_in: 'Waiting', in_progress: 'With doctor', done: 'Done', cancelled: 'Cancelled', no_show: 'No-show' };

/** Today's live queue per staff member, the day's list, and desk booking. */
export function Visits() {
  const { me } = useSession();
  const T = terms(me);
  const toast = useToast();
  const [view, setView] = useState<'queue' | 'list'>('queue');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const queue = useApi<any[]>('/api/visits/queue');
  const list = useApi<any[]>(view === 'list' ? `/api/visits/appointments?date=${date}` : null, [date]);
  const [booking, setBooking] = useState(false);
  const [finishing, setFinishing] = useState<any | null>(null);
  const readOnly = me?.role === 'viewer';

  useEvents({ 'visits.updated': () => void queue.reload() });
  useEffect(() => {
    const t = window.setInterval(() => void queue.reload(), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const act = async (id: string, op: string, body: object = {}) => {
    try {
      await api(`/api/visits/appointments/${id}/${op}`, { body });
      await queue.reload();
      if (view === 'list') await list.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{T.visits}</h1>
          <p>Live queue with waiting-time estimates. Check-ins arrive from the QR code, WhatsApp, the front desk{T.healthcare ? ' or the camera add-on' : ''}.</p>
        </div>
        <div className="row">
          <div className="tabs" style={{ border: 0 }}>
            <button className={view === 'queue' ? 'active' : ''} onClick={() => setView('queue')}>Today's queue</button>
            <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>Day list</button>
          </div>
          {!readOnly && <button className="btn primary" onClick={() => setBooking(true)}>+ Book</button>}
        </div>
      </div>

      {view === 'queue' &&
        (queue.loading && !queue.data ? (
          <Loading />
        ) : !queue.data?.length ? (
          <Empty icon="🗓️" title={`No ${T.staffs.toLowerCase()} yet`}>
            <Link to="/app/settings/staff">Add {T.staffs.toLowerCase()} and their hours</Link>
          </Empty>
        ) : (
          <div className="queue-grid">
            {queue.data.map((q) => (
              <div className="card pad stack" key={q.staff.id} style={{ gap: 10 }}>
                <div className="row between">
                  <div>
                    <strong>{q.staff.name}</strong>
                    <div className="small muted">{q.staff.specialty} · ~{q.avgMinutes} min/visit</div>
                  </div>
                  <span className="badge info">{q.waiting.length} waiting</span>
                </div>
                <div className="queue-now">
                  {q.current ? (
                    <>
                      <span className="small muted">Now seeing</span>
                      <div className="row between">
                        <Link to={`/app/clients/${q.current.client.id}`}><strong>#{q.current.appointment.token_no} {q.current.client.name}</strong></Link>
                        {!readOnly && <button className="btn sm" onClick={() => setFinishing(q.current.appointment)}>Finish</button>}
                      </div>
                    </>
                  ) : (
                    <span className="small muted">Nobody in consultation</span>
                  )}
                </div>
                {q.waiting.map((w: any) => (
                  <div className="row between queue-row" key={w.appointment.id}>
                    <div>
                      <Link to={`/app/clients/${w.client.id}`}>#{w.appointment.token_no} {w.client.name}</Link>
                      <div className="small muted">
                        slot {fmtTime(w.appointment.starts_at)} · arrived {fmtTime(w.appointment.checked_in_at)} via {w.appointment.checkin_method}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="badge brand" title="Estimated wait">~{w.etaMin} min</span>
                      {!readOnly && <button className="btn sm" onClick={() => act(w.appointment.id, 'start')}>Call in</button>}
                    </div>
                  </div>
                ))}
                {q.upcoming.length > 0 && (
                  <details>
                    <summary className="small muted">{q.upcoming.length} booked, not arrived</summary>
                    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                      {q.upcoming.map((u: any) => (
                        <div className="row between small" key={u.appointment.id}>
                          <span>{fmtTime(u.appointment.starts_at)} · #{u.appointment.token_no} {u.client.name}</span>
                          {!readOnly && (
                            <span className="row" style={{ gap: 4 }}>
                              <button className="btn sm" onClick={() => act(u.appointment.id, 'checkin')}>Check in</button>
                              <button className="btn sm ghost" onClick={() => act(u.appointment.id, 'no_show')}>No-show</button>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {q.done.length > 0 && <div className="small muted">{q.done.filter((d: any) => d.appointment.status === 'done').length} seen today</div>}
              </div>
            ))}
          </div>
        ))}

      {view === 'list' && (
        <div className="card">
          <div className="row" style={{ padding: 12 }}>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 180 }} />
          </div>
          {list.loading ? (
            <Loading />
          ) : !list.data?.length ? (
            <Empty icon="📭" title={`No ${T.visits.toLowerCase()} on this day`} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Time</th><th>Token</th><th>{T.client}</th><th>{T.staff}</th><th>Reason</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {list.data.map((a) => (
                    <tr key={a.id}>
                      <td>{fmtTime(a.starts_at)}</td>
                      <td>#{a.token_no}</td>
                      <td><Link to={`/app/clients/${a.client_id}`}>{a.client_name}</Link><div className="small muted">{a.client_phone}</div></td>
                      <td>{a.staff_name}</td>
                      <td className="small">{a.reason}</td>
                      <td><span className={`badge ${statusTone[a.status] ?? ''}`}>{statusText[a.status] ?? a.status}</span></td>
                      <td>
                        {!readOnly && a.status === 'booked' && (
                          <button className="btn sm ghost" onClick={() => act(a.id, 'cancel')}>Cancel</button>
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

      {booking && <BookModal onClose={() => setBooking(false)} onDone={() => { setBooking(false); void queue.reload(); void list.reload(); toast('Booked, confirmation sent'); }} />}
      {finishing && (
        <FinishModal
          appt={finishing}
          onClose={() => setFinishing(null)}
          onDone={async (b) => {
            await act(finishing.id, 'finish', b);
            setFinishing(null);
          }}
        />
      )}
    </div>
  );
}

export function BookModal({ onClose, onDone, clientId, clientName }: { onClose: () => void; onDone: () => void; clientId?: string; clientName?: string }) {
  const { me } = useSession();
  const T = terms(me);
  const staff = useApi<any[]>('/api/visits/staff');
  const [staffId, setStaffId] = useState('');
  const slots = useApi<string[]>(staffId ? `/api/visits/slots?staffId=${staffId}` : null, [staffId]);
  const [slot, setSlot] = useState('');
  const [form, setForm] = useState({ name: clientName ?? '', phone: '', lang: 'ta', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/visits/appointments', {
        body: { staffId, startsAt: slot, reason: form.reason, ...(clientId ? { clientId } : { client: { name: form.name, phone: form.phone || null, lang: form.lang } }) },
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Book ${T.visit.toLowerCase()}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !staffId || !slot || (!clientId && form.name.length < 2)} onClick={submit}>Book and notify</button></>}
    >
      <ErrorBox error={error} />
      {!clientId && (
        <div className="grid2">
          <Field label={`${T.client} name`}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="WhatsApp number"><input className="input" value={form.phone} placeholder="98xxxxxxxx" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Language">
            <select className="select" value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value })}>
              <option value="ta">தமிழ்</option><option value="en">English</option><option value="hi">हिंदी</option><option value="kn">ಕನ್ನಡ</option><option value="te">తెలుగు</option>
            </select>
          </Field>
        </div>
      )}
      <Field label={T.staff}>
        <select className="select" value={staffId} onChange={(e) => { setStaffId(e.target.value); setSlot(''); }}>
          <option value="">Choose…</option>
          {(staff.data ?? []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.specialty}</option>)}
        </select>
      </Field>
      {staffId && (
        <Field label="Time">
          <div className="row wrap" style={{ gap: 6 }}>
            {slots.loading ? <span className="small muted">Finding free slots…</span> : (slots.data ?? []).map((s) => (
              <button key={s} type="button" className={`btn sm ${slot === s ? 'primary' : ''}`} onClick={() => setSlot(s)}>{fmtDateTime(s)}</button>
            ))}
            {!slots.loading && !slots.data?.length && <span className="small muted">No free slots in the next week.</span>}
          </div>
        </Field>
      )}
      <Field label="Reason (optional)" hint={T.healthcare ? 'Used to match the doctor-approved preparation instructions.' : undefined}>
        <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      </Field>
    </Modal>
  );
}

function FinishModal({ appt, onClose, onDone }: { appt: any; onClose: () => void; onDone: (b: { followupDays: number | null; checkinDays: number | null }) => void }) {
  const [followupDays, setF] = useState<string>('');
  const [checkinDays, setC] = useState<string>('3');
  return (
    <Modal
      title={`Finish visit · token #${appt.token_no}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onDone({ followupDays: followupDays ? Number(followupDays) : null, checkinDays: checkinDays ? Number(checkinDays) : null })}>Finish</button></>}
    >
      <p className="small muted">The follow-up coordinator messages (and, with telecalling, calls) the patient on these days. Replies of "worse" alert the team immediately.</p>
      <div className="grid2">
        <Field label="How-are-you check-in after (days)"><input className="input" type="number" min={1} max={30} value={checkinDays} onChange={(e) => setC(e.target.value)} placeholder="none" /></Field>
        <Field label="Review visit after (days)"><input className="input" type="number" min={1} max={365} value={followupDays} onChange={(e) => setF(e.target.value)} placeholder="none" /></Field>
      </div>
    </Modal>
  );
}
