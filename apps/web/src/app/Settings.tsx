import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ago, api, inr, timeAgo, useApi } from '../lib/api';
import { canAdmin, useSession } from '../lib/session';
import { CopyButton, ErrorBox, Field, Loading, useToast } from '../components/ui';

const tabs = [
  { id: 'general', label: 'General' },
  { id: 'install', label: 'Install' },
  { id: 'model', label: 'Model & BYOK' },
  { id: 'channels', label: 'Channels' },
  { id: 'team', label: 'Team' },
  { id: 'billing', label: 'Billing' },
  { id: 'privacy', label: 'Privacy & audit' },
];

export function Settings() {
  const { tab = 'general' } = useParams();
  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <div className="tabs">
        {tabs.map((t) => (
          <Link key={t.id} to={`/app/settings/${t.id}`} className={tab === t.id ? 'active' : ''}>{t.label}</Link>
        ))}
      </div>
      {tab === 'general' && <General />}
      {tab === 'install' && <Install />}
      {tab === 'model' && <Model />}
      {tab === 'channels' && <Channels />}
      {tab === 'team' && <Team />}
      {tab === 'billing' && <Billing />}
      {tab === 'privacy' && <Privacy />}
    </div>
  );
}

function General() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const [s, setS] = useState(() => ({ name: me!.org.name, ...me!.org.settings, origins: me!.org.settings.allowedOrigins.join('\n') }));
  const [error, setError] = useState<string | null>(null);
  const admin = canAdmin(me);
  const save = async () => {
    setError(null);
    try {
      const { origins, whatsapp: _w, ...rest } = s;
      await api('/api/workspace/settings', { method: 'PATCH', body: { ...rest, allowedOrigins: origins.split('\n').map((o) => o.trim()).filter(Boolean) } });
      await refresh();
      toast('Settings saved');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const set = (k: string, v: unknown) => setS({ ...s, [k]: v });
  return (
    <div className="card pad stack lg" style={{ maxWidth: 720 }}>
      <ErrorBox error={error} />
      <div className="grid2">
        <Field label="Business name"><input className="input" value={s.name} onChange={(e) => set('name', e.target.value)} disabled={!admin} /></Field>
        <Field label="Assistant name"><input className="input" value={s.botName} onChange={(e) => set('botName', e.target.value)} disabled={!admin} /></Field>
      </div>
      <Field label="Greeting"><input className="input" value={s.greeting} onChange={(e) => set('greeting', e.target.value)} disabled={!admin} /></Field>
      <Field label="Brand color">
        <div className="row"><input type="color" value={s.brandColor} onChange={(e) => set('brandColor', e.target.value)} disabled={!admin} style={{ width: 48, height: 36, border: 0, background: 'none' }} /><code>{s.brandColor}</code></div>
      </Field>
      <hr style={{ margin: 0 }} />
      <Field label="Answer mode">
        <select className="select" value={s.mode} onChange={(e) => set('mode', e.target.value)} disabled={!admin}>
          <option value="auto">Auto — AI replies when confident, escalates otherwise</option>
          <option value="draft">Draft — AI drafts every reply, a human approves (great for the first week)</option>
        </select>
      </Field>
      <Field label={`Confidence threshold: ${Math.round(s.confidenceThreshold * 100)}%`} hint="Below this, the AI hands off to your team with a suggested draft instead of answering.">
        <input type="range" min={0.1} max={0.95} step={0.05} value={s.confidenceThreshold} onChange={(e) => set('confidenceThreshold', Number(e.target.value))} disabled={!admin} />
      </Field>
      <div className="grid2">
        <Field label="Auto-resolve after (minutes idle)" hint="AI-answered chats with no reply count as resolved.">
          <input className="input" type="number" min={5} value={s.idleResolveMinutes} onChange={(e) => set('idleResolveMinutes', Number(e.target.value))} disabled={!admin} />
        </Field>
        <Field label="Data retention (days)" hint="Conversations older than this are deleted (DPDP).">
          <input className="input" type="number" min={1} value={s.retentionDays} onChange={(e) => set('retentionDays', Number(e.target.value))} disabled={!admin} />
        </Field>
      </div>
      <Field label="Consent notice shown in the widget"><textarea className="textarea" value={s.consentText} onChange={(e) => set('consentText', e.target.value)} disabled={!admin} /></Field>
      <Field label="Allowed website origins" hint="One per line, e.g. https://yourstore.in or *.yourstore.in. Leave empty to allow any site.">
        <textarea className="textarea" value={s.origins} onChange={(e) => set('origins', e.target.value)} disabled={!admin} />
      </Field>
      {admin && <div><button className="btn primary" onClick={save}>Save changes</button></div>}
    </div>
  );
}

function Install() {
  const { me } = useSession();
  const snippet = `<script src="${location.origin}/widget.js" data-site-key="${me!.org.siteKey}" async></script>`;
  return (
    <div className="stack lg" style={{ maxWidth: 760 }}>
      <div className="card pad stack">
        <h2>Web chat widget</h2>
        <p className="muted">Paste this before <code>&lt;/body&gt;</code> on every page. ~12 KB, loads async, isolated in Shadow DOM so it never clashes with your CSS.</p>
        <pre>{snippet}</pre>
        <div className="row"><CopyButton text={snippet} label="Copy snippet" /><a className="btn sm" href="/demo" target="_blank" rel="noreferrer">See it on the demo store ↗</a></div>
        <p className="small muted">Options: <code>data-open="true"</code> opens on load, <code>data-position="left"</code>. JS API: <code>Relay.open()</code>, <code>Relay.close()</code>.</p>
      </div>
      <div className="card pad stack">
        <h3>Shopify, WordPress, Wix</h3>
        <p className="small muted">Shopify: Online Store → Themes → Edit code → <code>theme.liquid</code> → paste before <code>&lt;/body&gt;</code>. WordPress: use any “insert headers and footers” plugin. Wix: Settings → Custom code → Body end.</p>
      </div>
    </div>
  );
}

function Model() {
  const { me } = useSession();
  const toast = useToast();
  const { data, reload } = useApi<any>('/api/workspace/model');
  const [form, setForm] = useState<any>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (data) setForm({ provider: data.provider, model: data.model ?? '', baseUrl: data.baseUrl ?? '', apiKey: '', monthlyBudgetInr: data.monthlyBudgetInr ?? '' });
  }, [data]);
  if (!data || !form) return <Loading />;
  const provider = data.providers.find((p: any) => p.id === form.provider);
  const admin = canAdmin(me);
  const save = async () => {
    setError(null);
    try {
      await api('/api/workspace/model', { method: 'PUT', body: { ...form, apiKey: form.apiKey || null, monthlyBudgetInr: form.monthlyBudgetInr === '' ? null : Number(form.monthlyBudgetInr), baseUrl: form.baseUrl || null, model: form.model || null } });
      toast('Model settings saved');
      setTest(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card pad stack lg" style={{ maxWidth: 720 }}>
      <div>
        <h2>Answer model</h2>
        <p className="muted small">Bring your own key and pay your provider directly — Relay never marks up tokens. Keys are encrypted (AES-256-GCM) and never shown again.</p>
      </div>
      <ErrorBox error={error} />
      <Field label="Provider">
        <select className="select" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value, model: '', baseUrl: '' })} disabled={!admin}>
          {data.providers.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Field>
      {form.provider === 'default' && <p className="small muted">Platform default on this server: <strong>{data.platformDefault}</strong></p>}
      {form.provider === 'extractive' && <p className="small muted">No LLM: answers are extracted verbatim from your knowledge base, with citations. Free, offline, zero hallucination — but it can't rephrase or translate.</p>}
      {!['default', 'extractive'].includes(form.provider) && (
        <>
          <Field label="Model" hint={provider?.model ? `Default: ${provider.model}` : undefined}>
            <input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={provider?.model ?? ''} disabled={!admin} />
          </Field>
          {['ollama', 'openai-compatible'].includes(form.provider) && (
            <Field label="Base URL" hint="OpenAI-compatible endpoint, e.g. http://localhost:11434/v1 for Ollama or your LiteLLM proxy.">
              <input className="input" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} disabled={!admin} />
            </Field>
          )}
          <Field label="API key" hint={data.keyHint && data.provider === form.provider ? `Saved key: ${data.keyHint} — leave blank to keep it.` : provider?.needsKey ? 'Required.' : 'Optional.'}>
            <input className="input" type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} disabled={!admin} />
          </Field>
        </>
      )}
      <Field label="Monthly budget cap (₹)" hint="When reached, Relay falls back to the free extractive engine until next month. Leave empty for no cap.">
        <input className="input" type="number" min={0} value={form.monthlyBudgetInr} onChange={(e) => setForm({ ...form, monthlyBudgetInr: e.target.value })} disabled={!admin} />
      </Field>
      {admin && (
        <div className="row">
          <button className="btn primary" onClick={save}>Save</button>
          <button className="btn" onClick={async () => setTest(await api('/api/workspace/model/test', { body: {} }))}>Test connection</button>
        </div>
      )}
      {test && <div className={test.ok ? 'ok-box' : 'error-box'}>{test.message}</div>}
      <p className="small muted">🔐 Customer PII (phone, email, Aadhaar, PAN, card, UPI) is replaced with placeholders before any text reaches the model, and restored in the reply.</p>
    </div>
  );
}

