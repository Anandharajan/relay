import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ago, api, langLabel, timeAgo, useApi, useEvents } from '../lib/api';
import { useSession } from '../lib/session';
import { Avatar, Empty, ErrorBox, Loading, StatusBadge, useToast } from '../components/ui';

const views = [
  { id: 'attention', label: 'Needs you' },
  { id: 'open', label: 'Open' },
  { id: 'ai', label: 'AI' },
  { id: 'human', label: 'Human' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' },
];

const channelIcon: Record<string, string> = { web: '🌐', whatsapp: '🟢', email: '✉️', agent: '🤖' };

function useDebounced(fn: () => void, ms = 300) {
  const t = useRef<number | undefined>(undefined);
  return () => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(fn, ms);
  };
}

export function Inbox() {
  const { id } = useParams();
  const [view, setView] = useState(() => localStorage.getItem('relay:inbox-view') ?? 'open');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const list = useApi<{ conversations: any[]; counts: Record<string, number> }>(`/api/inbox/conversations?view=${view}&q=${encodeURIComponent(query)}`);
  const [presence, setPresence] = useState<{ userId: string; name: string; conversationId: string | null }[]>([]);
  const [threadVersion, setThreadVersion] = useState(0);
  const reloadList = useDebounced(() => void list.reload());

  useEffect(() => {
    try {
      localStorage.setItem('relay:inbox-view', view);
    } catch {
      /* ignore */
    }
  }, [view]);

  useEvents({
    'message.created': (m) => {
      reloadList();
      if (m.conversation_id === id) setThreadVersion((v) => v + 1);
    },
    'conversation.created': reloadList,
    'conversation.updated': (d) => {
      reloadList();
      if (d.id === id) setThreadVersion((v) => v + 1);
    },
    'draft.created': (d) => {
      reloadList();
      if (d.conversation_id === id) setThreadVersion((v) => v + 1);
    },
    'draft.updated': (d) => {
      reloadList();
      if (d.conversationId === id) setThreadVersion((v) => v + 1);
    },
    presence: setPresence,
  });

  return (
    <div className={`inbox ${id ? 'has-active' : ''}`}>
      <section className="convlist">
        <div className="head">
          <div className="row between">
            <h2>Inbox</h2>
            <span className="small muted">{list.data?.counts.open ?? 0} open</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(q);
            }}
          >
            <input className="input" placeholder="Search conversations…" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setQuery(q)} />
          </form>
          <div className="tabs">
            {views.map((v) => (
              <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>
                {v.label}
                {list.data?.counts[v.id] ? <span className="muted"> {list.data.counts[v.id]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="items">
          {list.loading && !list.data ? (
            <Loading />
          ) : list.data?.conversations.length ? (
            list.data.conversations.map((c) => {
              const viewers = presence.filter((p) => p.conversationId === c.id);
              return (
                <Link key={c.id} to={`/app/inbox/${c.id}`} className={`conv-item ${c.id === id ? 'active' : ''}`}>
                  <div className="row between">
                    <span className="name">
                      {channelIcon[c.channel] ?? '💬'} {c.customer_name || `Visitor ${c.visitor_id.slice(-5)}`}
                    </span>
                    <span className="small muted">{timeAgo(c.last_message_at)}</span>
                  </div>
                  <div className="preview">{c.last_message_preview || '—'}</div>
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                    <StatusBadge status={c.status} />
                    {c.pending_drafts > 0 && <span className="badge brand">✍️ draft ready</span>}
                    {c.lang !== 'en' && <span className="badge">{langLabel[c.lang]?.split(' ')[0] ?? c.lang}</span>}
                    {c.assignee_name && <span className="badge">@{c.assignee_name.split(' ')[0]}</span>}
                    {viewers.length > 0 && <span className="badge info">👀 {viewers.map((v) => v.name.split(' ')[0]).join(', ')}</span>}
                  </div>
                </Link>
              );
            })
          ) : (
            <Empty icon="🎉" title="Nothing here">
              <span className="small">{view === 'attention' ? 'No conversations need a human right now.' : 'No conversations in this view.'}</span>
            </Empty>
          )}
        </div>
      </section>
      {id ? (
        <Thread key={id} id={id} version={threadVersion} presence={presence} onChange={() => void list.reload()} />
      ) : (
        <section className="thread">
          <Empty icon="📥" title="Pick a conversation">
            <span className="small">AI handles most chats on its own. Anything it isn't sure about lands in “Needs you”.</span>
          </Empty>
        </section>
      )}
    </div>
  );
}

function Thread({ id, version, presence, onChange }: { id: string; version: number; presence: { userId: string; name: string; conversationId: string | null }[]; onChange: () => void }) {
  const { me } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`/api/inbox/conversations/${id}`);
  const [text, setText] = useState('');
  const [note, setNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (version) void reload();
  }, [version]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages?.length, data?.drafts?.length]);

  if (error) return <section className="thread"><div className="page"><ErrorBox error={error} /></div></section>;
  if (!data) return <section className="thread"><Loading /></section>;
  const conv = data.conversation;
  const viewers = presence.filter((p) => p.conversationId === id && p.userId !== me?.user.id);
  const pendingDrafts = data.drafts.filter((d: any) => d.status === 'pending');
  const pendingRuns = data.actionRuns.filter((r: any) => r.status === 'pending_approval');

  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (msg) toast(msg);
      await reload();
      onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = () =>
    act(async () => {
      await api(`/api/inbox/conversations/${id}/messages`, { body: { content: text, note } });
      setText('');
    }, note && /@(ai|relay)\b/i.test(text) ? 'Asked AI for a suggested reply…' : undefined);

  return (
    <>
      <section className="thread">
        <div className="top">
          <button className="btn sm ghost" onClick={() => nav('/app/inbox')} aria-label="Back">←</button>
          <div className="who-block">
            <strong>{conv.customer_name || `Visitor ${conv.visitor_id.slice(-5)}`}</strong>
            <div className="small muted">
              {channelIcon[conv.channel]} {conv.channel} · {langLabel[conv.lang] ?? conv.lang} · started {timeAgo(conv.created_at)}
            </div>
          </div>
          {viewers.length > 0 && (
            <span className="presence" title={`${viewers.map((v) => v.name).join(', ')} viewing`}>
              {viewers.map((v) => <Avatar key={v.userId} name={v.name} />)}
            </span>
          )}
          <StatusBadge status={conv.status} />
          {(conv.status === 'ai' || conv.status === 'escalated') && (
            <button className="btn sm" disabled={busy} onClick={() => act(() => api(`/api/inbox/conversations/${id}/takeover`, { body: {} }), 'You took over — AI is paused')}>
              ✋ Take over
            </button>
          )}
          {(conv.status === 'human' || conv.status === 'escalated') && (
            <button className="btn sm" disabled={busy} onClick={() => act(() => api(`/api/inbox/conversations/${id}/handback`, { body: {} }), 'Handed back to AI')}>
              🤖 Hand back to AI
            </button>
          )}
          {conv.status !== 'resolved' && (
            <button className="btn sm primary" disabled={busy} onClick={() => act(() => api(`/api/inbox/conversations/${id}/resolve`, { body: {} }), 'Resolved')}>
              ✓ Resolve
            </button>
          )}
        </div>

        <div className="msgs">
          {data.messages.map((m: any) => (
            <div key={m.id} className={`bubble-row ${m.role}`}>
              <div className="bubble">{m.role === 'note' ? `📝 ${m.content}` : m.content}</div>
              {m.role !== 'system' && (
                <div className="meta-line">
                  <span>{m.role === 'customer' ? 'Customer' : m.role === 'ai' ? (m.author_name ? `AI · approved by ${m.author_name}` : 'AI') : m.author_name ?? 'Team'}</span>
                  <span>· {timeAgo(m.created_at)}</span>
                  {m.confidence != null && m.role === 'ai' && <span className={`badge ${m.confidence >= 0.7 ? 'ok' : m.confidence >= 0.45 ? 'warn' : 'bad'}`}>{Math.round(m.confidence * 100)}% sure</span>}
                  {m.meta?.kind === 'action' && <span className="badge info">⚡ {m.meta.action?.name}</span>}
                  {m.meta?.reason && <span className="badge warn" title={m.meta.reason}>{m.meta.reason.split(':')[0].split(' (')[0].replace(/_/g, ' ')}</span>}
                  {m.meta?.engine && <span className="muted">{m.meta.engine}</span>}
                  {m.role === 'human' && (
                    <button className="btn sm ghost" style={{ height: 22 }} onClick={() => act(() => api(`/api/inbox/messages/${m.id}/learn`, { body: {} }), 'Saved to knowledge — the AI will use this answer next time')}>
                      🧠 Teach AI
                    </button>
                  )}
                </div>
              )}
              {m.citations?.length > 0 && (
                <div className="meta-line">
                  Sources: {m.citations.map((c: any) => <span key={c.n} className="badge" title={c.snippet}>{c.title}</span>)}
                </div>
              )}
            </div>
          ))}

          {pendingRuns.map((r: any) => (
            <div key={r.id} className="draft" style={{ borderColor: 'var(--warn)' }}>
              <strong>🔐 Verify sensitive action: {r.action_name}</strong>
              <pre>{JSON.stringify(r.params, null, 2)}</pre>
              <p className="small muted">Confirm the customer's identity before approving. Approving calls your API and sends the result to the customer.</p>
              <div className="row">
                <button className="btn primary sm" disabled={busy} onClick={() => act(() => api(`/api/inbox/action-runs/${r.id}`, { body: { approve: true } }), 'Action approved and executed')}>Approve &amp; run</button>
                <button className="btn sm danger" disabled={busy} onClick={() => act(() => api(`/api/inbox/action-runs/${r.id}`, { body: { approve: false } }), 'Action rejected')}>Reject</button>
              </div>
            </div>
          ))}

          {pendingDrafts.map((d: any) => (
            <div key={d.id} className="draft">
              <div className="row between">
                <strong>✍️ AI draft</strong>
                <span className={`badge ${d.confidence >= 0.7 ? 'ok' : 'warn'}`}>{Math.round((d.confidence ?? 0) * 100)}% sure</span>
              </div>
              <textarea className="textarea" value={draftEdits[d.id] ?? d.draft} onChange={(e) => setDraftEdits({ ...draftEdits, [d.id]: e.target.value })} />
              {d.citations?.length > 0 && <div className="meta-line">Sources: {d.citations.map((c: any) => <span key={c.n} className="badge" title={c.snippet}>{c.title}</span>)}</div>}
              <div className="row wrap">
                <button className="btn primary sm" disabled={busy} onClick={() => act(() => api(`/api/inbox/conversations/${id}/drafts/${d.id}`, { body: { decision: 'send', text: draftEdits[d.id] ?? d.draft } }), (draftEdits[d.id] ?? d.draft) !== d.draft ? 'Sent — your edit was saved as knowledge' : 'Sent')}>
                  {(draftEdits[d.id] ?? d.draft) !== d.draft ? 'Send edited reply' : 'Approve & send'}
                </button>
                <button className="btn sm" disabled={busy} onClick={() => act(() => api(`/api/inbox/conversations/${id}/drafts/${d.id}`, { body: { decision: 'discard' } }))}>Discard</button>
                <span className="small muted">Edits teach the AI.</span>
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>

        <div className={`composer ${note ? 'note-mode' : ''}`}>
          <div className="tabs" style={{ border: 0 }}>
            <button className={!note ? 'active' : ''} onClick={() => setNote(false)}>Reply to customer</button>
            <button className={note ? 'active' : ''} onClick={() => setNote(true)}>Internal note</button>
          </div>
          <textarea
            className="textarea"
            style={{ minHeight: 70 }}
            placeholder={note ? 'Only your team sees this. Type @AI to ask for a suggested reply, e.g. "@AI offer a replacement"' : conv.status === 'ai' ? 'Replying will take over from the AI…' : 'Type your reply…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) void send();
            }}
          />
          <div className="row between">
            <span className="small muted"><span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> to send</span>
            <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void send()}>{note ? 'Add note' : 'Send'}</button>
          </div>
        </div>
      </section>
      <Details data={data} />
    </>
  );
}

function Details({ data }: { data: any }) {
  const c = data.conversation;
  return (
    <aside className="details">
      <h3>Customer</h3>
      <dl className="kv">
        <dt>Name</dt><dd>{c.customer_name || '—'}</dd>
        <dt>Contact</dt><dd>{c.customer_contact || '—'}</dd>
        <dt>Visitor ID</dt><dd><code>{c.visitor_id}</code></dd>
        <dt>Channel</dt><dd>{c.channel}</dd>
        <dt>Language</dt><dd>{langLabel[c.lang] ?? c.lang}</dd>
        <dt>CSAT</dt><dd>{c.csat ? (c.csat >= 4 ? '👍 Helpful' : '👎 Not helpful') : '—'}</dd>
        <dt>Resolved by</dt><dd>{c.resolved_by ?? '—'}</dd>
        {c.meta?.pageUrl && (<><dt>Page</dt><dd><a href={c.meta.pageUrl} target="_blank" rel="noreferrer">{c.meta.pageUrl.replace(/^https?:\/\//, '').slice(0, 40)}</a></dd></>)}
      </dl>
      <hr style={{ margin: 0 }} />
      <h3>Privacy</h3>
      <p className="small muted">
        {data.consents.length ? `Consent recorded ${ago(data.consents[0].granted_at)} (${data.consents[0].purpose}).` : 'No consent record for this visitor.'} PII is redacted before AI processing.
      </p>
      <a className="small" href={`/api/workspace/privacy/export?visitor=${encodeURIComponent(c.visitor_id)}`}>Export this customer's data (JSON)</a>
      {data.actionRuns.length > 0 && (
        <>
          <hr style={{ margin: 0 }} />
          <h3>Actions</h3>
          {data.actionRuns.map((r: any) => (
            <div key={r.id} className="row between small">
              <span>⚡ {r.action_name}</span>
              <StatusBadge status={r.status} />
            </div>
          ))}
        </>
      )}
    </aside>
  );
}
