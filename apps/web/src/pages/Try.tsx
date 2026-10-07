import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, closeStream } from '../lib/api';
import { useSession } from '../lib/session';
import { Loading } from '../components/ui';

/** /try — opens the public demo workspace read-only, no sign-up. */
export function Try() {
  const nav = useNavigate();
  const { refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api('/api/auth/demo', { body: {} })
      .then(async () => {
        closeStream();
        await refresh();
        nav('/app', { replace: true });
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  if (!error) return <Loading label="Opening the demo workspace…" />;
  return (
    <div className="auth">
      <div className="card stack">
        <h1>Demo unavailable</h1>
        <p className="muted">{error}</p>
        <Link className="btn primary" to="/signup">Create a free workspace instead</Link>
      </div>
    </div>
  );
}

/** /preview — a blank page with the signed-in workspace's own widget, to test before installing it anywhere. */
export function Preview() {
  const { me, loading } = useSession();
  useEffect(() => {
    if (!me) return;
    const s = document.createElement('script');
    s.src = '/widget.js';
    s.async = true;
    s.dataset.siteKey = me.org.siteKey;
    s.dataset.open = 'true';
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.getElementById('relay-widget')?.remove();
      delete (window as any).__relayLoaded;
      delete (window as any).Relay;
    };
  }, [me?.org.siteKey]);
  if (loading) return <Loading />;
  if (!me) return (
    <div className="auth"><div className="card stack"><h1>Sign in to preview</h1><p className="muted">The preview shows your own workspace's chat widget.</p><Link className="btn primary" to="/login">Sign in</Link></div></div>
  );
  return (
    <div className="page" style={{ maxWidth: 720, margin: '40px auto' }}>
      <div className="card pad stack">
        <h1>Widget preview · {me.org.name}</h1>
        <p className="muted">
          This page behaves like your website with the Relay widget installed. Ask a question in the chat (bottom-right) — the answer comes from your knowledge,
          and the conversation appears in your inbox like a real customer's.
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          <Link className="btn" to="/app/inbox">Open your inbox</Link>
          <Link className="btn" to="/app/knowledge">Add knowledge</Link>
          <Link className="btn primary" to="/app/settings/install">Get the install snippet</Link>
        </div>
      </div>
    </div>
  );
}
