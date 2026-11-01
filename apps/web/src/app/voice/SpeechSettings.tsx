import { useState } from "react";
import { api } from "../../lib/api";
import type { Speech, StudioStatus } from "./model";
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
