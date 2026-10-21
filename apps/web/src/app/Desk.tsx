import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo, useApi, useEvents } from '../lib/api';
import { useSession } from '../lib/session';
import { Empty, Loading, useToast } from '../components/ui';
import { RunBoard, useRunFollower, type Run } from '../components/RunBoard';

interface Conv { id: string; customer_name: string | null; status: string; last_message_preview: string | null; last_message_at: string; meta: any }
interface Msg { id: string; role: string; content: string; created_at: string; author_name?: string | null }
interface Analysis { engine: string; summary: string; concerns: string[]; nextSteps: string[]; askPatient: string[] }

/** The last saved copilot analysis, shown when no live run is in memory (e.g. after a restart). */
function SavedAnalysis({ a, message, at }: { a: Analysis; message: string; at: string }) {
  return (
    <section className="report">
      <header className="row between"><strong>Doctor analysis · {a.engine}</strong><span className="small muted">{timeAgo(at)}</span></header>
      <div className="rblock text"><h4>For the message</h4><p>“{message}”</p></div>
      <div className="rblock text"><h4>Summary</h4><p>{a.summary}</p></div>
      {a.concerns.length > 0 && <div className="rblock list warn"><h4>Concerns</h4><ul>{a.concerns.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      <div className="rblock list"><h4>Suggested next steps</h4><ul>{a.nextSteps.map((x) => <li key={x}>{x}</li>)}</ul></div>
      {a.askPatient.length > 0 && <div className="rblock list"><h4>Ask the patient</h4><ul>{a.askPatient.map((x) => <li key={x}>{x}</li>)}</ul></div>}
    </section>
  );
}

/**
 * Live desk: every patient conversation as it happens. For the selected patient, the doctor sees the
 * conversation, replies straight into the patient's chatbot, and watches the copilot agents collect
 * records and write the analysis while the assistant answers the patient.
 */
export function Desk() {
  const { me } = useSession();
  const toast = useToast();
  const list = useApi<{ conversations: Conv[] }>('/api/inbox/conversations?view=open');
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useApi<{ conversation: Conv; messages: Msg[]; patient: any }>(selected ? `/api/inbox/conversations/${selected}` : null);
  const copilot = useRunFollower('/api/runs');
  const [reply, setReply] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [detail.data?.messages.length, selected]);
  const readOnly = me?.role === 'viewer';

  const openRun = useCallback(async (runId: string) => {
    const r = await api<Run>(`/api/runs/${runId}`).catch(() => null);
    if (r) copilot.follow(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On selecting a patient, show their latest copilot run (if still in memory).
  useEffect(() => {
    if (!selected) return;
    api<Run | null>(`/api/runs?conversationId=${selected}`).then((r) => r && copilot.follow(r)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEvents({
    'conversation.created': () => void list.reload(),
    'conversation.updated': () => void list.reload(),
    'message.created': (m: { conversation_id: string }) => {
      void list.reload();
      if (m.conversation_id === selected) void detail.reload();
    },
    'copilot.started': (e: { conversationId: string; runId: string }) => {
      // Follow the patient who is typing right now.
      if (!selected || e.conversationId === selected) {
        setSelected(e.conversationId);
        void openRun(e.runId);
      }
      void list.reload();
    },
  });

  const convs = list.data?.conversations ?? [];
  useEffect(() => {
    if (!selected && convs[0]) setSelected(convs[0].id);
  }, [convs, selected]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !reply.trim()) return;
    try {
      await api(`/api/inbox/conversations/${selected}/messages`, { body: { content: reply.trim() } });
      setReply('');
      await detail.reload();
      toast('Sent to the patient’s chat');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const conv = detail.data?.conversation;
  const saved = conv?.meta?.copilot as { analysis: Analysis; message: string; at: string } | undefined;
  const liveForThis = copilot.run && (copilot.run as Run & { conversationId?: string }).conversationId === selected ? copilot.run : null;

  return (
    <div className="page desk">
      <div className="page-head">
        <div>
          <h1>Live desk</h1>
          <p>As a patient types, agents collect their records and write your analysis, while the assistant gives the patient a simple reply. Reply here to answer in their chat.</p>
        </div>
      </div>
      <div className="desk-grid">
        <aside className="card desk-list">
          {list.loading && !list.data ? <Loading /> : !convs.length ? (
            <Empty icon="💬" title="No live patients yet">Open the patient chatbot and send a message.</Empty>
          ) : convs.map((c) => (
            <button key={c.id} className={`desk-conv ${c.id === selected ? 'active' : ''}`} onClick={() => setSelected(c.id)}>
              <div className="row between"><strong>{c.customer_name || 'Visitor'}</strong><span className="small muted">{timeAgo(c.last_message_at)}</span></div>
              <span className="small muted">{c.last_message_preview}</span>
              {c.meta?.priority === 'urgent' && <span className="badge bad">urgent</span>}
            </button>
          ))}
        </aside>

        <section className="card desk-chat">
          {!conv ? <p className="small muted" style={{ padding: 16 }}>Select a patient.</p> : (
            <>
              <header className="row between desk-head">
                <div>
                  <strong>{detail.data?.patient?.client?.name ?? conv.customer_name ?? 'Visitor'}</strong>
                  <div className="small muted">
                    {detail.data?.patient?.appointment ? `${detail.data.patient.appointment.staff_name} · token ${detail.data.patient.appointment.token_no}` : 'No visit booked yet'} · {conv.status === 'ai' ? 'assistant answering' : conv.status === 'escalated' ? 'needs a person' : conv.status}
                  </div>
                </div>
                {detail.data?.patient?.client && <Link className="btn sm" to={`/app/clients/${detail.data.patient.client.id}`}>Patient brief</Link>}
              </header>
              <div className="desk-messages">
                {(detail.data?.messages ?? []).map((m) => (
                  <div key={m.id} className={`bubble ${m.role === 'customer' ? 'in' : m.role === 'system' || m.role === 'note' ? 'sys' : 'out'}`}>
                    {m.role !== 'customer' && m.role !== 'system' && <small className="muted">{m.role === 'ai' ? 'Assistant' : m.role === 'note' ? 'Internal note' : m.author_name ?? 'Staff'}</small>}
                    {m.content}
                  </div>
                ))}
                <div ref={bottom} />
              </div>
              {!readOnly && (
                <form className="desk-reply" onSubmit={send}>
                  <input className="input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the patient (goes straight to their chat)…" aria-label="Reply to patient" />
                  <button className="btn primary" disabled={!reply.trim()}>Send</button>
                </form>
              )}
            </>
          )}
        </section>

        <section className="desk-copilot">
          {liveForThis ? <RunBoard run={liveForThis} reportTitle="Doctor analysis" /> : saved ? (
            <SavedAnalysis a={saved.analysis} message={saved.message} at={saved.at} />
          ) : (
            <div className="card pad small muted">The doctor copilot runs on the next message from this patient.</div>
          )}
        </section>
      </div>
    </div>
  );
}
