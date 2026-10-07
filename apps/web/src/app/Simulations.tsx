import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ago, api, pct, timeAgo, useApi, useEvents } from '../lib/api';
import { canAdmin, useSession } from '../lib/session';
import { Empty, ErrorBox, Field, Loading, Modal, StatusBadge } from '../components/ui';

const sample = `How long does delivery take?
Do you ship internationally? => india
Which grind for French press? => coarse
क्या कैश ऑन डिलीवरी उपलब्ध है? => ₹2,000|2000
ಉಚಿತ ಶಿಪ್ಪಿಂಗ್ ಇದೆಯೇ? => ₹599|599
Do you sell green tea?`;

export function Simulations() {
  const { me } = useSession();
  const { data, loading, reload } = useApi<any[]>('/api/simulations');
  const [open, setOpen] = useState(false);
  useEvents({ 'simulation.progress': (d) => d.finished && void reload() });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Simulations</h1>
          <p>Batch-test the AI on real questions before going live. A case passes if the AI answers without escalating (and contains the expected text, if given).</p>
        </div>
        {canAdmin(me) && <button className="btn primary" onClick={() => setOpen(true)}>New simulation</button>}
      </div>
      <div className="card">
        {loading && !data ? (
          <Loading />
        ) : data?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Status</th><th>Pass rate</th><th>Cases</th><th>Created</th></tr></thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id}>
                    <td><Link to={`/app/simulations/${s.id}`}><strong>{s.name}</strong></Link></td>
                    <td><StatusBadge status={s.status} /></td>
                    <td>
                      <div className="row" style={{ minWidth: 140 }}>
                        <div className="meter grow"><div style={{ width: `${(s.pass_rate ?? (s.total ? s.passed / s.total : 0)) * 100}%`, background: (s.pass_rate ?? 0) >= 0.8 ? 'var(--ok)' : 'var(--warn)' }} /></div>
                        <strong>{s.pass_rate != null ? pct(s.pass_rate) : `${s.passed}/${s.total}`}</strong>
                      </div>
                    </td>
                    <td>{s.total}</td>
                    <td className="small muted">{ago(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="🧪" title="No simulations yet">
            <span className="small">Paste the questions your customers ask most and see how the AI does.</span>
          </Empty>
        )}
      </div>
      {open && <NewSimulation onClose={() => setOpen(false)} />}
    </div>
  );
}

function NewSimulation({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [questions, setQuestions] = useState(sample);
  const [generate, setGenerate] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/api/simulations', { body: { name: name || undefined, questions: generate ? undefined : questions, generate: generate || undefined } });
      nav(`/app/simulations/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title="New simulation" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Starting…' : 'Run simulation'}</button></>}>
      <ErrorBox error={error} />
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pre-launch check" /></Field>
      <div className="tabs">
        <button className={!generate ? 'active' : ''} onClick={() => setGenerate(0)}>Paste questions</button>
        <button className={generate ? 'active' : ''} onClick={() => setGenerate(20)}>Generate from knowledge</button>
      </div>
      {generate ? (
        <Field label="How many questions?" hint="Uses your model to write realistic questions from your knowledge base (falls back to your FAQ questions).">
          <input className="input" type="number" min={1} max={100} value={generate} onChange={(e) => setGenerate(Number(e.target.value))} />
        </Field>
      ) : (
        <Field label="Questions (one per line)" hint={<>Optionally add <code>=&gt; expected text</code>. Use <code>a|b</code> for alternatives and <code>a, b</code> for all-of.</>}>
          <textarea className="textarea" style={{ minHeight: 200 }} value={questions} onChange={(e) => setQuestions(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}

export function SimulationDetail() {
  const { id } = useParams();
  const { data, error, reload } = useApi<any>(`/api/simulations/${id}`);
  const [filter, setFilter] = useState<'all' | 'failed'>('all');
  useEvents({ 'simulation.progress': (d) => d.id === id && void reload() });
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading />;
  const s = data.simulation;
  const cases = data.cases.filter((c: any) => filter === 'all' || c.passed === false);
  const done = data.cases.filter((c: any) => c.passed !== null).length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/app/simulations" className="small">← Simulations</Link>
          <h1>{s.name}</h1>
          <p>{s.status === 'done' ? `Finished ${ago(s.finished_at)}` : `Running… ${done}/${s.total}`}</p>
        </div>
        <div className="card stat" style={{ minWidth: 180 }}>
          <div className="label">Pass rate</div>
          <div className="value" style={{ color: (s.pass_rate ?? 0) >= 0.8 ? 'var(--ok)' : 'var(--warn)' }}>{s.pass_rate != null ? pct(s.pass_rate) : '…'}</div>
          <div className="sub">{s.passed} of {s.total} passed</div>
        </div>
      </div>
      <div className="tabs">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All cases</button>
        <button className={filter === 'failed' ? 'active' : ''} onClick={() => setFilter('failed')}>Failed only</button>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th style={{ width: '28%' }}>Question</th><th>AI answer</th><th style={{ width: 150 }}>Result</th></tr></thead>
          <tbody>
            {cases.map((c: any) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.question}</strong>
                  {c.expected && <div className="small muted">expects: {c.expected}</div>}
                </td>
                <td className="small" style={{ whiteSpace: 'pre-wrap' }}>
                  {c.answer ?? <span className="muted">pending…</span>}
                  {c.citations?.length > 0 && <div className="meta-line">{c.citations.map((x: any) => <span key={x.n} className="badge">{x.title}</span>)}</div>}
                </td>
                <td>
                  {c.passed == null ? <span className="badge">…</span> : c.passed ? <span className="badge ok">✓ Pass</span> : <span className="badge bad">✗ Fail</span>}
                  {c.confidence != null && <div className="small muted">{Math.round(c.confidence * 100)}% sure</div>}
                  {c.reason && <div className="small muted">{c.reason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.status === 'done' && (s.pass_rate ?? 0) < 0.8 && (
        <div className="card pad small">
          💡 To raise the pass rate: add the missing answers on the <Link to="/app/knowledge">Knowledge</Link> page (FAQ <code>Q:/A:</code> pairs work best), or lower the confidence threshold in <Link to="/app/settings">Settings</Link>.
        </div>
      )}
    </div>
  );
}
