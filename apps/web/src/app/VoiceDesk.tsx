import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, useApi, useEvents } from "../lib/api";
import { canAdmin, useSession } from "../lib/session";
import { RunBoard, type Agent, type Run as BoardRun } from "../components/RunBoard";
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
type Profile = {
  id: string;
  name: string;
  provider: string;
  revoked_at: string | null;
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
type Speech = {
  sttUrl: string;
  sttModel: string;
  ttsProvider: string;
  ttsModel: string;
  engine: string;
  voicestudioUrl: string;
  widgetVoice: boolean;
  sttKeySaved: boolean;
  ttsKeySaved: boolean;
  voicestudioKeySaved: boolean;
  localAvailable: boolean;
  privateHostsAllowed: boolean;
  transcriptionAvailable: boolean;
  widgetVoiceActive: boolean;
};
type StudioStatus = {
  state: "connected" | "starting" | "unauthorized" | "unreachable" | "error";
  message: string;
  version: string | null;
  device?: string | null;
  streaming?: boolean;
  activeEngine?: string | null;
  engines?: { id: string; name: string; available: boolean }[];
};
type Bootstrap = {
  clients: Client[];
  voices: Profile[];
  runs: Run[];
  professions: Record<string, string>;
  tasks: Record<string, string>;
  speech: Speech;
};
type Doc = {
  id: string;
  name: string;
  status: string;
  error: string | null;
  chunks: number;
};
function Recorder({
  onFile,
  onError,
  disabled = false,
}: {
  onFile: (f: File) => void;
  onError: (e: string) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);
  async function start() {
    if (starting || disabled) return;
    setStarting(true);
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          "Recording needs HTTPS or localhost and a supported browser. You can upload audio instead.",
        );
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      const mime = ["audio/webm;codecs=opus", "audio/mp4"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const r = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = r;
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        if (timer.current) clearTimeout(timer.current);
        if (alive.current) {
          setRecording(false);
          const type = r.mimeType || "audio/webm";
          onFile(
            new File(
              chunks,
              type.includes("mp4") ? "recording.m4a" : "recording.webm",
              { type },
            ),
          );
        }
      };
      r.onerror = () => {
        stream?.getTracks().forEach((t) => t.stop());
        if (timer.current) clearTimeout(timer.current);
        if (alive.current) {
          setRecording(false);
          onError("Recording failed. Try uploading an audio file.");
        }
      };
      r.start();
      setRecording(true);
      timer.current = setTimeout(() => {
        if (r.state === "recording") r.stop();
      }, 90000);
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      if (alive.current) onError((e as Error).message);
    } finally {
      if (alive.current) setStarting(false);
    }
  }
  return (
    <button
      type="button"
      disabled={disabled || starting}
      className={"vd-record " + (recording ? "recording" : "")}
      onClick={() => (recording ? recorder.current?.stop() : void start())}
    >
      {starting
        ? "Connecting microphone…"
        : recording
          ? "■ Stop recording"
          : "● Record voice"}
      <small>
        {recording
          ? "Tap to finish · 90s maximum"
          : "Microphone stays off until you tap"}
      </small>
    </button>
  );
}
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
    [panel, setPanel] = useState<"voices" | "settings" | null>(null);
  const docs = useApi<Doc[]>(
    clientId ? `/api/voice/clients/${clientId}/documents` : null,
    [clientId],
  );
  const sync = () => {
    void reload();
    void docs.reload();
  };
  useEvents({ "voice.updated": sync });
  useEffect(() => {
    if (data && !data.clients.some((c) => c.id === clientId))
      setClientId(data.clients[0]?.id || "");
  }, [data, clientId]);
  const active =
    data?.runs.some((r) => !settled.includes(r.status)) || docs.data?.some((d) => ["queued", "processing"].includes(d.status));
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
  return (
    <main className="vd">
      <header className="vd-header">
        <div>
          <div className="vd-eyebrow">RELAY / VOICE WORKSPACE</div>
          <h1>
            Your knowledge.
            <br />
            <span>Your voice.</span>
          </h1>
          <p>
            Turn client files and spoken questions into clear, sourced replies.
          </p>
        </div>
        <div className="vd-header-actions">
          <button
            className="btn"
            onClick={() => setPanel(panel === "voices" ? null : "voices")}
          >
            ◉ My voices{" "}
            <span>{data.voices.filter((v) => !v.revoked_at).length}</span>
          </button>
          {canAdmin(me) && (
            <button
              className="btn"
              onClick={() => setPanel(panel === "settings" ? null : "settings")}
            >
              Voice settings
            </button>
          )}
          <Link className="btn" to="/app/settings/model">
            AI settings ↗
          </Link>
        </div>
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
      {panel === "voices" && (
        <VoiceProfiles
          data={data}
          done={sync}
          report={setNotice}
          readOnly={readOnly}
        />
      )}
      {panel === "settings" && canAdmin(me) && (
        <SpeechSettings speech={data.speech} done={sync} report={setNotice} />
      )}
      <div className="vd-workbench">
        <aside className="vd-card vd-files">
          <div className="vd-eyebrow">01 / CONTEXT</div>
          <h2>Who is this for?</h2>
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
          <details open={!data.clients.length}>
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
          <div className="vd-divider" />
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
        </aside>
        <section className="vd-card vd-compose">
          <div className="vd-eyebrow">02 / ASK YOUR AGENT</div>
          <h2>Speak naturally. Get to work.</h2>
          <div className="vd-two">
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
              What do you need?
              <select value={task} onChange={(e) => setTask(e.target.value)}>
                {Object.entries(data.tasks).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Recorder
            onFile={setFile}
            onError={setNotice}
            disabled={readOnly || busy}
          />
          <div className="vd-audio-input">
            <label className="vd-text-button">
              Or upload audio
              <input
                type="file"
                accept="audio/*"
                disabled={readOnly}
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
          <label>
            Question or instructions
            <textarea
              rows={4}
              maxLength={6000}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What should I explain to this client? Ask a question, request a summary, or describe a reply."
            />
          </label>
          <label>
            Reply voice
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              <option value="">Text only · no cloned voice</option>
              {data.voices
                .filter((v) => !v.revoked_at)
                .map((v) => (
                  <option value={v.id} key={v.id}>
                    {v.name} · {v.provider}
                  </option>
                ))}
            </select>
          </label>
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
          <button
            className="vd-primary"
            disabled={
              busy ||
              readOnly ||
              !clientId ||
              !consent ||
              (!file && question.trim().length < 3)
            }
            onClick={() =>
              void act(async () => {
                const f = new FormData();
                f.set("clientId", clientId);
                f.set("profession", profession);
                f.set("task", task);
                f.set("question", question);
                f.set("voiceId", voice);
                f.set("providerConsent", "yes");
                if (file) f.set("file", file);
                await api("/api/voice/runs", { form: f });
                setQuestion("");
                setFile(null);
              })
            }
          >
            {busy ? "Working…" : "Create reply →"}
          </button>
          <p className="vd-muted">
            Healthcare, HR, advisory and client replies pause for your review.
            Nothing is sent to clients automatically.
          </p>
        </section>
      </div>
      <section className="vd-results">
        <div className="vd-eyebrow">03 / REVIEW, LISTEN & DOWNLOAD</div>
        <h2>Replies for {selected?.name || "your clients"}</h2>
        {data.runs
          .filter((r) => r.client_id === clientId)
          .map((r) => (
            <Reply
              key={r.id}
              run={r}
              disabled={busy || readOnly}
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
        {!data.runs.some((r) => r.client_id === clientId) && (
          <div className="vd-card vd-empty">
            Your first reply starts with a client, a file and a question.
            <br />
            You’ll see the sources, processing steps and audio here.
          </div>
        )}
      </section>
    </main>
  );
}
function Reply({
  run: r,
  disabled,
  approve,
  clarify,
  remove,
}: {
  run: Run;
  disabled: boolean;
  approve: (s: string) => Promise<void>;
  clarify: (s: string) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(r.answer);
  const [clarification, setClarification] = useState("");
  useEffect(() => setDraft(r.answer), [r.answer]);
  const review = ["review", "audio_failed", "ready_text"].includes(r.status);
  const agents = r.steps.filter((s) => s.id) as Agent[];
  const board: BoardRun = {
    id: r.id,
    kind: "message",
    title: r.question,
    status: settled.includes(r.status)
      ? r.status === "failed"
        ? "failed"
        : "done"
      : "running",
    stages,
    agents,
    report: [],
    ms: agents.reduce((sum, a) => sum + (a.ms ?? 0), 0),
  };
  return (
    <article className="vd-card vd-reply">
      <div className="vd-reply-head">
        <span className={"vd-status " + r.status}>
          {r.status.replaceAll("_", " ")}
        </span>
        <button
          className="vd-text-button"
          disabled={disabled}
          onClick={() => void remove()}
        >
          Delete reply
        </button>
      </div>
      <h3>{r.question || "Processing your voice question…"}</h3>
      {r.error && (
        <p role="alert" className="vd-alert">
          {r.error}
        </p>
      )}
      {agents.length > 0 && !settled.includes(r.status) && (
        <RunBoard run={board} boardOnly />
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
      <details>
        <summary>
          {r.citations.length} source passages · {r.steps.length} agent steps
        </summary>
        {agents.length > 0 && settled.includes(r.status) && (
          <RunBoard run={board} boardOnly />
        )}
        {r.citations.map((c) => (
          <blockquote key={c.n}>
            <strong>
              [{c.n}] {c.title}
            </strong>
            <p>{c.excerpt}</p>
          </blockquote>
        ))}
        {!agents.length && (
          <ol>
            {r.steps.map((s, i) => (
              <li key={i}>{s.label}</li>
            ))}
          </ol>
        )}
      </details>
    </article>
  );
}
function VoiceProfiles({
  data,
  done,
  report,
  readOnly,
}: {
  data: Bootstrap;
  done: () => void;
  report: (s: string) => void;
  readOnly: boolean;
}) {
  const [file, setFile] = useState<File | null>(null),
    [name, setName] = useState("My voice"),
    [challenge, setChallenge] = useState<{ id: string; phrase: string } | null>(
      null,
    ),
    [own, setOwn] = useState(false),
    [provider, setProvider] = useState(false),
    [busy, setBusy] = useState(false);
  const newPhrase = async () => {
    setFile(null);
    setChallenge(await api("/api/voice/profiles/challenge", { body: {} }));
  };
  return (
    <section className="vd-card vd-panel">
      <div className="vd-eyebrow">YOUR VOICE, WITH YOUR PERMISSION</div>
      <h2>Create your reply voice</h2>
      <p>
        To protect everyone’s voice, enrollment needs a live recording: read a
        one-time phrase aloud and we match the recording to it. Enrollment uses{" "}
        {data.speech.ttsProvider === "none"
          ? "a speech engine you must configure first"
          : data.speech.ttsProvider}
        . You can revoke your voice at any time.
      </p>
      <div className="vd-two">
        <div>
          {challenge ? (
            <>
              <blockquote className="vd-phrase">{challenge.phrase}</blockquote>
              <Recorder
                onFile={setFile}
                onError={report}
                disabled={readOnly || busy}
              />
              <p role="status">
                {file
                  ? "Recording captured. Record again to replace it."
                  : "Read the whole phrase in a quiet room. It expires in 5 minutes."}
              </p>
            </>
          ) : (
            <button
              className="btn"
              disabled={
                readOnly ||
                busy ||
                data.speech.ttsProvider === "none" ||
                !data.speech.transcriptionAvailable
              }
              onClick={() =>
                void newPhrase().catch((e) => report((e as Error).message))
              }
            >
              Get my phrase
            </button>
          )}
          {!data.speech.transcriptionAvailable && (
            <p className="vd-muted">
              Enrollment needs transcription to check the recording. Connect it
              in Voice settings.
            </p>
          )}
        </div>
        <div>
          <label>
            Voice name
            <input
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
      </div>
      <label className="vd-check">
        <input
          type="checkbox"
          checked={own}
          onChange={(e) => setOwn(e.target.checked)}
        />
        This recording is my own voice. I authorize its cloning for my replies.
      </label>
      <label className="vd-check">
        <input
          type="checkbox"
          checked={provider}
          onChange={(e) => setProvider(e.target.checked)}
        />
        I allow the configured speech provider to process and store this sample
        as required to generate my voice.
      </label>
      <button
        className="btn primary"
        disabled={
          busy ||
          readOnly ||
          !file ||
          !challenge ||
          !own ||
          !provider
        }
        onClick={async () => {
          setBusy(true);
          try {
            const f = new FormData();
            f.set("file", file!);
            f.set("name", name);
            f.set("challengeId", challenge!.id);
            f.set("consent", "live-phrase-v2");
            f.set("providerConsent", "yes");
            await api("/api/voice/profiles", { form: f });
            setFile(null);
            setChallenge(null);
            setOwn(false);
            setProvider(false);
            report("Voice enrolled. Select it when creating a reply.");
            done();
          } catch (e) {
            report((e as Error).message);
            // Each phrase allows one attempt, so a failed one needs a fresh phrase.
            setChallenge(null);
            setFile(null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Enrolling your voice…" : "Create my voice"}
      </button>
      <div>
        {data.voices.map((v) => (
          <div className="vd-doc" key={v.id}>
            <span>
              {v.name} · {v.provider} {v.revoked_at && "· revoked"}
            </span>
            {!v.revoked_at && (
              <button
                className="btn"
                disabled={busy || readOnly}
                onClick={async () => {
                  if (
                    !confirm(
                      "Revoke this voice and remove access to all its generated audio?",
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    const result = await api(`/api/voice/profiles/${v.id}`, {
                      method: "DELETE",
                    });
                    report(
                      result.warning ||
                        "Voice revoked and generated audio removed.",
                    );
                    done();
                  } catch (e) {
                    report((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
function SpeechSettings({
  speech,
  done,
  report,
}: {
  speech: Speech;
  done: () => void;
  report: (s: string) => void;
}) {
  const [s, setS] = useState(speech),
    [sttKey, setSttKey] = useState(""),
    [ttsKey, setTtsKey] = useState(""),
    [studioKey, setStudioKey] = useState(""),
    [studio, setStudio] = useState<StudioStatus | null>(null),
    [busy, setBusy] = useState(false);
  const field = (k: keyof Speech, v: string) => setS((p) => ({ ...p, [k]: v }));
  const save = async () => {
    await api("/api/voice/settings", {
      method: "PUT",
      body: {
        sttUrl: s.sttUrl,
        sttModel: s.sttModel,
        ttsProvider: s.ttsProvider,
        ttsModel: s.ttsModel,
        engine: s.engine,
        voicestudioUrl: s.voicestudioUrl,
        widgetVoice: s.widgetVoice,
        sttKey,
        ttsKey,
        voicestudioKey: studioKey,
      },
    });
    setSttKey("");
    setTtsKey("");
    setStudioKey("");
  };
  return (
    <form
      className="vd-card vd-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await save();
          report("Voice settings saved.");
          done();
        } catch (e) {
          report((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Speech connections</h2>
      <p>
        Voice enrollment and audio generation require a connected engine; no
        synthetic demo audio is substituted.
      </p>
      <fieldset className="vd-studio">
        <legend>
          <a
            href="https://github.com/debpalash/VoiceStudio"
            target="_blank"
            rel="noreferrer"
          >
            VoiceStudio ↗
          </a>{" "}
          · open-source cloning and transcription you host yourself
        </legend>
        <div className="vd-two">
          <label>
            Server URL
            <input
              type="url"
              value={s.voicestudioUrl}
              placeholder={
                speech.localAvailable
                  ? "Blank uses the operator’s VoiceStudio"
                  : speech.privateHostsAllowed
                    ? "http://voicestudio:3900"
                    : "https://voicestudio.example.com"
              }
              onChange={(e) => field("voicestudioUrl", e.target.value)}
            />
          </label>
          <label>
            API key (OMNIVOICE_API_KEY) {speech.voicestudioKeySaved && "· saved"}
            <input
              type="password"
              autoComplete="new-password"
              value={studioKey}
              onChange={(e) => setStudioKey(e.target.value)}
              placeholder="Leave blank to keep saved key"
            />
          </label>
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setStudio(null);
            try {
              await save();
              setStudio(await api("/api/voice/voicestudio/status"));
              done();
            } catch (e) {
              report((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save and test connection
        </button>
        {studio && (
          <div className={"vd-studio-status " + studio.state} role="status">
            <strong>{studio.message}</strong>
            {studio.state === "connected" && (
              <small>
                VoiceStudio {studio.version} · {studio.device ?? "unknown device"}{" "}
                · active engine {studio.activeEngine ?? "none"}
                {studio.streaming ? " · streaming transcription available" : ""}
              </small>
            )}
          </div>
        )}
        <label>
          Cloning engine
          {studio?.engines?.length ? (
            <select
              value={s.engine}
              onChange={(e) => field("engine", e.target.value)}
            >
              <option value="">VoiceStudio default (omnivoice)</option>
              {studio.engines.map((engine) => (
                <option key={engine.id} value={engine.id}>
                  {engine.name}
                  {engine.available ? "" : " · not installed"}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={s.engine}
              onChange={(e) => field("engine", e.target.value)}
              placeholder="Test the connection to list engines"
            />
          )}
        </label>
      </fieldset>
      <div className="vd-two">
        <label>
          Transcription base URL
          <input
            type="url"
            value={s.sttUrl}
            placeholder="https://api.openai.com/v1 (blank uses VoiceStudio)"
            onChange={(e) => field("sttUrl", e.target.value)}
          />
        </label>
        <label>
          Transcription model
          <input
            required
            value={s.sttModel}
            onChange={(e) => field("sttModel", e.target.value)}
          />
        </label>
        <label>
          Transcription API key {speech.sttKeySaved && "· saved"}
          <input
            type="password"
            autoComplete="new-password"
            value={sttKey}
            onChange={(e) => setSttKey(e.target.value)}
            placeholder="Leave blank to keep saved key"
          />
        </label>
        <label>
          Cloning provider
          <select
            value={s.ttsProvider}
            onChange={(e) => field("ttsProvider", e.target.value)}
          >
            <option value="none">Not connected</option>
            <option value="voicestudio">VoiceStudio</option>
            <option value="elevenlabs">ElevenLabs (BYOK)</option>
          </select>
        </label>
        <label>
          ElevenLabs API key {speech.ttsKeySaved && "· saved"}
          <input
            type="password"
            autoComplete="new-password"
            value={ttsKey}
            onChange={(e) => setTtsKey(e.target.value)}
          />
        </label>
        <label>
          ElevenLabs speech model
          <input
            value={s.ttsModel}
            onChange={(e) => field("ttsModel", e.target.value)}
          />
        </label>
      </div>
      <label className="vd-check">
        <input
          type="checkbox"
          checked={s.widgetVoice}
          onChange={(e) =>
            setS((p) => ({ ...p, widgetVoice: e.target.checked }))
          }
        />
        <span>
          Let website chat visitors use the microphone. Each recording is sent
          to this workspace’s transcription service and counts against it.
          {speech.widgetVoice &&
            !speech.widgetVoiceActive &&
            " The microphone stays hidden until this workspace connects its own transcription or VoiceStudio."}
        </span>
      </label>
      <button className="btn primary" disabled={busy}>
        Save speech settings
      </button>
      <p className="vd-muted">
        API keys, original uploads and generated audio are encrypted at rest.
        Search passages and reply text remain in the access-controlled database.
      </p>
    </form>
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
