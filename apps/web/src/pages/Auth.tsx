import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorBox, Field, Loading } from '../components/ui';

function Brand() {
  return (
    <Link to="/" className="brandmark" style={{ padding: 0 }}>
      <img src="/icon.svg" alt="" /> Relay
    </Link>
  );
}

export function Login() {
  const nav = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoEmail, setDemoEmail] = useState<string | null>(null);

  useEffect(() => {
    api('/api/public/config').then((c) => setDemoEmail(c.demoEmail), () => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { body: { email, password } });
      await refresh();
      nav('/app');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="card" onSubmit={submit}>
        <Brand />
        <div>
          <h1>Welcome back</h1>
          <p className="muted">Sign in to your support inbox.</p>
        </div>
        <ErrorBox error={error} />
        <Field label="Email">
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <button className="btn primary lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {demoEmail && (
          <p className="small muted">
            Exploring? The demo workspace owner is <code>{demoEmail}</code> — the password is <code>DEMO_PASSWORD</code> in the server's <code>.env</code>.
          </p>
        )}
        <p className="small muted">
          New here? <Link to="/signup">Create a workspace</Link>
        </p>
      </form>
    </div>
  );
}

export function Signup({ inviteToken, inviteInfo }: { inviteToken?: string; inviteInfo?: { email: string; org_name: string } }) {
  const nav = useNavigate();
  const { refresh } = useSession();
  const [form, setForm] = useState({ name: '', email: inviteInfo?.email ?? '', password: '', orgName: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/signup', { body: { ...form, orgName: form.orgName || undefined, inviteToken } });
      await refresh();
      nav('/app');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="card" onSubmit={submit}>
        <Brand />
        <div>
          <h1>{inviteInfo ? `Join ${inviteInfo.org_name}` : 'Create your workspace'}</h1>
          <p className="muted">{inviteInfo ? 'Set up your account to start answering conversations.' : 'Free forever for 100 AI conversations a month — no card needed.'}</p>
        </div>
        <ErrorBox error={error} />
        <Field label="Your name">
          <input className="input" value={form.name} onChange={set('name')} required autoComplete="name" />
        </Field>
        <Field label="Work email">
          <input className="input" type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <input className="input" type="password" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" />
        </Field>
        {!inviteInfo && (
          <Field label="Business name">
            <input className="input" value={form.orgName} onChange={set('orgName')} placeholder="e.g. Kaapi & Co." />
          </Field>
        )}
        <button className="btn primary lg" disabled={busy}>{busy ? 'Creating…' : inviteInfo ? 'Join workspace' : 'Create workspace'}</button>
        <p className="small muted">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}

export function Invite() {
  const { token } = useParams();
  const nav = useNavigate();
  const { me, refresh } = useSession();
  const [info, setInfo] = useState<{ email: string; org_name: string; role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api(`/api/auth/invite/${token}`).then(setInfo, (e) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div className="auth">
        <div className="card">
          <Brand />
          <ErrorBox error={error} />
          <Link to="/login">Go to sign in</Link>
        </div>
      </div>
    );
  }
  if (!info) return <Loading />;
  if (me) {
    return (
      <div className="auth">
        <div className="card">
          <Brand />
          <h1>Join {info.org_name}</h1>
          <p className="muted">You're signed in as {me.user.email}. Join as {info.role}?</p>
          <button
            className="btn primary lg"
            onClick={async () => {
              await api(`/api/auth/invite/${token}/accept`, { body: {} });
              await refresh();
              nav('/app');
            }}
          >
            Join workspace
          </button>
        </div>
      </div>
    );
  }
  return <Signup inviteToken={token} inviteInfo={info} />;
}
