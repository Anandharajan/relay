import { useState } from 'react';
import { ago, api, timeAgo, useApi } from '../lib/api';
import { canAdmin, useSession } from '../lib/session';
import { Empty, ErrorBox, Field, Loading, Modal, StatusBadge, useToast } from '../components/ui';

interface Param {
  name: string;
  description: string;
  required: boolean;
  pattern?: string;
}

const blank = {
  name: '',
  description: '',
  keywords: [] as string[],
  method: 'GET',
  url: '',
  headers: undefined as Record<string, string> | undefined,
  params: [] as Param[],
  bodyTemplate: '',
  responseTemplate: '',
  sensitive: false,
  enabled: true,
};

export function Actions() {
  const { me } = useSession();
  const toast = useToast();
  const { data, loading, reload } = useApi<any[]>('/api/actions');
  const [editing, setEditing] = useState<any | null>(null);
  const [testing, setTesting] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);
  const drift = useApi<{ schemaV2: boolean }>(me?.org.name === 'Kaapi & Co.' ? '/api/demo/drift' : null);
  const admin = canAdmin(me);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Actions</h1>
          <p>Let the AI call your APIs — order status, cancellations, refunds. Sensitive actions always wait for a human to verify.</p>
        </div>
        {admin && (
          <div className="row">
            <button className="btn" onClick={() => setImporting(true)}>Import OpenAPI</button>
            <button className="btn primary" onClick={() => setEditing({ ...blank })}>New action</button>
          </div>
        )}
      </div>

      {drift.data && admin && (
        <div className="card pad row between wrap">
          <div>
            <strong>🩹 Demo: self-healing Actions</strong>
            <p className="small muted">Make the demo store's order API change its response shape, then test “Order status” — Relay detects the drift and proposes a fix.</p>
          </div>
          <button
            className="btn"
            onClick={async () => {
              await api('/api/demo/drift', { body: { on: !drift.data!.schemaV2 } });
              await drift.reload();
              toast(drift.data!.schemaV2 ? 'Store API restored to v1' : 'Store API switched to v2 — try testing “Order status”');
            }}
          >
            {drift.data.schemaV2 ? 'Restore API v1' : 'Simulate API change (v2)'}
          </button>
        </div>
      )}

      {loading && !data ? (
        <Loading />
      ) : data?.length ? (
        <div className="grid2">
          {data.map((a) => (
            <div key={a.id} className="card pad stack" style={{ gap: 8 }}>
              <div className="row between">
                <strong>⚡ {a.name}</strong>
                <div className="row" style={{ gap: 6 }}>
                  {a.sensitive && <span className="badge warn">🔐 human verifies</span>}
                  {!a.enabled && <span className="badge">disabled</span>}
                  <StatusBadge status={a.health} />
                </div>
              </div>
              <p className="small muted">{a.description}</p>
              <code className="small" style={{ overflowWrap: 'anywhere' }}>{a.method} {a.url}</code>
              {a.last_run_at && <span className="small muted">Last run {ago(a.last_run_at)}</span>}
              {a.health === 'failing' && a.last_error && <div className="error-box small">{a.last_error}</div>}
              {a.drift && <DriftFix action={a} onFixed={reload} />}
              {admin && (
                <div className="row">
                  <button className="btn sm" onClick={() => setTesting(a)}>Test</button>
                  <button className="btn sm" onClick={() => setEditing({ ...a, keywords: a.keywords, bodyTemplate: a.body_template ?? '', responseTemplate: a.response_template, headers: undefined })}>Edit</button>
                  <button className="btn sm danger" onClick={async () => { if (confirm(`Delete "${a.name}"?`)) { await api(`/api/actions/${a.id}`, { method: 'DELETE' }); void reload(); } }}>Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon="⚡" title="No actions yet">
            <span className="small">Connect an order-lookup endpoint so the AI can answer “where is my order?” on its own.</span>
          </Empty>
        </div>
      )}

      {editing && <ActionEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); toast('Action saved'); }} />}
      {testing && <ActionTest action={testing} onClose={() => { setTesting(null); void reload(); }} />}
      {importing && <ImportOpenApi onClose={() => setImporting(false)} onPick={(p) => { setImporting(false); setEditing(p); }} />}
    </div>
  );
}