function Channels() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const wa = me!.org.settings.whatsapp ?? {};
  const [phoneNumberId, setPhone] = useState(wa.phoneNumberId ?? '');
  const [accessToken, setToken] = useState('');
  const [enabled, setEnabled] = useState(wa.enabled ?? true);
  const [result, setResult] = useState<{ webhookUrl: string; verifyToken: string } | null>(wa.verifyToken ? { webhookUrl: `${location.origin}/webhooks/whatsapp`, verifyToken: wa.verifyToken } : null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      setResult(await api('/api/workspace/channels/whatsapp', { method: 'PUT', body: { phoneNumberId, accessToken: accessToken || undefined, enabled } }));
      setToken('');
      await refresh();
      toast('WhatsApp settings saved');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="stack lg" style={{ maxWidth: 760 }}>
      <div className="card pad stack">
        <div className="row between">
          <h2>🟢 WhatsApp (Cloud API)</h2>
          <span className={`badge ${me!.org.whatsappConnected ? 'ok' : ''}`}>{me!.org.whatsappConnected ? 'Token saved' : 'Not connected'}</span>
        </div>
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Create an app at developers.facebook.com and add the WhatsApp product.</li>
          <li>Copy the <strong>Phone number ID</strong> and a <strong>permanent access token</strong> (System User) below.</li>
          <li>In WhatsApp → Configuration, set the webhook URL and verify token shown after saving, and subscribe to <code>messages</code>.</li>
        </ol>
        <ErrorBox error={error} />
        <Field label="Phone number ID"><input className="input" value={phoneNumberId} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Access token" hint="Stored encrypted. Leave blank to keep the saved token."><input className="input" type="password" value={accessToken} onChange={(e) => setToken(e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Let the AI answer WhatsApp messages</label>
        {canAdmin(me) && <div><button className="btn primary" onClick={save}>Save</button></div>}
        {result && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row between"><span className="small">Webhook URL: <code>{result.webhookUrl}</code></span><CopyButton text={result.webhookUrl} /></div>
            <div className="row between"><span className="small">Verify token: <code>{result.verifyToken}</code></span><CopyButton text={result.verifyToken} /></div>
            <p className="small muted">Set <code>WHATSAPP_APP_SECRET</code> on the server to verify webhook signatures.</p>
          </div>
        )}
      </div>
      <div className="card pad stack">
        <h3>✉️ Email · 📞 Voice · 🤖 Agent endpoint (MCP)</h3>
        <p className="small muted">On the roadmap (Phase 2/3). The answer pipeline is channel-agnostic, so new channels plug into the same inbox.</p>
      </div>
    </div>
  );
}

