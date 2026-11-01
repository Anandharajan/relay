import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, useApi, useEvents } from "../lib/api";
import { canAdmin, useSession } from "../lib/session";
import { RunBoard, type Agent, type Run as BoardRun } from "../components/RunBoard";
import { Recorder, SpeechSettings, VoiceProfiles, type Profile, type Speech } from "./VoiceSetup";
import "./voice.css";
const stages = ["Listen", "Plan", "Research", "Write", "Verify", "Speak"];
const settled = ["ready", "ready_text", "review", "failed", "audio_failed", "needs_input"];
/** Text for a voice to read, matching what the server sends to the cloning engine. */
const spoken = (text: string) =>
  text
    .replace(/\s*\[\d+(?:\s*[,-]\s*\d+)*\]/g, "")
    .replace(/^\s*(?:[-*+•]|#{1,6})\s+/gm, "")
    .replace(/(\*\*|__|\*|`|~~)/g, "");
type Client = {
  id: string;
  name: string;
  kind: string;
};
type Run = {
  id: string;
  client_id: string;
  question: string;
  answer: string;
  status: string;
  error: string | null;
  citations: {
    n: number;
    title: string;
    excerpt: string;
  }[];
  steps: (Partial<Agent> & { label?: string })[];
  clarify_question: string | null;
  skipped_documents: { name: string; reason: string }[];
};
type Bootstrap = {
  clients: Client[];
  voices: Profile[];
  runs: Run[];
  professions: Record<string, string>;
  tasks: Record<string, string>;
  reasoning: { connected: boolean; provider: string | null; local?: boolean };
  speech: Speech;
};
type Check = { ok: boolean; detail: string };
type Readiness = { db: Check; model: Check; transcription: Check; cloning: Check };
type Doc = {
  id: string;
  name: string;
  status: string;
  error: string | null;
  chunks: number;
};
type Tab = "run" | "documents" | "voices" | "settings";
const isDocActive = (d: Doc) => ["queued", "processing"].includes(d.status);
export function VoiceDesk() {
  const { me } = useSession();
  const { data, reload, error } = useApi<Bootstrap>("/api/voice/bootstrap");
  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("client");
  const [profession, setProfession] = useState("general"),
    [task, setTask] = useState("answer"),
    [question, setQuestion] = useState(""),
    [voice, setVoice] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [view, setView] = useState<"chat" | "agents">("chat"),
    [tab, setTab] = useState<Tab>("run"),
    [picked, setPicked] = useState<string | null>(null),
    [focus, setFocus] = useState<{ run: string; n: number; at: number } | null>(null),
    [whyOpen, setWhyOpen] = useState(false);
  const docs = useApi<Doc[]>(
    clientId ? `/api/voice/clients/${clientId}/documents` : null,
    [clientId],
  );
  const sync = () => {
    void reload();
    void docs.reload();
  };
  // Readiness pings the model and engines, so it refreshes on setup changes rather than on every poll.
  const readiness = useApi<Readiness>("/api/voice/readiness");
  const setupDone = () => {
    sync();
    void readiness.reload();
  };
  useEvents({ "voice.updated": sync });
  useEffect(() => {
    if (data && !data.clients.some((c) => c.id === clientId))
      setClientId(data.clients[0]?.id || "");
  }, [data, clientId]);
  // Replies use the first enrolled voice until the user chooses for themselves.
  const voiceChosen = useRef(false);
  useEffect(() => {
    if (!data) return;
    const live = data.voices.filter((v) => !v.revoked_at);
    if (voice && live.some((v) => v.id === voice)) return;
    const next = voiceChosen.current ? "" : live[0]?.id || "";
    if (next !== voice) setVoice(next);
  }, [data, voice]);
  useEffect(() => setPicked(null), [clientId]);
  const active =
    data?.runs.some((r) => !settled.includes(r.status)) || docs.data?.some(isDocActive);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(sync, 2500);
    return () => clearInterval(t);
  }, [active, clientId]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      sync();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <div className="vd">
        <h1>Voice desk</h1>
        <p role="status">{error || "Opening your workspace…"}</p>
      </div>
    );
  const readOnly = me?.role === "viewer";
  const selected = data.clients.find((c) => c.id === clientId);
  const liveVoices = data.voices.filter((v) => !v.revoked_at);
  const runs = data.runs.filter((r) => r.client_id === clientId);
  const running = runs.filter((r) => !settled.includes(r.status));
  // The newest active run is followed until the user picks another; the list is newest first.
  const shown = runs.find((r) => r.id === picked) ?? running[0] ?? runs[0] ?? null;
  const docsWorking = Boolean(docs.data?.some(isDocActive));
  const openRun = (id: string, n?: number) => {
    setPicked(id);
    setTab("run");
    setView("agents");
    setFocus(n === undefined ? null : { run: id, n, at: Date.now() });
  };
  function submit(audio: File | null) {
    return act(async () => {
      const f = new FormData();
      f.set("clientId", clientId);
      f.set("profession", profession);
      f.set("task", task);
      f.set("question", question);
      f.set("voiceId", voice);
      f.set("providerConsent", "yes");
      if (audio) f.set("file", audio);
      await api("/api/voice/runs", { form: f });
      setQuestion("");
      setFile(null);
      setPicked(null);
      setTab("run");
    });
  }
  // With consent already given, a finished recording goes straight to the agents.
  // It stays attached first, so a failed send can be retried without recording again.
  const recorded = (audio: File) => {
    setFile(audio);
    if (consent && clientId && !readOnly && !busy) void submit(audio);
  };
  const ready = readiness.data;
  const modelOk = ready ? ready.model.ok : data.reasoning.connected;
  const hearingOk = ready ? ready.transcription.ok : data.speech.transcriptionAvailable;
  const cloningOk = ready ? ready.cloning.ok : true;
  const capabilities: { on: boolean; label: string; why: string }[] = [
    ...(ready && !ready.db.ok
      ? [{ on: false, label: "Database: off", why: `. ${ready.db.detail}` }]
      : []),
    modelOk
      ? {
          on: true,
          label: `Written answers: ${data.reasoning.provider ?? "on"}${data.reasoning.local ? " (local)" : ""}`,
          why: "",
        }
      : {
          on: false,
          label: "Written answers: off",
          why: ready
            ? `. ${ready.model.detail}`
            : ". Replies quote source sentences until an AI model is connected",
        },
    hearingOk
      ? { on: true, label: "Spoken questions: on", why: "" }
      : {
          on: false,
          label: "Spoken questions: off",
          why: ready
            ? `. ${ready.transcription.detail}`
            : ". Type your question, or connect transcription",
        },
    liveVoices.length && cloningOk
      ? { on: true, label: "Cloned replies: on", why: "" }
      : {
          on: false,
          label: "Cloned replies: off",
          why: !cloningOk
            ? `. ${ready?.cloning.detail}`
            : data.speech.ttsProvider === "none"
              ? ". Connect a cloning engine"
              : ". Enroll your voice",
        },
  ];
  const tabs: { id: Tab; label: string; marker?: ReactNode }[] = [
    { id: "run", label: "Agents", marker: running.length > 0 && <span className="vd-dot" aria-label="working" /> },
    { id: "documents", label: "Documents", marker: docsWorking && <span className="vd-dot" aria-label="indexing" /> },
    { id: "voices", label: "My voices", marker: <span className="vd-count">{liveVoices.length}</span> },
    ...(canAdmin(me) ? [{ id: "settings" as const, label: "Voice settings" }] : []),
  ];
  return (
    <main className="vd vd-desk">
      <header className="vd-bar">
        <h1>
          <span aria-hidden="true">◉</span> Voice desk
        </h1>
        <ul
          className={"vd-capabilities " + (whyOpen ? "open" : "")}
          aria-label="What is active in this workspace"
        >
          {capabilities.map((c) => (
            <li key={c.label} className={c.on ? "on" : "off"}>
              {c.label}
              {c.why && <span className="vd-cap-why">{c.why}</span>}
            </li>
          ))}
          {capabilities.some((c) => !c.on) && (
            <li className="vd-cap-toggle">
              <button
                type="button"
                className="vd-text-button"
                aria-expanded={whyOpen}
                onClick={() => setWhyOpen(!whyOpen)}
              >
                {whyOpen ? "Less" : "Why off?"}
              </button>
            </li>
          )}
        </ul>
        <Link className="btn sm vd-bar-link" to="/app/settings/model">
          AI settings ↗
        </Link>
      </header>
      {(notice || error) && (
        <div className="vd-alert" role="alert">
          {notice || error}
        </div>
      )}
      {readOnly && (
        <div className="vd-alert">
          This account is read-only. Sign in with an agent or owner account to
          record and upload.
        </div>
      )}
      <div className="vd-switch" role="group" aria-label="Choose a pane">
        <button type="button" aria-pressed={view === "chat"} onClick={() => setView("chat")}>
          Chat
        </button>
        <button type="button" aria-pressed={view === "agents"} onClick={() => setView("agents")}>
          Agents
          {(running.length > 0 || docsWorking) && (
            <span className="vd-badge" role="status">
              Working
            </span>
          )}
        </button>
      </div>
      <div className="vd-split" data-view={view}>
        <section className="vd-pane vd-pane-chat" aria-label="Chat">
          <div className="vd-context">
            <label>
              Client workspace
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">Choose a client</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Your role
              <select
                value={profession}
                onChange={(e) => setProfession(e.target.value)}
              >
                {Object.entries(data.professions).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <details className="vd-add-client" open={!data.clients.length}>
              <summary>Add a client</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    const c = await api("/api/voice/clients", {
                      body: { name, kind },
                    });
                    await reload();
                    setClientId(c.id);
                    setName("");
                  });
                }}
              >
                <label>
                  Name
                  <input
                    required
                    maxLength={100}
                    value={name}
                    placeholder="e.g. Northside team"
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  Client type
                  <select value={kind} onChange={(e) => setKind(e.target.value)}>
                    {["client", "student", "patient", "employee", "customer"].map(
                      (k) => (
                        <option key={k}>{k}</option>
                      ),
                    )}
                  </select>
                </label>
                <button className="btn" disabled={busy || readOnly}>
                  Create workspace
                </button>
              </form>
            </details>
          </div>
          <Thread clientId={clientId} visible={view === "chat"} runs={runs}>
            <p className="vd-muted vd-thread-note">
              Healthcare, HR, advisory and client replies pause for your review.
              Nothing is sent to clients automatically.
            </p>
            {[...runs].reverse().map((r) => (
              <Reply
                key={r.id}
                run={r}
                shown={r.id === shown?.id}
                disabled={busy || readOnly}
                open={(n) => openRun(r.id, n)}
                approve={(answer) =>
                  act(() =>
                    api(`/api/voice/runs/${r.id}/approve`, { body: { answer } }),
                  )
                }
                clarify={(answer) =>
                  act(() =>
                    api(`/api/voice/runs/${r.id}/clarify`, { body: { answer } }),
                  )
                }
                remove={() =>
                  act(() => api(`/api/voice/runs/${r.id}`, { method: "DELETE" }))
                }
              />
            ))}
            {!runs.length && (
              <div className="vd-empty">
                Your first reply starts with a client, a file and a question.
                <br />
                The reply and audio appear here, with agents and sources under
                Agents.
              </div>
            )}
          </Thread>
          <div className="vd-compose">
            <label className="vd-question">
              Question or instructions
              <textarea
                rows={2}
                maxLength={6000}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What should I explain to this client? Ask a question, request a summary, or describe a reply."
              />
            </label>
            <div className="vd-context">
              <label>
                What do you need?
                <select value={task} onChange={(e) => setTask(e.target.value)}>
                  {Object.entries(data.tasks).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reply voice
                <select
                  value={voice}
                  onChange={(e) => {
                    voiceChosen.current = true;
                    setVoice(e.target.value);
                  }}
                >
                  <option value="">Text only · no cloned voice</option>
                  {liveVoices.map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.name} · {v.provider}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="vd-check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                I’m authorized to process this client’s data with our configured
                AI and speech providers. Relevant document excerpts may be sent to
                the AI provider.
              </span>
            </label>
            <div className="vd-compose-actions">
              <Recorder
                onFile={recorded}
                onError={setNotice}
                disabled={readOnly || busy || !data.speech.transcriptionAvailable}
              />
              <div className="vd-audio-input">
                <label className="vd-text-button">
                  Or upload audio
                  <input
                    type="file"
                    accept="audio/*"
                    disabled={readOnly || !data.speech.transcriptionAvailable}
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
                {file && (
                  <span>
                    {file.name}{" "}
                    <button
                      aria-label="Remove recording"
                      onClick={() => setFile(null)}
                    >
                      ×
                    </button>
                  </span>
                )}
              </div>
              <button
                className="vd-primary"
                disabled={
                  busy ||
                  readOnly ||
                  !clientId ||
                  !consent ||
                  (!file && question.trim().length < 3)
                }
                onClick={() => void submit(file)}
              >
                {busy ? "Working…" : "Create reply →"}
              </button>
            </div>
            {file && !consent && (
              <p className="vd-muted vd-compose-hint" role="status">
                Recording kept. Tick the box above, then create the reply.
              </p>
            )}
          </div>
        </section>
        <section className="vd-pane vd-pane-agents" aria-label="Agents">
          <PaneTabs tabs={tabs} tab={tab} setTab={setTab} />
          {/* Panels stay mounted so a recording, a consent tick or typed settings survive switching tabs. */}
          <div className="vd-tabpanel" role="tabpanel" id="vd-panel-run" aria-labelledby="vd-tab-run" hidden={tab !== "run"}>
            <RunPanel
              runs={runs}
              run={shown}
              picked={picked}
              pick={setPicked}
              focus={focus}
            />
          </div>
          <div className="vd-tabpanel" role="tabpanel" id="vd-panel-documents" aria-labelledby="vd-tab-documents" hidden={tab !== "documents"}>
            <h3>Client documents</h3>
            <p className="vd-muted">
              Only this client’s files are searched. PDF, DOCX, text, Markdown,
              CSV or JSON. 20 MB each.
            </p>
            <label className="vd-upload">
              ＋ Add documents
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json"
                disabled={!clientId || busy || readOnly}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    void act(async () => {
                      const form = new FormData();
                      form.set("file", f);
                      await api(`/api/voice/clients/${clientId}/documents`, {
                        form,
                      });
                    });
                  e.target.value = "";
                }}
              />
            </label>
            <div aria-live="polite">
              {docs.data?.map((d) => (
                <div className="vd-doc" key={d.id}>
                  <div>
                    <strong>{d.name}</strong>
                    <small>
                      {d.status === "ready"
                        ? `${d.chunks} indexed passages`
                        : d.status}
                    </small>
                    {d.error && <small className="vd-error">{d.error}</small>}
                  </div>
                  <button
                    aria-label={`Delete ${d.name}`}
                    disabled={readOnly || busy}
                    onClick={() =>
                      void act(() =>
                        api(`/api/voice/documents/${d.id}`, { method: "DELETE" }),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {!docs.data?.length && (
              <p className="vd-empty">
                Add a guide, lesson, policy or client brief to give your agent
                context.
              </p>
            )}
            {selected && canAdmin(me) && (
              <button
                className="vd-text-button"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${selected.name}, all their files and replies?`,
                    )
                  )
                    void act(async () => {
                      await api(`/api/voice/clients/${clientId}`, {
                        method: "DELETE",
                      });
                      await reload();
                      setClientId("");
                    });
                }}
              >
                Delete client and files
              </button>
            )}
          </div>
          <div className="vd-tabpanel" role="tabpanel" id="vd-panel-voices" aria-labelledby="vd-tab-voices" hidden={tab !== "voices"}>
            <VoiceProfiles
              data={data}
              done={setupDone}
              report={setNotice}
              readOnly={readOnly}
            />
          </div>
          {canAdmin(me) && (
            <div className="vd-tabpanel" role="tabpanel" id="vd-panel-settings" aria-labelledby="vd-tab-settings" hidden={tab !== "settings"}>
              <SpeechSettings speech={data.speech} done={setupDone} report={setNotice} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
function PaneTabs({
  tabs,
  tab,
  setTab,
}: {
  tabs: { id: Tab; label: string; marker?: ReactNode }[];
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length];
    setTab(next.id);
    document.getElementById(`vd-tab-${next.id}`)?.focus();
  };
  return (
    <div className="vd-tabs" role="tablist" aria-label="Agents pane">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`vd-tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`vd-panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          onKeyDown={(e) => onKey(e, i)}
          onClick={() => setTab(t.id)}
        >
          {t.label} {t.marker}
        </button>
      ))}
    </div>
  );
}
/** The scrolling reply thread: stays at the newest reply unless the user has scrolled up to read. */
function Thread({
  clientId,
  visible,
  runs,
  children,
}: {
  clientId: string;
  visible: boolean;
  runs: Run[];
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const newest = runs[0];
  const toEnd = () => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  };
  useLayoutEffect(() => {
    stick.current = true;
    toEnd();
  }, [clientId, newest?.id]);
  useLayoutEffect(() => {
    if (stick.current) toEnd();
  }, [visible, newest?.status, newest?.answer?.length]);
  return (
    <div
      className="vd-thread"
      ref={box}
      onScroll={(e) => {
        const b = e.currentTarget;
        stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
      }}
    >
      {children}
    </div>
  );
}
function RunPanel({
  runs,
  run: r,
  picked,
  pick,
  focus,
}: {
  runs: Run[];
  run: Run | null;
  picked: string | null;
  pick: (id: string | null) => void;
  focus: { run: string; n: number; at: number } | null;
}) {
  const sources = useRef<HTMLDivElement>(null);
  const target = focus && focus.run === r?.id ? focus.n : null;
  useEffect(() => {
    if (target !== null)
      sources.current
        ?.querySelector(`[data-source="${target}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [target, focus?.at]);
  if (!r)
    return (
      <p className="vd-empty">
        Agents appear here as soon as you ask a question. You’ll see each step
        and the sources it used.
      </p>
    );
  const agents = r.steps.filter((s) => s.id) as Agent[];
  const isSettled = settled.includes(r.status);
  const board: BoardRun = {
    id: r.id,
    kind: "message",
    title: r.question,
    status: isSettled ? (r.status === "failed" ? "failed" : "done") : "running",
    stages,
    agents,
    report: [],
    ms: agents.reduce((sum, a) => sum + (a.ms ?? 0), 0),
  };
  return (
    <>
      <label className="vd-run-pick">
        Showing
        <select
          value={picked && picked === r.id ? picked : ""}
          onChange={(e) => pick(e.target.value || null)}
        >
          <option value="">Newest active run</option>
          {runs.map((x) => (
            <option key={x.id} value={x.id}>
              {x.status.replaceAll("_", " ")} ·{" "}
              {(x.question || "Voice question").slice(0, 60)}
            </option>
          ))}
        </select>
      </label>
      <p className="vd-run-title">
        <span className={"vd-status " + r.status}>
          {r.status.replaceAll("_", " ")}
        </span>{" "}
        {r.question || "Processing your voice question…"}
      </p>
      {agents.length > 0 ? (
        <RunBoard run={board} boardOnly />
      ) : r.steps.length > 0 ? (
        <ol>
          {r.steps.map((s, i) => (
            <li key={i}>{s.label}</li>
          ))}
        </ol>
      ) : (
        <p className="vd-muted" role="status">
          {isSettled ? "No agent steps were recorded for this run." : "Agents are starting…"}
        </p>
      )}
      <div className="vd-sources" ref={sources}>
        <h3>Sources for this run · {r.citations.length}</h3>
        {r.citations.map((c) => (
          <blockquote
            key={c.n}
            data-source={c.n}
            className={c.n === target ? "focused" : ""}
          >
            <strong>
              [{c.n}] {c.title}
            </strong>
            <p>{c.excerpt}</p>
          </blockquote>
        ))}
        {!r.citations.length && (
          <p className="vd-muted">
            {isSettled
              ? "This run did not use any source passages."
              : "Source passages appear here once the research step finds them."}
          </p>
        )}
      </div>
    </>
  );
}
function Reply({
  run: r,
  shown,
  disabled,
  open,
  approve,
  clarify,
  remove,
}: {
  run: Run;
  shown: boolean;
  disabled: boolean;
  open: (n?: number) => void;
  approve: (s: string) => Promise<void>;
  clarify: (s: string) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(r.answer);
  const [clarification, setClarification] = useState("");
  useEffect(() => setDraft(r.answer), [r.answer]);
  const review = ["review", "audio_failed", "ready_text"].includes(r.status);
  return (
    <article className="vd-turn">
      <p className="vd-bubble-me">
        {r.question || "Processing your voice question…"}
      </p>
      <div className={"vd-reply " + (shown ? "shown" : "")}>
        <div className="vd-reply-head">
          <span className={"vd-status " + r.status}>
            {r.status.replaceAll("_", " ")}
          </span>
          <span className="vd-reply-actions">
            <button className="vd-text-button" onClick={() => open()}>
              View agents
            </button>
            <button
              className="vd-text-button"
              disabled={disabled}
              onClick={() => void remove()}
            >
              Delete reply
            </button>
          </span>
        </div>
        {r.error && (
          <p role="alert" className="vd-alert">
            {r.error}
          </p>
        )}
        {r.status === "needs_input" && r.clarify_question && (
          <form
            className="vd-clarify"
            onSubmit={(e) => {
              e.preventDefault();
              void clarify(clarification);
            }}
          >
            <label>
              The planner needs one detail: {r.clarify_question}
              <input
                required
                maxLength={2000}
                value={clarification}
                onChange={(e) => setClarification(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={disabled}>
              Continue
            </button>
          </form>
        )}
        {r.skipped_documents?.length > 0 && (
          <p className="vd-alert">
            Not searched:{" "}
            {r.skipped_documents
              .map((d) => `${d.name} (${d.reason})`)
              .join(", ")}
            . This reply may be incomplete, so it needs your review.
          </p>
        )}
        {r.answer &&
          (review ? (
            <label>
              Review and edit before speaking
              <textarea
                rows={7}
                maxLength={4000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
          ) : (
            <p className="vd-answer">{r.answer}</p>
          ))}
        {r.citations.length > 0 && (
          <ul className="vd-cites" aria-label="Sources">
            {r.citations.map((c) => (
              <li key={c.n}>
                <button type="button" onClick={() => open(c.n)}>
                  [{c.n}] {c.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        {review && r.answer && (
          <button
            className="btn primary"
            disabled={disabled || !draft.trim()}
            onClick={() => void approve(draft)}
          >
            Approve{" "}
            {r.status === "audio_failed"
              ? "and retry audio"
              : r.status === "ready_text"
                ? "edited reply"
                : "& generate reply"}
          </button>
        )}
        {r.status === "ready" && (
          <div className="vd-playback">
            <audio
              controls
              preload="none"
              src={`/api/voice/runs/${r.id}/audio`}
            />
            <a
              className="btn"
              href={`/api/voice/runs/${r.id}/audio?download=1`}
              download
            >
              ↓ Download audio
            </a>
          </div>
        )}
        {r.answer && r.status !== "ready" && "speechSynthesis" in window && (
          <button
            className="vd-text-button"
            onClick={() => {
              speechSynthesis.cancel();
              speechSynthesis.speak(
                new SpeechSynthesisUtterance(spoken(draft || r.answer)),
              );
            }}
          >
            Listen with standard device voice (not cloned)
          </button>
        )}
      </div>
    </article>
  );
}
export function VoiceLanding() {
  useEffect(() => {
    document.title = "Relay Voice: your knowledge, your voice";
  }, []);
  return (
    <main className="vd vd-landing">
      <nav>
        <Link to="/voice">◉ Relay Voice</Link>
        <Link className="btn" to="/login">
          Sign in →
        </Link>
      </nav>
      <div className="vd-eyebrow">A VOICE WORKSPACE FOR EVERY PROFESSIONAL</div>
      <h1>
        Less typing.
        <br />
        More <span>you.</span>
      </h1>
      <p className="vd-lead">
        Ask about your client’s files. Review a clear answer.
        <br />
        Reply in your own voice.
      </p>
      <Link className="vd-primary" to="/app/voice">
        Open your voice desk ↗
      </Link>
      <div className="vd-landing-grid">
        {[
          [
            "01",
            "Bring the context",
            "Upload a lesson, policy, client brief or document. Keep each client’s knowledge together.",
          ],
          [
            "02",
            "Ask out loud",
            "Record a question or type it. Your agent retrieves relevant passages and prepares a sourced draft.",
          ],
          [
            "03",
            "Make it yours",
            "Review, play on your phone, and download the reply in your authorized cloned voice.",
          ],
        ].map(([n, t, d]) => (
          <section className="vd-card" key={n}>
            <div className="vd-eyebrow">{n}</div>
            <h2>{t}</h2>
            <p>{d}</p>
          </section>
        ))}
      </div>
      <p>For educators · care teams · HR · advisors · service businesses</p>
      <small>
        Voice cloning requires a connected speech engine and your explicit
        permission. High-impact replies require review.
      </small>
    </main>
  );
}
