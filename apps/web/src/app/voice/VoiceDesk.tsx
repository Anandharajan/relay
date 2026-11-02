import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, useApi, useEvents } from "../../lib/api";
import { canAdmin, useSession } from "../../lib/session";
import { AddClient } from "./AddClient";
import { CapabilityStrip } from "./CapabilityStrip";
import { Dictation, dictationSupported } from "./Dictation";
import { DocumentsPanel } from "./DocumentsPanel";
import { Guide, type GuideStep } from "./Guide";
import { isDocActive, settled, type Bootstrap, type Doc, type Readiness, type Tab } from "./model";
import { PaneTabs } from "./PaneTabs";
import { Recorder } from "./Recorder";
import { Reply } from "./Reply";
import { RunPanel } from "./RunPanel";
import { SpeechSettings } from "./SpeechSettings";
import { Thread } from "./Thread";
import { VoiceProfiles } from "./VoiceProfiles";
import "./voice.css";
export function VoiceDesk() {
  const { me } = useSession();
  const { data, reload, error } = useApi<Bootstrap>("/api/voice/bootstrap");
  const [clientId, setClientId] = useState("");
  const [autoPlay, setAutoPlay] = useState(false);
  const playbackRuns = useRef(new Set<string>());
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
    [focus, setFocus] = useState<{ run: string; n: number; at: number } | null>(null);
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
      const created = await api<{ id: string }>("/api/voice/runs", { form: f });
      playbackRuns.current.add(created.id);
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
  // Live readiness wins over saved settings, so a stopped VoiceStudio never looks usable.
  const ready = readiness.data;
  const cloning = ready
    ? ready.cloning
    : { ok: false, detail: "Not checked yet" };
  const hearing = ready?.transcription.ok === true;
  const isAdmin = canAdmin(me);
  const docsReady = Boolean(docs.data?.some((d) => d.status === "ready"));
  const goTo = (t: Tab) => {
    setTab(t);
    setView("agents");
  };
  const reveal = (selector: string, focus = selector) => {
    setView("chat");
    setTimeout(() => {
      document.querySelector(selector)?.scrollIntoView({ block: "center", behavior: "smooth" });
      document.querySelector<HTMLElement>(focus)?.focus();
    }, 50);
  };
  const studioNeedsModels = !cloning.ok && /no model yet/.test(cloning.detail);
  const steps: GuideStep[] = [
    {
      id: "studio",
      title: studioNeedsModels ? "Finish VoiceStudio setup" : "Connect VoiceStudio",
      detail: cloning.ok
        ? "Connected."
        : !isAdmin
          ? "A workspace admin needs to set up VoiceStudio. You can still type questions meanwhile."
          : studioNeedsModels
            ? "VoiceStudio is running but has no models. In VoiceStudio, download a speech-to-text model and a cloning model and accept their licences."
            : "VoiceStudio hears recorded questions and speaks replies in your cloned voice.",
      done: cloning.ok,
      blocked: !isAdmin,
      action: { label: studioNeedsModels ? "See what is missing" : "Connect", run: () => goTo("settings") },
    },
    {
      id: "voice",
      title: "Clone your voice",
      detail: cloning.ok
        ? "Read one short phrase aloud. It takes about a minute."
        : "Available once VoiceStudio is connected.",
      done: liveVoices.length > 0,
      blocked: !cloning.ok,
      action: { label: "Clone my voice", run: () => goTo("voices") },
    },
    {
      id: "client",
      title: "Add a client",
      detail: "Each client’s files are kept apart and searched only for them.",
      done: data.clients.length > 0,
      action: {
        label: "Add client",
        run: () => {
          const add = document.querySelector<HTMLDetailsElement>(".vd-add-client");
          if (add) add.open = true;
          reveal(".vd-add-client", ".vd-add-client input");
        },
      },
    },
    {
      id: "document",
      title: "Upload a document",
      detail: "A policy, guide or brief the agents can quote from.",
      done: docsReady,
      blocked: !clientId,
      action: { label: "Upload", run: () => goTo("documents") },
    },
    {
      id: "ask",
      title: "Ask a question",
      detail: hearing || dictationSupported
        ? "Record it or type it, tick the consent box, then create the reply."
        : "Type it, tick the consent box, then create the reply.",
      done: runs.length > 0,
      blocked: !clientId,
      action: { label: "Ask", run: () => reveal("#vd-question") },
    },
    {
      id: "approve",
      title: "Review and approve the reply",
      detail: "Check the sources, edit if needed, and approve it in your voice.",
      done: runs.some((r) => ["ready", "ready_text", "queued_audio", "synthesizing"].includes(r.status)),
      blocked: !runs.some((r) => r.status === "review" || r.status === "ready_text"),
      action: { label: "Review", run: () => reveal(".vd-approve", ".vd-approve button") },
    },
    {
      id: "listen",
      title: "Play the reply in your voice",
      detail: liveVoices.length
        ? "Approve a reply with your voice selected, then play or download it."
        : "Clone your voice first.",
      done: runs.some((r) => r.status === "ready"),
      blocked: !liveVoices.length || !cloning.ok,
      action: { label: "Play", run: () => reveal(".vd-playback audio") },
    },
  ];
  const missing = [
    !clientId && "choose a client",
    !file && question.trim().length < 3 && "type or record a question",
    !consent && "tick the consent box",
  ].filter(Boolean);
  const tabs: { id: Tab; label: string; marker?: ReactNode }[] = [
    { id: "run", label: "Agents", marker: running.length > 0 && <span className="vd-dot" aria-label="working" /> },
    { id: "documents", label: "Documents", marker: docsWorking && <span className="vd-dot" aria-label="indexing" /> },
    { id: "voices", label: "My voices", marker: <span className="vd-count">{liveVoices.length}</span> },
    ...(isAdmin
      ? [{ id: "settings" as const, label: "VoiceStudio", marker: !cloning.ok && <span className="vd-dot off" aria-label="not connected" /> }]
      : []),
  ];
  return (
    <main className="vd vd-desk">
      <header className="vd-bar">
        <h1>
          <span aria-hidden="true">◉</span> Voice desk
        </h1>
        <CapabilityStrip data={data} ready={readiness.data} liveVoices={liveVoices.length} />
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
      {!readOnly && <Guide steps={steps} />}
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
            <AddClient
              open={!data.clients.length}
              disabled={busy || readOnly}
              act={act}
              created={async (id) => {
                await reload();
                setClientId(id);
              }}
            />
          </div>
          <Thread clientId={clientId} visible={view === "chat"} runs={runs}>
            <p className="vd-muted vd-thread-note">
              Healthcare, HR, advisory and client replies pause for your review.
              Nothing is sent to clients automatically.
            </p>
            <label className="vd-muted vd-thread-note">
              <input type="checkbox" checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} />
              Play new replies aloud when ready. Your browser may require tapping Play.
            </label>
            {[...runs].reverse().map((r) => (
              <Reply
                key={r.id}
                run={r}
                shown={r.id === shown?.id}
                disabled={busy || readOnly}
                voices={liveVoices}
                cloning={cloning.ok}
                autoPlay={autoPlay && playbackRuns.current.has(r.id)}
                playbackAttempted={() => playbackRuns.current.delete(r.id)}
                open={(n) => openRun(r.id, n)}
                enroll={() => goTo("voices")}
                approve={(answer, voiceId) =>
                  act(async () => {
                    await api(`/api/voice/runs/${r.id}/approve`, { body: { answer, voiceId } });
                    playbackRuns.current.add(r.id);
                  })
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
                id="vd-question"
                rows={2}
                maxLength={6000}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What should I explain to this client? Ask a question, request a summary, or describe a reply."
              />
            </label>
            <details className="vd-options">
              <summary>
                {data.tasks[task]} ·{" "}
                {liveVoices.find((v) => v.id === voice)?.name ?? "Text only"} ·{" "}
                {data.professions[profession]}
              </summary>
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
            </details>
            <label className="vd-check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                I’m authorized to process this client’s data.{" "}
                {data.reasoning.connected && !data.reasoning.local
                  ? `Questions and relevant document excerpts are sent to ${data.reasoning.provider}.`
                  : "No outside AI model receives it."}{" "}
                Any recording goes to the speech provider set up here.
              </span>
            </label>
            <div className="vd-compose-actions">
              {hearing ? (
                <Recorder
                  onFile={recorded}
                  onError={setNotice}
                  disabled={readOnly || busy}
                />
              ) : dictationSupported ? (
                <Dictation
                  onText={(t) => setQuestion((q) => (q.trim() ? `${q.trim()} ${t}` : t))}
                  onError={setNotice}
                  disabled={readOnly || busy}
                />
              ) : (
                <button
                  type="button"
                  className="vd-record"
                  onClick={() =>
                    isAdmin
                      ? goTo("settings")
                      : setNotice("Recording needs VoiceStudio. Ask a workspace admin to connect it, or type your question.")
                  }
                >
                  ● Record voice
                  <small>Needs VoiceStudio · tap to {isAdmin ? "connect" : "learn more"}</small>
                </button>
              )}
              <div className="vd-audio-input">
                {hearing && (
                  <label className="vd-text-button">
                    Or upload audio
                    <input
                      type="file"
                      accept="audio/*"
                      disabled={readOnly}
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                  </label>
                )}
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
            {file && !consent ? (
              <p className="vd-muted vd-compose-hint" role="status">
                Recording kept. Tick the box above, then create the reply.
              </p>
            ) : (
              !busy &&
              !readOnly &&
              missing.length > 0 && (
                <p className="vd-muted vd-compose-hint">To create a reply: {missing.join(", ")}.</p>
              )
            )}
            {!hearing && dictationSupported && (
              <p className="vd-muted vd-compose-hint">
                VoiceStudio cannot transcribe yet, so your browser turns speech into text
                {/(Chrome|CriOS|Edg)\//.test(navigator.userAgent) ? " using Google’s speech service" : ""}.
                Check the words before sending.
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
            <DocumentsPanel
              clientId={clientId}
              client={selected}
              docs={docs.data}
              busy={busy}
              readOnly={readOnly}
              canDeleteClient={isAdmin}
              act={act}
              clientDeleted={async () => {
                await reload();
                setClientId("");
              }}
            />
          </div>
          <div className="vd-tabpanel" role="tabpanel" id="vd-panel-voices" aria-labelledby="vd-tab-voices" hidden={tab !== "voices"}>
            <VoiceProfiles
              data={data}
              cloning={cloning}
              isAdmin={isAdmin}
              openSettings={() => goTo("settings")}
              done={setupDone}
              report={setNotice}
              readOnly={readOnly}
            />
          </div>
          {canAdmin(me) && (
            <div className="vd-tabpanel" role="tabpanel" id="vd-panel-settings" aria-labelledby="vd-tab-settings" hidden={tab !== "settings"}>
              <SpeechSettings speech={data.speech} status={ready?.cloning} done={setupDone} report={setNotice} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
