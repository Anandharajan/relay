import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ago, api, inr, timeAgo, useApi } from '../lib/api';
import { canAdmin, useSession } from '../lib/session';
import { CopyButton, ErrorBox, Field, Loading, Modal, useToast } from '../components/ui';
import { terms } from '../lib/terms';

const tabs = [
  { id: 'general', label: 'General' },
  { id: 'staff', label: 'Staff & hours' },
  { id: 'prep', label: 'Prep instructions' },
  { id: 'install', label: 'Install' },
  { id: 'model', label: 'Model & BYOK' },
  { id: 'channels', label: 'Channels' },
  { id: 'team', label: 'Team' },
  { id: 'addons', label: 'Add-ons' },
  { id: 'billing', label: 'Plan & billing' },
  { id: 'privacy', label: 'Privacy & audit' },
];

export function Settings() {
  const { tab: wanted = 'general' } = useParams();
  const { me } = useSession();
  const demo = me?.role === 'viewer';
  const visible = demo ? tabs.filter((t) => ['general', 'staff', 'prep', 'install', 'channels'].includes(t.id)) : tabs;
  const tab = visible.some((t) => t.id === wanted) ? wanted : 'general';
  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <div className="tabs">
        {visible.map((t) => (
          <Link key={t.id} to={`/app/settings/${t.id}`} className={tab === t.id ? 'active' : ''}>{t.label}</Link>
        ))}
      </div>
      {tab === 'general' && <General />}
      {tab === 'staff' && <StaffSettings />}
      {tab === 'prep' && <PrepSettings />}
      {tab === 'install' && <Install />}
      {tab === 'addons' && <Addons />}
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
        <Field label="Type of institution" hint="Healthcare turns on emergency detection, the no-medical-advice rule, health-data masking and the patient/doctor features.">
          <select className="select" value={s.vertical ?? 'general'} onChange={(e) => set('vertical', e.target.value)} disabled={!admin}>
            <option value="healthcare">Clinic / hospital / diagnostics</option>
            <option value="education">School / college / coaching</option>
            <option value="services">Services (salon, repair, legal, finance …)</option>
            <option value="general">Business / other</option>
          </select>
        </Field>
        <Field label="Emergency number" hint="Shown when someone describes an emergency.">
          <input className="input" value={s.emergencyNumber ?? '108'} onChange={(e) => set('emergencyNumber', e.target.value)} disabled={!admin} />
        </Field>
      </div>
      {s.vertical === 'healthcare' && (
        <label className="check"><input type="checkbox" checked={Boolean(s.recordsUseModel)} onChange={(e) => set('recordsUseModel', e.target.checked)} disabled={!admin} /> Let your AI model help read messy reports (sends report text to your configured model provider)</label>
      )}
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
      {data.connected === false && <p className="error-box">The saved provider needs an API key. The assistant is using the extractive fallback until you save a key and test the connection.</p>}
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
  const [template, setTemplate] = useState((wa as any).template ?? 'relay_update');
  const [result, setResult] = useState<{ webhookUrl: string; verifyToken: string } | null>(wa.verifyToken ? { webhookUrl: `${location.origin}/webhooks/whatsapp`, verifyToken: wa.verifyToken } : null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      setResult(await api('/api/workspace/channels/whatsapp', { method: 'PUT', body: { phoneNumberId, accessToken: accessToken || undefined, enabled, template } }));
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
        <Field label="Template for messages outside the 24-hour window" hint={<>Reminders, follow-ups and approved results usually go out later than 24 h after the patient's last message, so WhatsApp requires an approved <strong>Utility</strong> template. Create it in English and Tamil with body: <code>{'Hello {{1}}, an update from {{2}}:\n\n{{3}}\n\nReply here if you have any questions.'}</code></>}>
          <input className="input" value={template} onChange={(e) => setTemplate(e.target.value)} />
        </Field>
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
        <h3>✉️ Email · 🤖 Agent endpoint (MCP)</h3>
        <p className="small muted">On the roadmap. The answer pipeline is channel-agnostic, so new channels plug into the same inbox.</p>
      </div>
      <Voice />
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
    <div className="stack lg" style={{ maxWidth: 980 }}>
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
      <div className="grid3">
        {(['starter', 'growth', 'institution'] as const).map((id) => {
          const p = data.plans[id];
          return (
            <div key={id} className={`card price ${data.plan === id ? 'featured' : ''}`}>
              <h3>{p.label}</h3>
              <div><span className="amount">{inr(p.priceInr)}</span> <span className="muted">/month</span></div>
              <ul>
                <li>{p.aiConversations.toLocaleString('en-IN')} AI conversations</li>
                <li>{p.seats} seats · {p.staff} staff calendars</li>
                <li>Appointments, queue, reminders, follow-ups</li>
                {p.records && <li>Medical records, AI findings, investigations</li>}
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

function StaffSettings() {
  const { me } = useSession();
  const T = terms(me);
  const toast = useToast();
  const list = useApi<any[]>('/api/visits/staff');
  const [edit, setEdit] = useState<any | null>(null);
  const admin = canAdmin(me);
  const team = useApi<{ members: { id: string; name: string; email: string }[] }>(admin ? '/api/workspace/team' : null);
  const members = team.data?.members ?? [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const save = async () => {
    try {
      const body = { name: edit.name, specialty: edit.specialty, avgMinutes: Number(edit.avg_minutes), schedule: edit.schedule, languages: edit.languages ?? [], active: edit.active ?? true, userId: edit.user_id || null };
      if (edit.id) await api(`/api/visits/staff/${edit.id}`, { method: 'PATCH', body });
      else await api('/api/visits/staff', { body });
      setEdit(null);
      await list.reload();
      toast('Saved');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="stack lg" style={{ maxWidth: 860 }}>
      <div className="card">
        <div className="row between" style={{ padding: 14 }}>
          <div><h2>{T.staffs}</h2><p className="small muted">Bookable calendars. Slots are offered on chat, WhatsApp and calls from these hours; the queue learns each person's real pace.</p></div>
          {admin && <button className="btn primary" onClick={() => setEdit({ name: '', specialty: '', avg_minutes: 15, schedule: { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '13:00' } })}>+ Add</button>}
        </div>
        {list.loading ? <Loading /> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Specialty</th><th>Days</th><th>Hours</th><th>Avg</th><th>Login</th><th></th></tr></thead>
            <tbody>
              {(list.data ?? []).map((s) => (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                  <td><strong>{s.name}</strong></td>
                  <td className="small">{s.specialty}</td>
                  <td className="small">{s.schedule.days.map((d: number) => dayNames[d]).join(' ')}</td>
                  <td className="small">{s.schedule.start}–{s.schedule.end}</td>
                  <td className="small">{s.avg_minutes} min</td>
                  <td className="small">{members.find((m) => m.id === s.user_id)?.name ?? (s.user_id ? 'Linked' : <span className="muted">Not linked</span>)}</td>
                  <td>{admin && <button className="btn sm" onClick={() => setEdit(s)}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit' : `Add ${T.staff.toLowerCase()}`} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
          <div className="grid2">
            <Field label="Name"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Specialty / role"><input className="input" value={edit.specialty} onChange={(e) => setEdit({ ...edit, specialty: e.target.value })} /></Field>
            <Field label="Start"><input className="input" type="time" value={edit.schedule.start} onChange={(e) => setEdit({ ...edit, schedule: { ...edit.schedule, start: e.target.value } })} /></Field>
            <Field label="End"><input className="input" type="time" value={edit.schedule.end} onChange={(e) => setEdit({ ...edit, schedule: { ...edit.schedule, end: e.target.value } })} /></Field>
            <Field label="Average minutes per visit"><input className="input" type="number" min={3} value={edit.avg_minutes} onChange={(e) => setEdit({ ...edit, avg_minutes: e.target.value })} /></Field>
          </div>
          <Field label="Working days">
            <div className="row wrap" style={{ gap: 6 }}>
              {dayNames.map((d, i) => (
                <button key={d} type="button" className={`btn sm ${edit.schedule.days.includes(i) ? 'primary' : ''}`} onClick={() => setEdit({ ...edit, schedule: { ...edit.schedule, days: edit.schedule.days.includes(i) ? edit.schedule.days.filter((x: number) => x !== i) : [...edit.schedule.days, i].sort() } })}>{d}</button>
              ))}
            </div>
          </Field>
          {admin && (
            <Field label="Linked login" hint="Bookings and reports for this calendar are routed to this person, who can then approve their own patients’ clinical messages.">
              <select className="select" value={edit.user_id ?? ''} onChange={(e) => setEdit({ ...edit, user_id: e.target.value || null })}>
                <option value="">Not linked</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)}
              </select>
            </Field>
          )}
          {edit.id && <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active (bookable)</label>}
        </Modal>
      )}
    </div>
  );
}

function PrepSettings() {
  const { me } = useSession();
  const toast = useToast();
  const list = useApi<any[]>('/api/visits/protocols');
  const [f, setF] = useState({ title: '', keywords: '', instructions: '', daysBefore: 1 });
  const admin = canAdmin(me);
  const add = async () => {
    try {
      await api('/api/visits/protocols', { body: { title: f.title, keywords: f.keywords.split(',').map((k) => k.trim()).filter(Boolean), instructions: f.instructions, daysBefore: Number(f.daysBefore) } });
      setF({ title: '', keywords: '', instructions: '', daysBefore: 1 });
      await list.reload();
      toast('Approved and active');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="stack lg" style={{ maxWidth: 860 }}>
      <div className="card pad stack">
        <h2>Pre-visit instructions</h2>
        <p className="small muted">Written and approved by your team, sent automatically before matching appointments (by keyword in the reason or specialty). The AI never writes medical instructions itself.</p>
        {(list.data ?? []).map((p) => (
          <div key={p.id} className="outbox-item stack" style={{ gap: 6 }}>
            <div className="row between"><strong>{p.title}</strong>{admin && <button className="btn sm ghost" onClick={() => api(`/api/visits/protocols/${p.id}`, { method: 'DELETE' }).then(() => list.reload())}>Remove</button>}</div>
            <div className="small muted">Matches: {p.keywords.join(', ') || 'all'} · sent {p.days_before} day(s) before · approved by {p.approved_by}</div>
            <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{p.instructions}</div>
          </div>
        ))}
      </div>
      {admin && (
        <div className="card pad stack">
          <h3>Add instructions</h3>
          <div className="grid2">
            <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Fasting blood tests" /></Field>
            <Field label="Match keywords (comma separated)"><input className="input" value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} placeholder="diabet, sugar, lipid" /></Field>
          </div>
          <Field label="Instructions (write in every language your patients use)"><textarea className="textarea" rows={5} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
          <Field label="Send how many days before"><input className="input" type="number" min={0} max={14} value={f.daysBefore} onChange={(e) => setF({ ...f, daysBefore: Number(e.target.value) })} style={{ width: 120 }} /></Field>
          <div><button className="btn primary" disabled={f.title.length < 2 || f.instructions.length < 5} onClick={add}>Approve and activate</button></div>
        </div>
      )}
    </div>
  );
}

function Voice() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const v = me!.org.settings.voice ?? {};
  const [f, setF] = useState({ provider: v.provider ?? 'simulated', from: v.from ?? '', accountSid: v.accountSid ?? '', authToken: '', transferTo: v.transferTo ?? '' });
  const [inbound, setInbound] = useState<string | null>(null);
  const save = async () => {
    try {
      const r = await api('/api/visits/voice', { method: 'PUT', body: { ...f, authToken: f.authToken || undefined } });
      setInbound(r.inboundUrl);
      await refresh();
      toast('Saved');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="card pad stack">
      <div className="row between"><h2>📞 Voice (telecalling add-on)</h2><span className="badge">{f.provider}</span></div>
      <p className="small muted">Simulated works with no account: calls appear in Calls and you answer as the patient. Twilio places real calls with Tamil, Hindi and English speech and keypad answers. Exotel support is planned.</p>
      <div className="grid2">
        <Field label="Provider"><select className="select" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}><option value="simulated">Simulated</option><option value="twilio">Twilio</option><option value="exotel" disabled>Exotel (planned)</option></select></Field>
        <Field label="Caller ID (E.164)"><input className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="+9144xxxxxxx" /></Field>
        <Field label="Account SID"><input className="input" value={f.accountSid} onChange={(e) => setF({ ...f, accountSid: e.target.value })} /></Field>
        <Field label="Auth token" hint="Stored encrypted."><input className="input" type="password" value={f.authToken} onChange={(e) => setF({ ...f, authToken: e.target.value })} /></Field>
        <Field label="Transfer calls to (front desk)"><input className="input" value={f.transferTo} onChange={(e) => setF({ ...f, transferTo: e.target.value })} placeholder="+9144xxxxxxx" /></Field>
      </div>
      {canAdmin(me) && <div><button className="btn primary" onClick={save}>Save</button></div>}
      {inbound && <div className="small">Inbound webhook for your Twilio number: <code>{inbound}</code> <CopyButton text={inbound} /></div>}
    </div>
  );
}

function Addons() {
  const { me } = useSession();
  const toast = useToast();
  const billing = useApi<any>('/api/billing');
  const devices = useApi<any>('/api/visits/edge/devices');
  const [newToken, setNewToken] = useState<{ token: string; apiUrl: string } | null>(null);
  if (!billing.data) return <Loading />;
  const addons = billing.data.addons ?? {};
  const trial = async (k: string) => {
    try {
      await api(`/api/billing/addons/${k}/trial`, { body: {} });
      await billing.reload();
      await devices.reload();
      toast('Trial started');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const addDevice = async () => {
    try {
      setNewToken(await api('/api/visits/edge/devices', { body: { name: `Reception camera ${(devices.data?.devices?.length ?? 0) + 1}` } }));
      await devices.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="stack lg" style={{ maxWidth: 860 }}>
      <div className="grid2">
        {Object.entries(addons).map(([k, a]: [string, any]) => (
          <div key={k} className="card pad stack">
            <div className="row between"><h3>{a.label}</h3><span className={`badge ${a.enabled ? 'ok' : ''}`}>{a.status}</span></div>
            <p className="small muted">{a.description}</p>
            <div><strong>{inr(a.priceInr)}</strong> <span className="small muted">{a.unit}</span></div>
            {a.expiresAt && <span className="small muted">Trial ends {new Date(a.expiresAt).toLocaleDateString('en-IN')}</span>}
            {!a.enabled && me!.role === 'owner' && <button className="btn primary" onClick={() => trial(k)}>Start {billing.data.trialDays}-day free trial</button>}
          </div>
        ))}
      </div>
      {devices.data?.enabled && (
        <div className="card pad stack">
          <h3>📷 Camera check-in devices (on-premises)</h3>
          <p className="small muted">Run the Relay edge agent on a PC at reception connected to your camera (see <code>apps/edge-checkin</code>). It matches only patients who opted in on their visit page, keeps face templates on that PC, and sends Relay just “patient X arrived”.</p>
          {(devices.data.devices ?? []).map((d: any) => <div key={d.id} className="row between small"><span>{d.name}</span><span className="muted">{d.last_seen_at ? `seen ${new Date(d.last_seen_at).toLocaleString('en-IN')}` : 'never connected'}</span></div>)}
          {canAdmin(me) && <div><button className="btn" onClick={addDevice}>+ Register a device</button></div>}
          {newToken && (
            <div className="ok-box small">
              Copy this device token now; it is shown only once.<br />
              <code>{newToken.token}</code> <CopyButton text={newToken.token} /><br />API: <code>{newToken.apiUrl}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
