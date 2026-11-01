import { terms } from '../lib/terms';
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, closeStream, useEvents } from '../lib/api';
import { useSession } from '../lib/session';
import { Loading } from '../components/ui';
import { NotificationBell } from '../components/Notifications';
import { ChatDock } from '../components/ChatDock';
import { useProduct, type Product } from '../lib/product';

const navFor = (T: ReturnType<typeof terms>, product: Product | null) => product === 'voice' ? [
  { to: '/app', label: 'Voice desk', icon: '🎙', end: true },
  { to: '/app/inbox', label: 'Team inbox', icon: '📥', count: true },
  { to: '/app/settings', label: 'Workspace settings', icon: '⚙️' },
] : [
  { to: '/app', label: 'Agents', icon: '✨', end: true },
  ...(T.healthcare ? [{ to: '/app/desk', label: 'Live desk', icon: '🩺' }] : []),
  { to: '/app/inbox', label: 'Inbox', icon: '📥', count: true },
  { to: '/app/visits', label: T.visits, icon: '🗓️' },
  { to: '/app/clients', label: T.clients, icon: T.healthcare ? '🧑‍⚕️' : '👥' },
  ...(T.healthcare ? [{ to: '/app/approvals', label: 'Approvals', icon: '✅' }] : []),
];
const moreNavFor = (product: Product | null) => [
  ...(product === 'voice'
    ? [{ to: '/app/agents', label: 'Support agents', icon: '✨' }, { to: '/app/visits', label: 'Appointments', icon: '🗓️' }]
    : [{ to: '/app/voice', label: 'Voice desk', icon: '🎙' }]),
  { to: '/app/knowledge', label: 'Knowledge', icon: '📚' },
  { to: '/app/calls', label: 'Calls', icon: '📞' },
  { to: '/app/analytics', label: 'Analytics', icon: '📈' },
  { to: '/app/simulations', label: 'Simulations', icon: '🧪' },
  { to: '/app/actions', label: 'Actions', icon: '⚡' },
  { to: '/app/settings', label: 'Settings', icon: '⚙️' },
];

export function Layout() {
  const { me, loading, refresh } = useSession();
  const product = useProduct();
  const moreNav = moreNavFor(product);
  const navigate = useNavigate();
  const location = useLocation();
  const [attention, setAttention] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const loadCounts = () =>
    api('/api/inbox/conversations?view=attention')
      .then((r) => setAttention(r.counts.attention))
      .catch(() => {});

  useEffect(() => {
    if (me) void loadCounts();
  }, [me?.org.id]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEvents({
    attention: (d) => {
      void loadCounts();
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Relay: a conversation needs you', { body: d.reason ?? 'Customer is waiting', icon: '/icon-192.png' });
      }
    },
    'conversation.updated': () => void loadCounts(),
    'draft.created': () => void loadCounts(),
    'draft.updated': () => void loadCounts(),
  });

  // Presence heartbeat: tell teammates what this agent is looking at.
  useEffect(() => {
    if (!me) return;
    const convId = location.pathname.match(/\/app\/inbox\/([\w-]+)/)?.[1] ?? null;
    const beat = () => api('/api/inbox/presence', { body: { conversationId: convId } }).catch(() => {});
    void beat();
    const t = window.setInterval(beat, 15_000);
    return () => window.clearInterval(t);
  }, [me, location.pathname]);

  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;

  const logout = async () => {
    await api('/api/auth/logout', { body: {} });
    closeStream();
    const wasDemo = me?.role === 'viewer';
    await refresh();
    navigate(wasDemo ? '/' : '/login');
  };

  return (
    <div className="shell">
      <div className="mobile-bar">
        <button className="btn sm" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">☰</button>
        <strong>{me.org.name}</strong>
      </div>
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brandmark">
          <img src="/icon.svg" alt="" /> Relay
        </div>
        {me.orgs.length > 1 ? (
          <select
            className="select"
            value={me.org.id}
            onChange={async (e) => {
              await api('/api/me/switch-org', { body: { orgId: e.target.value } });
              closeStream();
              window.location.href = '/app';
            }}
            style={{ marginBottom: 8 }}
          >
            {me.orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        ) : (
          <div className="small muted" style={{ padding: '0 10px 8px' }}>{me.org.name}</div>
        )}
        <nav className="nav stack" style={{ gap: 2 }}>
          {navFor(terms(me), product).map((n: any) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span>{n.icon}</span> {n.label}
              {n.count && attention > 0 && <span className="count">{attention}</span>}
            </NavLink>
          ))}
          <details className="more" open={moreNav.some((n) => location.pathname.startsWith(n.to))}>
            <summary>More</summary>
            {moreNav.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                <span>{n.icon}</span> {n.label}
              </NavLink>
            ))}
          </details>
        </nav>
        <div className="bottom">
          {me.isPlatformAdmin && <NavLink to="/admin" className="small admin-link">🛡️ Platform admin</NavLink>}
          {'Notification' in window && Notification.permission === 'default' && (
            <button className="btn sm ghost" onClick={() => Notification.requestPermission()}>🔔 Enable notifications</button>
          )}
          <div className="row" style={{ padding: '0 6px' }}>
            <span className="grow small">
              <strong>{me.user.name}</strong>
              <br />
              <span className="muted">{me.role === 'viewer' ? 'read-only demo' : me.role}</span>
            </span>
            <button className="btn sm ghost" onClick={logout}>{me.role === 'viewer' ? 'Exit demo' : 'Sign out'}</button>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar"><NotificationBell /></div>
        {me.role === 'viewer' && (
          <div className="card pad row wrap" style={{ gap: 10, marginBottom: 16, background: 'var(--brand-soft)', color: 'var(--text)' }}>
            <span className="grow small">
              <strong>Demo workspace</strong> · read-only, shared with other visitors.
            </span>
            <a className="btn sm primary" href="/signup" onClick={async (e) => { e.preventDefault(); await api('/api/auth/logout', { body: {} }).catch(() => {}); closeStream(); window.location.assign('/signup'); }}>Create your workspace</a>
          </div>
        )}
        {me.org.sandboxExpiresAt && (
          <div className="card pad small" style={{ marginBottom: 16 }}>
            🔒 Private sandbox. It and everything in it is deleted at {new Date(me.org.sandboxExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. <a href="/signup">Create your own workspace</a> to keep your work.
          </div>
        )}
        <Outlet />
        {(me.org.sandboxExpiresAt || me.role === 'viewer') && <ChatDock siteKey={me.org.siteKey} defaultOpen={new URLSearchParams(location.search).get('chat') === 'open'} />}
      </main>
    </div>
  );
}
