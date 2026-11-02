import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Recorder } from "./Recorder";
import type { Profile, Speech } from "./model";
export function VoiceProfiles({
  data,
  cloning,
  isAdmin,
  openSettings,
  done,
  report,
  readOnly,
}: {
  data: { voices: Profile[]; speech: Speech };
  /** Whether VoiceStudio (or another cloning engine) answers right now. */
  cloning: { ok: boolean; detail: string };
  isAdmin: boolean;
  openSettings: () => void;
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
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState("");
  // Let the person hear their take before it is sent for cloning.
  useEffect(() => {
    if (!file) return setPreview("");
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const engineName =
    data.speech.ttsProvider === "voicestudio" ? "VoiceStudio" : data.speech.ttsProvider;
  const blocker =
    data.speech.ttsProvider === "none"
      ? "No cloning engine is connected yet."
      : !data.speech.transcriptionAvailable
        ? "Enrollment checks your recording against the phrase, which needs VoiceStudio’s transcription."
        : !cloning.ok
          ? /no model yet/.test(cloning.detail)
            ? cloning.detail
            : `${engineName} is not answering: ${cloning.detail}`
          : "";
  const newPhrase = async () => {
    setFile(null);
    setChallenge(await api("/api/voice/profiles/challenge", { body: {} }));
  };
  const missing = [
    !challenge && "get a phrase",
    challenge && !file && "record yourself reading it",
    !own && "confirm it is your own voice",
    !provider && `allow ${engineName} to process it`,
  ].filter(Boolean);
  const live = data.voices.filter((v) => !v.revoked_at);
  return (
    <section className="vd-card vd-panel">
      <div className="vd-eyebrow">YOUR VOICE, WITH YOUR PERMISSION</div>
      <h2>{live.length ? "Your cloned voices" : "Clone your voice"}</h2>
      <p>
        Replies you approve are spoken in this voice by {engineName === "none" ? "VoiceStudio" : engineName}.
        To protect everyone’s voice, you read a one-time phrase aloud and we check it before cloning.
        You can revoke your voice at any time.
      </p>
      {blocker && (
        <div className="vd-blocked" role="status">
          <strong>Cloning is not available yet.</strong> {blocker}{" "}
          {isAdmin ? (
            <button type="button" className="vd-text-button" onClick={openSettings}>
              Connect VoiceStudio
            </button>
          ) : (
            "Ask a workspace admin to connect VoiceStudio."
          )}
        </div>
      )}
      <ol className="vd-steps">
        <li className={challenge ? "done" : ""}>
          <strong>Get a phrase to read</strong>
          {challenge ? (
            <blockquote className="vd-phrase">{challenge.phrase}</blockquote>
          ) : (
            <button
              className="btn"
              disabled={readOnly || busy || !!blocker}
              onClick={() =>
                void newPhrase().catch((e) => report((e as Error).message))
              }
            >
              Get my phrase
            </button>
          )}
        </li>
        <li className={file ? "done" : ""}>
          <strong>Record yourself reading it</strong>
          <small>Read the whole phrase in a quiet room, at your normal pace. It expires in 5 minutes.</small>
          <Recorder
            onFile={setFile}
            onError={report}
            disabled={readOnly || busy || !challenge}
          />
          {preview && (
            <div className="vd-preview">
              <audio controls src={preview} />
              <small>Listen back. Record again to replace it.</small>
            </div>
          )}
        </li>
        <li className={own && provider ? "done" : ""}>
          <strong>Confirm your permission</strong>
          <label>
            Voice name
            <input
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="vd-check">
            <input
              type="checkbox"
              checked={own}
              onChange={(e) => setOwn(e.target.checked)}
            />
            <span>This recording is my own voice. I authorize its cloning for my replies.</span>
          </label>
          <label className="vd-check">
            <input
              type="checkbox"
              checked={provider}
              onChange={(e) => setProvider(e.target.checked)}
            />
            <span>
              I allow {engineName === "none" ? "the speech engine" : engineName} to process and
              store this sample as required to generate my voice.
            </span>
          </label>
        </li>
        <li>
          <strong>Create your voice</strong>
          <button
            className="btn primary"
            disabled={busy || readOnly || missing.length > 0}
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
                report("Voice cloned. New replies use it when you approve them.");
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
            {busy ? "Cloning your voice…" : "Clone my voice"}
          </button>
          {!busy && missing.length > 0 && !readOnly && !blocker && (
            <small>To continue: {missing.join(", ")}.</small>
          )}
        </li>
      </ol>
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