function Team() {
  const { me } = useSession();
  const toast = useToast();
  const { data, reload } = useApi<any>('/api/workspace/team');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('agent');
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data) return <Loading />;
  const admin = canAdmin(me);
  return (
    <div className="stack lg" style={{ maxWidth: 820 }}>
      {admin && (
        <div className="card pad stack">
          <h2>Invite a teammate</h2>
          <ErrorBox error={error} />
          <div className="row wrap">
            <input className="input grow" type="email" placeholder="teammate@yourstore.in" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className="select" style={{ width: 120 }} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
            <button
              className="btn primary"
              onClick={async () => {
                setError(null);
                try {
                  const r = await api('/api/workspace/team/invites', { body: { email, role } });
                  setLink(r.url);
                  setEmail('');
                  void reload();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Create invite link
            </button>
          </div>
          {link && <div className="row between ok-box"><span className="small" style={{ overflowWrap: 'anywhere' }}>{link}</span><CopyButton text={link} /></div>}
          <p className="small muted">Share the link with your teammate (e.g. on WhatsApp). It works once.</p>
        </div>
      )}
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Member</th><th>Role</th><th>Joined</th><th></th></tr></thead>
          <tbody>
            {data.members.map((m: any) => (
              <tr key={m.id}>
                <td><strong>{m.name}</strong><div className="small muted">{m.email}</div></td>
                <td>
                  {me!.role === 'owner' && m.id !== me!.user.id ? (
                    <select className="select" style={{ width: 110, height: 30 }} value={m.role} onChange={async (e) => { await api(`/api/workspace/team/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }); void reload(); }}>
                      <option value="owner">Owner</option><option value="admin">Admin</option><option value="agent">Agent</option>
                    </select>
                  ) : <span className="badge">{m.role}</span>}
                </td>
                <td className="small muted">{ago(m.created_at)}</td>
                <td>{admin && m.id !== me!.user.id && <button className="btn sm danger" onClick={async () => { if (confirm(`Remove ${m.name}?`)) { await api(`/api/workspace/team/${m.id}`, { method: 'DELETE' }); toast('Removed'); void reload(); } }}>Remove</button>}</td>
              </tr>
            ))}
            {data.invites.map((i: any) => (
              <tr key={i.token}>
                <td><span className="muted">{i.email}</span><div className="small muted">invite pending</div></td>
                <td><span className="badge">{i.role}</span></td>
                <td className="small muted">{ago(i.created_at)}</td>
                <td>{admin && <div className="row"><CopyButton text={i.url} label="Copy link" /><button className="btn sm" onClick={async () => { await api(`/api/workspace/team/invites/${i.token}`, { method: 'DELETE' }); void reload(); }}>Revoke</button></div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    Razorpay?: any;
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay checkout'));
    document.body.appendChild(s);
  });
}

function Billing() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const { data } = useApi<any>('/api/billing');
  const [error, setError] = useState<string | null>(null);
  if (!data) return <Loading />;
  const plan = data.plans[data.plan] ?? data.plans.free;
  const subscribe = async (planId: string) => {
    setError(null);
    try {
      const r = await api('/api/billing/subscribe', { body: { plan: planId } });
      await loadRazorpay();
      new window.Razorpay({
        key: r.keyId,
        subscription_id: r.subscriptionId,
        name: 'Relay',
        description: `${data.plans[planId].label} plan for ${r.orgName}`,
        prefill: r.prefill,
        theme: { color: '#4f46e5' },
        handler: async () => {
          toast('Payment received — your plan updates in a few seconds');
          window.setTimeout(() => void refresh(), 4000);
        },
      }).open();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="stack lg" style={{ maxWidth: 860 }}>
      {data.mode === 'selfhost' && (
        <div className="ok-box">You're self-hosting Relay: every feature is unlocked and there are no usage limits. Billing only applies to Relay Cloud.</div>
      )}
      <ErrorBox error={error} />
      <div className="card pad stack">
        <div className="row between">
          <div>
            <h2>Current plan: {plan.label}</h2>
            <p className="small muted">{data.subscription ? `Subscription ${data.subscription.status}${data.subscription.current_period_end ? ` · renews ${new Date(data.subscription.current_period_end).toLocaleDateString('en-IN')}` : ''}` : 'No active subscription'}</p>
          </div>
          <span className="badge brand">{inr(plan.priceInr)}/mo</span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <div className="row between small"><span>AI conversations this month</span><strong>{data.usage.conversations} / {plan.aiConversations.toLocaleString('en-IN')}</strong></div>
          <div className="meter"><div style={{ width: `${Math.min(100, (data.usage.conversations / plan.aiConversations) * 100)}%` }} /></div>
          <p className="small muted">BYOK conversations don't count toward the limit. Model spend this month: {inr(data.usage.cost_inr, 2)}.</p>
        </div>
      </div>
      <div className="grid2">
        {(['starter', 'growth'] as const).map((id) => {
          const p = data.plans[id];
          return (
            <div key={id} className={`card price ${data.plan === id ? 'featured' : ''}`}>
              <h3>{p.label}</h3>
              <div><span className="amount">{inr(p.priceInr)}</span> <span className="muted">/month</span></div>
              <ul>
                <li>{p.aiConversations.toLocaleString('en-IN')} AI conversations</li>
                <li>{p.seats} seats</li>
                <li>Actions, simulations, WhatsApp</li>
                <li>UPI Autopay or card</li>
              </ul>
              {me!.role === 'owner' && data.enabled && data.plan !== id && <button className="btn primary" onClick={() => subscribe(id)}>Upgrade with Razorpay</button>}
              {!data.enabled && <span className="small muted">Billing isn't configured on this server.</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Privacy() {
  const { me } = useSession();
  const toast = useToast();
  const audit = useApi<any[]>(canAdmin(me) ? '/api/workspace/audit' : null);
  const [visitor, setVisitor] = useState('');
  if (!canAdmin(me)) return <p className="muted">Only admins can manage privacy requests.</p>;
  return (
    <div className="stack lg">
      <div className="card pad stack" style={{ maxWidth: 760 }}>
        <h2>Data principal requests (DPDP Act)</h2>
        <p className="small muted">Export or erase everything stored about a customer. Use their visitor ID (shown in the inbox) or WhatsApp number.</p>
        <div className="row wrap">
          <input className="input grow" value={visitor} onChange={(e) => setVisitor(e.target.value)} placeholder="v_ab12… or +9198…" />
          <a className={`btn ${visitor ? '' : 'disabled'}`} href={visitor ? `/api/workspace/privacy/export?visitor=${encodeURIComponent(visitor)}` : undefined}>Export JSON</a>
          <button
            className="btn danger"
            disabled={!visitor}
            onClick={async () => {
              if (!confirm(`Permanently erase all conversations for ${visitor}?`)) return;
              const r = await api('/api/workspace/privacy/erase', { body: { visitor } });
              toast(`Erased ${r.deleted} conversation(s)`);
              setVisitor('');
              void audit.reload();
            }}
          >
            Erase
          </button>
        </div>
        <p className="small muted">Retention is set in General settings: conversations older than {me!.org.settings.retentionDays} days are purged automatically.</p>
      </div>
      <div className="card">
        <div className="pad" style={{ padding: '16px 18px 0' }}><h2>Audit log</h2><p className="small muted">Every configuration change, sensitive action and privacy request.</p></div>
        {audit.data ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>
                {audit.data.map((a) => (
                  <tr key={a.id}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleString('en-IN')}</td>
                    <td className="small">{a.actor_name}</td>
                    <td><code>{a.action}</code></td>
                    <td className="small muted" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{Object.keys(a.payload ?? {}).length ? JSON.stringify(a.payload) : a.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Loading />}
      </div>
    </div>
  );
}
