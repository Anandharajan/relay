import { useEffect, useRef, useState } from "react";
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
