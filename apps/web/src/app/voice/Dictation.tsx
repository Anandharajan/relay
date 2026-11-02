import { useEffect, useRef, useState } from "react";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
const Recognizer = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
  .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

/** Whether this browser can turn speech into text by itself. */
export const dictationSupported = !!Recognizer;

/**
 * Speaking a question when the workspace has no transcription service: the browser's own speech
 * recognition types it into the box, where the person can check it before sending.
 */
export function Dictation({
  onText,
  onError,
  disabled = false,
}: {
  onText: (text: string) => void;
  onError: (e: string) => void;
  disabled?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const deliver = useRef(onText);
  deliver.current = onText;
  useEffect(() => () => recognition.current?.stop(), []);
  function start() {
    if (!Recognizer || disabled) return;
    const r = new Recognizer();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++)
        if (e.results[i]!.isFinal) text += e.results[i]![0].transcript;
      if (text.trim()) deliver.current(text.trim());
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted")
        onError(
          e.error === "not-allowed"
            ? "Microphone permission was refused. Allow it in the browser, or type your question."
            : `Speech recognition stopped (${e.error}). Type your question instead.`,
        );
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    r.start();
    setListening(true);
  }
  return (
    <button
      type="button"
      disabled={disabled}
      className={"vd-record " + (listening ? "recording" : "")}
      onClick={() => (listening ? recognition.current?.stop() : start())}
    >
      {listening ? "■ Stop speaking" : "● Speak your question"}
      <small>
        {listening ? "Words appear in the box as you talk" : "Your browser types what you say"}
      </small>
    </button>
  );
}
