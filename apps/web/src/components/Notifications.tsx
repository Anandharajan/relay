import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo, useApi, useEvents } from '../lib/api';
import { useToast } from './ui';

interface Notice {
  id: string;
  kind: string;
  severity: 'info' | 'attention' | 'urgent';
  title: string;
  body: string;
  facts: { label: string; value: string }[];
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** Bell with the signed-in user's notifications: who, what happened, what the agents did, what to do next. */
export function NotificationBell() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const list = useApi<{ items: Notice[]; unread: number }>('/api/notifications');
  useEvents({
    notify: (n: Notice & { at: string }) => {
      void list.reload();
      toast(n.title);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(n.title, { body: [n.body, ...n.facts.map((f) => `${f.label}: ${f.value}`)].join('\n'), icon: '/icon-192.png' });
      }
    },
  });
  const markAll = async () => {
    await api('/api/notifications/read', { body: {} }).catch(() => {});
    await list.reload();
  };
  const unread = list.data?.unread ?? 0;
  return (
    <div className="bell">
      <button className="btn sm ghost" onClick={() => setOpen(!open)} aria-label={`Notifications, ${unread} unread`} aria-expanded={open}>
        🔔{unread > 0 && <span className="count">{unread}</span>}
      </button>
      {open && (
        <div className="bell-panel card">
          <div className="row between" style={{ padding: '10px 12px' }}>
            <strong>Notifications</strong>
            {unread > 0 && <button className="btn sm ghost" onClick={markAll}>Mark all read</button>}
          </div>
          {!list.data?.items.length && <p className="small muted" style={{ padding: 12 }}>Nothing yet. Reports, bookings and clinical questions for you appear here.</p>}
          {list.data?.items.map((n) => (
            <Link key={n.id} to={n.link ?? '/app'} className={`notice ${n.severity} ${n.read_at ? 'read' : ''}`} onClick={() => { setOpen(false); void api('/api/notifications/read', { body: { ids: [n.id] } }).then(() => list.reload()); }}>
              <div className="row between"><strong>{n.title}</strong><span className="small muted">{timeAgo(n.created_at)}</span></div>
              {n.body && <div className="small">{n.body}</div>}
              <dl>{n.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
