import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, timeAgo, useApi, useEvents } from '../lib/api';
import { useSession } from '../lib/session';
import { fmtDate, fmtDateTime, langLabel, terms } from '../lib/terms';
import { Empty, ErrorBox, Field, Loading, Modal, useToast } from '../components/ui';
import { BookModal } from './Visits';

export function Clients() {
  const { me } = useSession();
  const T = terms(me);
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const list = useApi<any[]>(`/api/visits/clients?q=${encodeURIComponent(q)}`, [q]);
  const [adding, setAdding] = useState(false);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{T.clients}</h1>
          <p>{T.healthcare ? 'Medical history, reports read by the intake agent, AI findings for the doctor, investigations and messages.' : 'Everyone who booked or messaged, with their visits and messages.'}</p>
        </div>
        {me?.role !== 'viewer' && <button className="btn primary" onClick={() => setAdding(true)}>+ Add {T.client.toLowerCase()}</button>}
      </div>
      <input className="input" placeholder="Search by name or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
      <div className="card">
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.length ? (
          <Empty icon="🧑‍⚕️" title={`No ${T.clients.toLowerCase()} yet`}>They appear here when someone books on chat or the front desk adds them.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Phone</th><th>Language</th><th>Next visit</th>{T.healthcare && <th>Findings</th>}</tr></thead>
              <tbody>
                {list.data.map((c) => (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/app/clients/${c.id}`)}>
                    <td><strong>{c.name}</strong>{c.birth_year && <div className="small muted">{new Date().getFullYear() - c.birth_year} y{c.sex ? ` · ${c.sex}` : ''}</div>}</td>
                    <td className="small">{c.phone ? `+${c.phone}` : '—'}</td>
                    <td className="small">{langLabel[c.lang] ?? c.lang}</td>
                    <td className="small">{c.next_visit ? fmtDateTime(c.next_visit) : '—'}</td>
                    {T.healthcare && (
                      <td>{c.urgent ? <span className="badge bad">Urgent</span> : c.open_findings ? <span className="badge warn">{c.open_findings} to review</span> : <span className="small muted">—</span>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <AddClient onClose={() => setAdding(false)} onDone={(id) => nav(`/app/clients/${id}`)} />}
    </div>
  );
}

function AddClient({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { me } = useSession();
  const T = terms(me);
  const [f, setF] = useState({ name: '', phone: '', lang: 'ta', birthYear: '', sex: '' });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      const r = await api('/api/visits/clients', { body: { name: f.name, phone: f.phone || null, lang: f.lang, birthYear: f.birthYear ? Number(f.birthYear) : null, sex: f.sex || null } });
      onDone(r.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title={`Add ${T.client.toLowerCase()}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={f.name.length < 2} onClick={save}>Save</button></>}>
      <ErrorBox error={error} />
      <div className="grid2">
        <Field label="Full name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="WhatsApp number"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="98xxxxxxxx" /></Field>
        <Field label="Language"><select className="select" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })}>{Object.entries(langLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Birth year"><input className="input" type="number" value={f.birthYear} onChange={(e) => setF({ ...f, birthYear: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

const flagTone: Record<string, string> = { normal: 'ok', high: 'warn', low: 'warn', critical_high: 'bad', critical_low: 'bad' };
const sevTone: Record<string, string> = { urgent: 'bad', attention: 'warn', info: 'info' };

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 60},${18 - ((v - min) / (max - min || 1)) * 16}`).join(' ');
  return (
    <svg width="64" height="20" aria-hidden="true" style={{ verticalAlign: 'middle' }}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** The doctor brief: everything about one person on one page. */
export function ClientDetail() {
  const { id } = useParams();
  const { me } = useSession();
  const T = terms(me);
  const toast = useToast();
  const b = useApi<any>(`/api/visits/clients/${id}`, [id]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState(false);
  const [order, setOrder] = useState<any | null>(null);
  const [booking, setBooking] = useState(false);
  const [msg, setMsg] = useState('');
  const readOnly = me?.role === 'viewer';
  useEvents({ 'records.updated': (d) => d.clientId === id && void b.reload() });
  if (b.loading && !b.data) return <Loading />;
  if (!b.data) return <div className="page"><ErrorBox error={b.error} /></div>;
  const { client, latest, findings, investigations, records, appointments, outbox, followups, medicines } = b.data;
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
      await b.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const upload = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    await run(() => api(`/api/visits/clients/${id}/records`, { form }), 'Uploaded. The intake agent is reading it…');
    setTimeout(() => void b.reload(), 2500);
  };
  const openFindings = findings.filter((f: any) => f.status === 'open');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/app/clients" className="small">← {T.clients}</Link>
          <h1>{client.name}</h1>
          <p>
            {client.birth_year ? `${new Date().getFullYear() - client.birth_year} y · ` : ''}
            {client.sex ? `${client.sex} · ` : ''}
            {client.phone ? `+${client.phone} · ` : ''}
            {langLabel[client.lang] ?? client.lang}
          </p>
        </div>
        {!readOnly && (
          <div className="row wrap">
            <button className="btn" onClick={() => setBooking(true)}>Book {T.visit.toLowerCase()}</button>
            {T.healthcare && (
              <>
                <button className="btn" onClick={() => fileRef.current?.click()}>Upload report</button>
                <button className="btn" onClick={() => setPaste(true)}>Paste report text</button>
                <button className="btn primary" onClick={() => setOrder({ test: 'custom', label: '', instructions: '' })}>Order investigation</button>
              </>
            )}
            <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.txt,.jpg,.jpeg,.png" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
        )}
      </div>

      {T.healthcare && (
        <div className="grid2">
          <div className="card pad stack">
            <div className="row between">
              <h3>AI findings for the doctor</h3>
              <span className="small muted">findings agent · reviewed before anyone tells the patient</span>
            </div>
            {!findings.length && <p className="small muted">No findings. Upload reports to have the intake and findings agents review them.</p>}
            {findings.map((f: any) => (
              <div key={f.id} className={`finding ${f.severity}`}>
                <div className="row between">
                  <span className={`badge ${sevTone[f.severity]}`}>{f.severity}</span>
                  <span className="small muted">{f.status === 'open' ? timeAgo(f.created_at) : `${f.status} by ${f.reviewed_by ?? '—'}`}</span>
                </div>
                <strong>{f.title}</strong>
                <div className="small muted">{f.detail}</div>
                {f.status === 'open' && !readOnly && (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn sm" onClick={() => run(() => api(`/api/visits/findings/${f.id}/review`, { body: { action: 'acknowledge' } }), 'Marked as reviewed')}>Reviewed</button>
                    <button className="btn sm ghost" onClick={() => run(() => api(`/api/visits/findings/${f.id}/review`, { body: { action: 'dismiss' } }), 'Dismissed')}>Not relevant</button>
                  </div>
                )}
              </div>
            ))}
            {openFindings.length > 0 && <Link to="/app/approvals" className="small">Approve the patient message for these findings →</Link>}
          </div>

          <div className="card pad stack">
            <h3>Latest results</h3>
            {!latest.length ? (
              <p className="small muted">No structured results yet.</p>
            ) : (
              <table className="table compact">
                <tbody>
                  {latest.map((o: any) => (
                    <tr key={o.test}>
                      <td>{o.label}</td>
                      <td><strong>{Math.round(o.value * 100) / 100}</strong> <span className="small muted">{o.unit}</span></td>
                      <td><span className={`badge ${flagTone[o.flag]}`}>{o.flag.replace('_', ' ')}</span></td>
                      <td className="muted"><Spark values={o.trend} /></td>
                      <td className="small muted">{fmtDate(o.observed_on)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {medicines.length > 0 && (
              <>
                <h4>Medicines on record</h4>
                <div className="row wrap" style={{ gap: 6 }}>{medicines.map((m: string) => <span className="badge" key={m}>{m}</span>)}</div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid2">
        {T.healthcare && (
          <div className="card pad stack">
            <h3>Investigations</h3>
            {!investigations.length && <p className="small muted">None ordered.</p>}
            {investigations.map((i: any) => (
              <div className="row between" key={i.id}>
                <div>
                  <strong>{i.label}</strong>
                  <div className="small muted">{i.status === 'suggested' ? `Suggested by the findings agent. ${i.instructions}` : `${i.ordered_by ?? ''}${i.due_by ? ` · due ${fmtDate(i.due_by)}` : ''}`}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`badge ${i.status === 'resulted' ? 'ok' : i.status === 'overdue' ? 'bad' : i.status === 'suggested' ? '' : 'info'}`}>{i.status}</span>
                  {i.status === 'suggested' && !readOnly && <button className="btn sm" onClick={() => setOrder(i)}>Order</button>}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="card pad stack">
          <h3>{T.visits}</h3>
          {!appointments.length && <p className="small muted">No visits yet.</p>}
          {appointments.slice(0, 8).map((a: any) => (
            <div className="row between small" key={a.id}>
              <span>{fmtDateTime(a.starts_at)} · {a.staff_name}</span>
              <span className="row" style={{ gap: 6 }}>
                <span className="badge">{a.status.replace('_', ' ')}</span>
                <a href={`/v/${a.code}`} target="_blank" rel="noreferrer">visit page ↗</a>
              </span>
            </div>
          ))}
          {followups.length > 0 && (
            <>
              <h4>Follow-ups</h4>
              {followups.map((f: any) => (
                <div className="row between small" key={f.id}>
                  <span>{f.kind === 'checkin' ? 'How-are-you check-in' : 'Review reminder'} · {fmtDate(f.due_at)}</span>
                  <span className={`badge ${f.status === 'worse' ? 'bad' : f.status === 'better' ? 'ok' : ''}`}>{f.status}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="grid2">
        {T.healthcare && (
          <div className="card pad stack">
            <h3>Reports and records</h3>
            {!records.length && <p className="small muted">Nothing uploaded yet. Patients can also upload from their visit page.</p>}
            {records.map((r: any) => (
              <div className="row between small" key={r.id}>
                <span>📄 {r.title} <span className="muted">· {r.kind} · {r.uploaded_by}</span></span>
                <span className="row" style={{ gap: 6 }}>
                  <span className={`badge ${r.status === 'processed' ? 'ok' : r.status === 'needs_review' ? 'warn' : ''}`}>{r.status === 'processed' ? `${r.summary?.observations ?? 0} results` : r.status.replace('_', ' ')}</span>
                  {r.observed_on && <span className="muted">{fmtDate(r.observed_on)}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="card pad stack">
          <h3>Messages to {client.name.split(' ')[0]}</h3>
          {!readOnly && (
            <div className="row">
              <input className="input" placeholder="Write a message (sent now, in your words)" value={msg} onChange={(e) => setMsg(e.target.value)} />
              <button className="btn" disabled={!msg.trim()} onClick={() => run(() => api(`/api/visits/clients/${id}/messages`, { body: { body: msg } }), 'Sent').then(() => setMsg(''))}>Send</button>
            </div>
          )}
          {outbox.slice(0, 12).map((o: any) => (
            <div className="outbox-item" key={o.id}>
              <div className="row between small">
                <span className="badge">{o.kind}</span>
                <span className={o.status === 'pending_approval' ? 'badge warn' : 'muted'}>{o.status === 'sent' ? timeAgo(o.sent_at) : o.status.replace('_', ' ')}</span>
              </div>
              <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{o.body}</div>
            </div>
          ))}
        </div>
      </div>

      {paste && <PasteReport clientId={id!} onClose={() => setPaste(false)} onDone={() => { setPaste(false); toast('Saved. The intake agent is reading it…'); setTimeout(() => void b.reload(), 1500); }} />}
      {order && <OrderModal clientId={id!} inv={order} onClose={() => setOrder(null)} onDone={() => { setOrder(null); void b.reload(); toast('Ordered, the patient has been told what to do'); }} />}
      {booking && <BookModal clientId={id} clientName={client.name} onClose={() => setBooking(false)} onDone={() => { setBooking(false); void b.reload(); toast('Booked, confirmation sent'); }} />}
    </div>
  );
}

function PasteReport({ clientId, onClose, onDone }: { clientId: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('Lab report');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Paste report text"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={text.length < 5} onClick={() => api(`/api/visits/clients/${clientId}/records`, { body: { title, text } }).then(onDone, (e) => setError(e.message))}>Save and analyse</button></>}
    >
      <ErrorBox error={error} />
      <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Report text" hint="One result per line works best, e.g. “HbA1c 8.4 % 4.0 - 5.6”.">
        <textarea className="textarea" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </Modal>
  );
}

function OrderModal({ clientId, inv, onClose, onDone }: { clientId: string; inv: any; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState(inv.label ?? '');
  const [instructions, setInstructions] = useState(inv.id ? '' : inv.instructions ?? '');
  const [dueBy, setDue] = useState(() => new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const submit = () =>
    (inv.id
      ? api(`/api/visits/investigations/${inv.id}/order`, { body: { dueBy, instructions } })
      : api(`/api/visits/clients/${clientId}/investigations`, { body: { test: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) || 'custom', label, instructions, dueBy } })
    ).then(onDone, (e) => setError(e.message));
  return (
    <Modal title="Order investigation" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!label} onClick={submit}>Order and inform patient</button></>}>
      <ErrorBox error={error} />
      <Field label="Test"><input className="input" value={label} disabled={Boolean(inv.id)} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Lipid profile" /></Field>
      <Field label="Instructions for the patient" hint="Sent in the patient's language thread, in your words.">
        <textarea className="textarea" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Fasting 10–12 hours. Lab opens 7 AM." />
      </Field>
      <Field label="Due by"><input className="input" type="date" value={dueBy} onChange={(e) => setDue(e.target.value)} /></Field>
    </Modal>
  );
}
