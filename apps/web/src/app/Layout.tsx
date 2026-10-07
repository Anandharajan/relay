import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, closeStream, useEvents } from '../lib/api';
import { useSession } from '../lib/session';
import { Loading } from '../components/ui';

const nav = [
  { to: '/app', label: 'Home', icon: '🏠', end: true },
  { to: '/app/inbox', label: 'Inbox', icon: '📥', count: true },
  { to: '/app/knowledge', label: 'Knowledge', icon: '📚' },
  { to: '/app/simulations', label: 'Simulations', icon: '🧪' },
  { to: '/app/actions', label: 'Actions', icon: '⚡' },
  { to: '/app/analytics', label: 'Analytics', icon: '📈' },
  { to: '/app/settings', label: 'Settings', icon: '⚙️' },
];

export function Layout() {
  const { me, loading, refresh } = useSession();
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
    await refresh();
    navigate('/login');
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
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span>{n.icon}</span> {n.label}
              {n.count && attention > 0 && <span className="count">{attention}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="bottom">
          <a className="small" href="/demo" target="_blank" rel="noreferrer" style={{ padding: '0 10px' }}>Open demo store ↗</a>
          {'Notification' in window && Notification.permission === 'default' && (
            <button className="btn sm ghost" onClick={() => Notification.requestPermission()}>🔔 Enable notifications</button>
          )}
          <div className="row" style={{ padding: '0 6px' }}>
            <span className="grow small">
              <strong>{me.user.name}</strong>
              <br />
              <span className="muted">{me.role}</span>
            </span>
            <button className="btn sm ghost" onClick={logout}>Sign out</button>
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