function DriftFix({ action, onFixed }: { action: any; onFixed: () => void }) {
  const toast = useToast();
  const { missing, proposals } = action.drift as { missing: string[]; proposals: Record<string, string> };
  return (
    <div className="draft" style={{ borderColor: 'var(--warn)' }}>
      <strong className="small">🩹 Your API changed shape</strong>
      <p className="small muted">These fields disappeared from the response: <code>{missing.join(', ')}</code></p>
      {Object.keys(proposals).length ? (
        <>
          <div className="small">
            Proposed mapping:
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
              {Object.entries(proposals).map(([from, to]) => <li key={from}><code>{from}</code> → <code>{to}</code></li>)}
            </ul>
          </div>
          <button className="btn primary sm" onClick={async () => { await api(`/api/actions/${action.id}/heal`, { body: { mapping: proposals } }); toast('Mapping fixed'); onFixed(); }}>Approve fix</button>
        </>
      ) : (
        <p className="small">No confident match found — edit the response template manually.</p>
      )}
    </div>
  );
}

function ActionEditor({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved: () => void }) {
  const [a, setA] = useState({ ...blank, ...initial });
  const [headersText, setHeadersText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setA({ ...a, [k]: v });
  const setParam = (i: number, k: keyof Param, v: unknown) => set('params', a.params.map((p: Param, j: number) => (j === i ? { ...p, [k]: v } : p)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let headers: Record<string, string> | undefined;
      if (headersText.trim()) {
        try {
          headers = JSON.parse(headersText);
        } catch {
          throw new Error('Headers must be a JSON object, e.g. {"Authorization": "Bearer …"}');
        }
      }
      const payload = {
        name: a.name, description: a.description, keywords: a.keywords, method: a.method, url: a.url, params: a.params,
        bodyTemplate: a.bodyTemplate || null, responseTemplate: a.responseTemplate, sensitive: a.sensitive, enabled: a.enabled, ...(headers ? { headers } : {}),
      };
      if (a.id) await api(`/api/actions/${a.id}`, { method: 'PUT', body: payload });
      else await api('/api/actions', { body: payload });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={a.id ? 'Edit action' : 'New action'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <ErrorBox error={error} />
      <Field label="Name"><input className="input" value={a.name} onChange={(e) => set('name', e.target.value)} placeholder="Order status" /></Field>
      <Field label="What it does" hint="The AI reads this to decide when to use the action."><input className="input" value={a.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <Field label="Trigger keywords" hint="Comma-separated. Used to route without an LLM, and as a pre-filter with one."><input className="input" value={a.keywords.join(', ')} onChange={(e) => set('keywords', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} placeholder="order, track, where is my" /></Field>
      <div className="row">
        <select className="select" style={{ width: 110 }} value={a.method} onChange={(e) => set('method', e.target.value)}>
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
        </select>
        <input className="input grow" value={a.url} onChange={(e) => set('url', e.target.value)} placeholder="https://api.yourstore.in/orders/{order_id}" />
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="row between"><strong className="small">Parameters</strong><button className="btn sm" onClick={() => set('params', [...a.params, { name: '', description: '', required: true }])}>+ Add</button></div>
        {a.params.map((p: Param, i: number) => (
          <div key={i} className="row wrap" style={{ gap: 6 }}>
            <input className="input" style={{ width: 120 }} placeholder="order_id" value={p.name} onChange={(e) => setParam(i, 'name', e.target.value)} />
            <input className="input grow" placeholder="what to ask the customer for" value={p.description} onChange={(e) => setParam(i, 'description', e.target.value)} />
            <input className="input" style={{ width: 150 }} placeholder="regex (optional)" value={p.pattern ?? ''} onChange={(e) => setParam(i, 'pattern', e.target.value)} />
            <button className="btn sm ghost" onClick={() => set('params', a.params.filter((_: Param, j: number) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      {a.method !== 'GET' && <Field label="Body template (JSON)" hint="Use {{param}} placeholders."><textarea className="textarea" value={a.bodyTemplate} onChange={(e) => set('bodyTemplate', e.target.value)} /></Field>}
      <Field label="Reply template" hint="What the customer sees. Use {{field.path}} from the JSON response. With an LLM configured, the reply is rewritten naturally in the customer's language.">
        <textarea className="textarea" value={a.responseTemplate} onChange={(e) => set('responseTemplate', e.target.value)} placeholder="Order {{id}} is {{status}}, arriving {{eta}}." />
      </Field>
      <Field label={a.hasHeaders ? 'Headers (stored encrypted — leave blank to keep)' : 'Headers (optional, stored encrypted)'}>
        <input className="input" value={headersText} onChange={(e) => setHeadersText(e.target.value)} placeholder='{"Authorization": "Bearer …"}' />
      </Field>
      <label className="check"><input type="checkbox" checked={a.sensitive} onChange={(e) => set('sensitive', e.target.checked)} /> Sensitive — require a human to verify before running (refunds, cancellations, address changes)</label>
      <label className="check"><input type="checkbox" checked={a.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Enabled</label>
    </Modal>
  );
}

function ActionTest({ action, onClose }: { action: any; onClose: () => void }) {
  const [params, setParams] = useState<Record<string, string>>(Object.fromEntries(action.params.map((p: Param) => [p.name, p.name === 'order_id' ? 'KC-1042' : ''])));
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setResult(await api(`/api/actions/${action.id}/test`, { body: { params } }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Test: ${action.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Running…' : 'Run'}</button></>}>
      {action.sensitive && <div className="error-box small">This is a sensitive action — testing really calls your API.</div>}
      {action.params.map((p: Param) => (
        <Field key={p.name} label={p.name} hint={p.description}>
          <input className="input" value={params[p.name] ?? ''} onChange={(e) => setParams({ ...params, [p.name]: e.target.value })} />
        </Field>
      ))}
      {result && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className={`badge ${result.ok ? 'ok' : 'bad'}`}>{result.ok ? 'OK' : 'Failed'} · HTTP {result.status}</span>
            <span className="badge">{result.latencyMs} ms</span>
            {result.drift && <span className="badge warn">schema drift detected</span>}
          </div>
          {result.rendered && <div className="ok-box">{result.rendered}</div>}
          {result.error && <div className="error-box">{result.error}</div>}
          <pre>{JSON.stringify(result.data, null, 2)}</pre>
        </div>
      )}
    </Modal>
  );
}

function ImportOpenApi({ onClose, onPick }: { onClose: () => void; onPick: (p: any) => void }) {
  const [doc, setDoc] = useState('');
  const [proposals, setProposals] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parse = async () => {
    setError(null);
    try {
      setProposals((await api('/api/actions/import', { body: { openapi: doc } })).proposals);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="Import from OpenAPI" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={parse}>Find endpoints</button></>}>
      <ErrorBox error={error} />
      <Field label="OpenAPI 3 document (JSON)"><textarea className="textarea" style={{ minHeight: 160, fontFamily: 'var(--mono)', fontSize: 12 }} value={doc} onChange={(e) => setDoc(e.target.value)} /></Field>
      {proposals && (proposals.length ? proposals.map((p, i) => (
        <div key={i} className="row between card pad" style={{ boxShadow: 'none' }}>
          <div className="grow"><strong className="small">{p.name}</strong><div className="small muted"><code>{p.method} {p.url}</code></div></div>
          <button className="btn sm" onClick={() => onPick(p)}>Use</button>
        </div>
      )) : <p className="muted">No operations found.</p>)}
    </Modal>
  );
}
