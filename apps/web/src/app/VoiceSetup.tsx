import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export type Profile = {
  id: string;
  name: string;
  provider: string;
  revoked_at: string | null;
};
export type Speech = {
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
export function Recorder({
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
  // A recording can outlast the render that started it; deliver it to the current handler.
  const deliver = useRef(onFile);
  deliver.current = onFile;
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
          deliver.current(
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
export function VoiceProfiles({
  data,
  done,
  report,
  readOnly,
}: {
  data: { voices: Profile[]; speech: Speech };
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
export function SpeechSettings({
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
