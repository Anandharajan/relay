import { useState } from "react";
import { api } from "../../lib/api";
import type { Speech, StudioStatus } from "./model";
export function SpeechSettings({
  speech,
  status,
  done,
  report,
}: {
  speech: Speech;
  /** The live check of the cloning engine, so this tab says what is wrong before anyone tests. */
  status?: { ok: boolean; detail: string };
  done: () => void;
  report: (s: string) => void;
}) {
  const [s, setS] = useState(speech),
    [studioKey, setStudioKey] = useState(""),
    [studio, setStudio] = useState<StudioStatus | null>(null),
    [busy, setBusy] = useState(false);
  const field = (k: keyof Speech, v: string) => setS((p) => ({ ...p, [k]: v }));
  // VoiceStudio does all the speech work: saving clears any other transcription or cloning provider.
  const save = async (ttsProvider = s.ttsProvider === "none" ? "none" : "voicestudio") => {
    await api("/api/voice/settings", {
      method: "PUT",
      body: {
        sttUrl: "",
        sttModel: s.sttModel,
        ttsProvider,
        ttsModel: s.ttsModel,
        engine: s.engine,
        voicestudioUrl: s.voicestudioUrl,
        widgetVoice: s.widgetVoice,
        voicestudioKey: studioKey,
      },
    });
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
      <h2>Connect VoiceStudio</h2>
      <p>
        VoiceStudio does the voice work: it turns recorded questions into text,
        clones each person’s voice and speaks approved replies in it. No
        synthetic stand-in audio is ever used.
      </p>
      {status && (
        <p className={status.ok ? "vd-studio-status connected" : "vd-blocked"} role="status">
          <strong>{status.ok ? "Ready: " : "Not ready yet: "}</strong>
          {status.detail}
        </p>
      )}
      <details className="vd-howto">
        <summary>How to run VoiceStudio</summary>
        <ol>
          <li>
            On the computer that runs Relay, start it beside the app:
            <code>docker compose --env-file .env.voice -f deploy/docker-compose.voice.yml --profile voicestudio up -d voicestudio</code>
          </li>
          <li>
            Open <code>http://localhost:3900</code> on that computer, download a speech-to-text model and a
            cloning engine, and accept their licences yourself. Pick an engine whose licence allows your use.
          </li>
          <li>
            Here, enter <code>http://voicestudio:3900</code> and its <code>OMNIVOICE_API_KEY</code>, then
            press <em>Save, test and use VoiceStudio</em>.
          </li>
        </ol>
        <p className="vd-muted">
          A VoiceStudio on another server needs an HTTPS address the operator has allowed. It runs on a
          CPU, slowly; a GPU makes cloned replies much faster.
        </p>
      </details>
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
              const status: StudioStatus = await api("/api/voice/voicestudio/status");
              setStudio(status);
              // A working VoiceStudio becomes the cloning engine unless another one was chosen on purpose.
              if (status.state === "connected" && s.ttsProvider === "none") {
                await save("voicestudio");
                setS((p) => ({ ...p, ttsProvider: "voicestudio" }));
                report("VoiceStudio is connected and now clones voices for this workspace.");
              }
              done();
            } catch (e) {
              report((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save, test and use VoiceStudio
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
              <option value="">VoiceStudio’s active engine</option>
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
