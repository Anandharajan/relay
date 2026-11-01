import { useState } from "react";
import { api } from "../../lib/api";
import { Recorder } from "./Recorder";
import type { Profile, Speech } from "./model";
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
