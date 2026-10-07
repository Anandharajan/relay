import { useState, type FormEvent } from 'react';
import { ago, api, timeAgo, useApi, useEvents } from '../lib/api';
import { canAdmin, useSession } from '../lib/session';
import { Empty, ErrorBox, Field, Loading, Modal, StatusBadge, useToast } from '../components/ui';

const typeIcon: Record<string, string> = { url: '🌐', file: '📄', faq: '❓', learned: '🧠' };

export function Knowledge() {
  const { me } = useSession();
  const toast = useToast();
  const { data, loading, reload, setData } = useApi<any[]>('/api/knowledge');
  const [adding, setAdding] = useState<'url' | 'file' | 'faq' | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const admin = canAdmin(me);

  useEvents({
    'knowledge.updated': (d) => {
      setData((cur) => cur?.map((s) => (s.id === d.id ? { ...s, status: d.status, error: d.error, chunk_count: d.chunk_count ?? s.chunk_count } : s)) ?? cur);
      if (d.status === 'ready' || d.status === 'error') void reload();
    },
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Knowledge</h1>
          <p>Everything the AI is allowed to answer from. Answers always cite these sources.</p>
        </div>
        {admin && (
          <div className="row wrap">
            <button className="btn primary" onClick={() => setAdding('url')}>🌐 Add website</button>
            <button className="btn" onClick={() => setAdding('file')}>📄 Upload file</button>
            <button className="btn" onClick={() => setAdding('faq')}>❓ Paste FAQ</button>
          </div>
        )}
      </div>

      <div className="card">
        {loading && !data ? (
          <Loading />
        ) : data?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Source</th><th>Status</th><th>Chunks</th><th>Synced</th><th></th></tr>
              </thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="row" style={{ alignItems: 'flex-start' }}>
                        <span>{typeIcon[s.type]}</span>
                        <div className="grow">
                          <button className="btn ghost sm" style={{ padding: 0, height: 'auto', fontWeight: 600 }} onClick={() => setViewing(s)}>{s.title}</button>
                          {s.uri && s.uri !== s.title && <div className="small muted">{s.uri}</div>}
                          {s.error && <div className="small" style={{ color: 'var(--bad)' }}>{s.error}</div>}
                        </div>
                      </div>
                    </td>
                    <td><StatusBadge status={s.status} /></td>
                    <td>{s.chunk_count}</td>
                    <td className="small muted">{s.last_synced_at ? `${ago(s.last_synced_at)}` : '—'}</td>
                    <td>
                      {admin && (
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          {s.type !== 'learned' && (
                            <button className="btn sm" onClick={async () => { await api(`/api/knowledge/${s.id}/resync`, { body: {} }); toast('Re-sync queued'); void reload(); }}>Re-sync</button>
                          )}
                          <button
                            className="btn sm danger"
                            onClick={async () => {
                              if (!confirm(`Delete "${s.title}" and its ${s.chunk_count} chunks?`)) return;
                              await api(`/api/knowledge/${s.id}`, { method: 'DELETE' });
                              void reload();
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="📚" title="No knowledge yet">
            <span className="small">Add your help center URL, upload a PDF, or paste your FAQs to get started.</span>
          </Empty>
        )}
      </div>

      <Playground />

      {adding && <AddSource kind={adding} onClose={() => setAdding(null)} onAdded={() => { setAdding(null); void reload(); toast('Source added — ingesting in the background'); }} />}
      {viewing && <Chunks source={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function AddSource({ kind, onClose, onAdded }: { kind: 'url' | 'file' | 'faq'; onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState('');
  const [crawl, setCrawl] = useState(true);
  const [maxPages, setMaxPages] = useState(25);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (kind === 'url') await api('/api/knowledge/url', { body: { url, crawl, maxPages } });
      if (kind === 'faq') await api('/api/knowledge/faq', { body: { title, content } });
      if (kind === 'file') {
        if (!file) throw new Error('Choose a file');
        const form = new FormData();
        form.append('file', file);
        await api('/api/knowledge/file', { form });
      }
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const titles = { url: 'Add a website', file: 'Upload a document', faq: 'Paste FAQs or policies' };
  return (
    <Modal
      title={titles[kind]}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Adding…' : 'Add source'}</button>
        </>
      }
    >
      <ErrorBox error={error} />
      {kind === 'url' && (
        <form onSubmit={submit} className="stack">
          <Field label="URL" hint="Your help center, FAQ page or docs site.">
            <input className="input" type="url" placeholder="https://help.yourstore.in" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus required />
          </Field>
          <label className="check"><input type="checkbox" checked={crawl} onChange={(e) => setCrawl(e.target.checked)} /> Crawl linked pages on the same site</label>
          {crawl && (
            <Field label="Max pages">
              <input className="input" type="number" min={1} max={200} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} />
            </Field>
          )}
        </form>
      )}
      {kind === 'file' && (
        <Field label="File" hint="PDF, DOCX, TXT, Markdown, CSV or HTML — up to 20 MB.">
          <input className="input" type="file" accept=".pdf,.docx,.txt,.md,.markdown,.csv,.html,.htm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ paddingTop: 7 }} />
        </Field>
      )}
      {kind === 'faq' && (
        <>
          <Field label="Title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shipping policy" autoFocus />
          </Field>
          <Field label="Content" hint={<>Tip: write pairs as <code>Q: …</code> / <code>A: …</code> (also <code>प्रश्न:</code>/<code>उत्तर:</code>, <code>ಪ್ರಶ್ನೆ:</code>/<code>ಉತ್ತರ:</code>) for the most precise answers.</>}>
            <textarea className="textarea" style={{ minHeight: 220 }} value={content} onChange={(e) => setContent(e.target.value)} placeholder={'Q: How long does delivery take?\nA: 2-3 business days in metro cities.'} />
          </Field>
        </>
      )}
    </Modal>
  );
}

function Chunks({ source, onClose }: { source: any; onClose: () => void }) {
  const { data, loading, reload } = useApi<any[]>(`/api/knowledge/${source.id}/chunks`);
  const { me } = useSession();
  return (
    <Modal title={source.title} onClose={onClose}>
      {loading && !data ? (
        <Loading />
      ) : data?.length ? (
        data.map((c) => (
          <div key={c.id} className="card pad stack" style={{ gap: 6, boxShadow: 'none' }}>
            <div className="row between">
              <strong className="small">{c.title || `Chunk ${c.position + 1}`}</strong>
              <span className="row" style={{ gap: 6 }}>
                <span className="badge">{c.lang}</span>
                {canAdmin(me) && (
                  <button className="btn sm ghost danger" onClick={async () => { await api(`/api/knowledge/${source.id}/chunks/${c.id}`, { method: 'DELETE' }); void reload(); }}>Remove</button>
                )}
              </span>
            </div>
            <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{c.content}</p>
            {c.url && <a className="small" href={c.url} target="_blank" rel="noreferrer">{c.url}</a>}
          </div>
        ))
      ) : (
        <p className="muted">No chunks yet.</p>
      )}
    </Modal>
  );
}

function Playground() {
  const [q, setQ] = useState('');
  const [out, setOut] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setOut(await api('/api/knowledge/ask', { body: { question: q } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const tone = out?.kind === 'handoff' ? 'warn' : 'ok';
  return (
    <div className="card pad stack">
      <div>
        <h2>Ask your AI</h2>
        <p className="muted small">Test any question in any language. Nothing is sent to customers.</p>
      </div>
      <form className="row" onSubmit={ask}>
        <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. रिफंड में कितना समय लगता है?" />
        <button className="btn primary" disabled={busy}>{busy ? 'Thinking…' : 'Ask'}</button>
      </form>
      <ErrorBox error={error} />
      {out && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className={`badge ${tone}`}>{out.kind}</span>
            <span className="badge">{Math.round(out.confidence * 100)}% confident</span>
            <span className="badge">{out.lang}</span>
            <span className="badge">{out.engine}</span>
            {out.reason && <span className="badge warn">{out.reason}</span>}
            {out.costInr > 0 && <span className="badge">₹{out.costInr.toFixed(3)}</span>}
          </div>
          <div className="card pad" style={{ boxShadow: 'none', background: 'var(--surface-2)', whiteSpace: 'pre-wrap' }}>{out.text}</div>
          {out.suggestion && (
            <div className="small">
              <strong>Suggested draft for the human (below threshold):</strong>
              <p className="muted">{out.suggestion.text}</p>
            </div>
          )}
          {out.citations?.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              {out.citations.map((c: any) => (
                <div key={c.n} className="small"><span className="badge brand">[{c.n}] {c.title}</span> <span className="muted">{c.snippet}</span></div>
              ))}
            </div>
          )}
          {out.redactedQuestion !== q && (
            <p className="small muted">🔐 Sent to the model as: <code>{out.redactedQuestion}</code></p>
          )}
        </div>
      )}
    </div>
  );
}
