import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { timingSafeEqual } from "node:crypto";
import { uuid } from "./crypto.ts";
import { PermanentError } from "./permanent-error.ts";

/**
 * Speech for a server that cannot reach the voice computer, such as a hosted web service in front
 * of a VoiceStudio at home. The voice computer runs a worker that connects out to this server,
 * collects queued VoiceStudio requests and posts the answers back, so nothing on it accepts
 * connections from the internet. An operator opts in with VOICESTUDIO_URL=worker://relay/speech.
 */
type Job = {
  id: string;
  method: string;
  path: string;
  contentType: string | null;
  body: string | null;
  resolve: (r: Response) => void;
  reject: (e: Error) => void;
  release: () => void;
};
const queued: Job[] = [];
const taken = new Map<string, Job>();
const listeners = new Set<() => void>();
let lastSeen = 0;
const maxBody = 22 * 1024 * 1024;
/** A worker long-polls for 25 seconds, so one silent for longer than this is gone. */
const workerGrace = 45_000;

export const isRelayUrl = (url: string) => url.startsWith("worker://");
export const relayConnected = () => Date.now() - lastSeen < workerGrace;

/** `fetch` for speech calls: ordinary URLs go out directly, `worker://` ones wait for the worker. */
export async function speechFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isRelayUrl(url)) return fetch(url, init);
  if (!relayConnected())
    throw new Error("The voice computer is not connected. Start its speech worker and keep it online.");
  const target = new URL(url.replace(/^worker:/, "http:"));
  const request = new Request(`http://relay${target.pathname}${target.search}`, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
  });
  const body = init.body ? Buffer.from(await request.arrayBuffer()) : null;
  if (body && body.length > maxBody) throw new PermanentError("Audio is too large to send to the voice computer.");
  return new Promise<Response>((resolve, reject) => {
    const signal = init.signal;
    const job: Job = {
      id: uuid(),
      method: request.method,
      path: `${target.pathname}${target.search}`,
      contentType: request.headers.get("content-type"),
      body: body?.toString("base64") ?? null,
      resolve,
      reject,
      release: () => signal?.removeEventListener("abort", abort),
    };
    function abort() {
      const i = queued.indexOf(job);
      if (i >= 0) queued.splice(i, 1);
      taken.delete(job.id);
      const e = new Error("The voice computer did not answer in time.");
      e.name = "TimeoutError";
      reject(e);
    }
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    queued.push(job);
    for (const wake of listeners) wake();
  });
}

function authorized(header: string | undefined) {
  const secret = process.env.SPEECH_WORKER_SECRET ?? "";
  if (secret.length < 32) return false;
  const supplied = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/** Endpoints for the voice computer's worker. Disabled unless SPEECH_WORKER_SECRET is set. */
export const speechWorkerApi = new Hono();
speechWorkerApi.use("*", async (c, next) => {
  if ((process.env.SPEECH_WORKER_SECRET ?? "").length < 32) return c.json({ error: "Not found" }, 404);
  if (!authorized(c.req.header("authorization"))) return c.json({ error: "Unauthorized" }, 401);
  lastSeen = Date.now();
  await next();
});
/** Long poll: the next request for VoiceStudio, or 204 after 25 seconds with nothing to do. */
speechWorkerApi.get("/next", async (c) => {
  let job = queued.shift();
  if (!job) {
    await new Promise<void>((resolve) => {
      const done = () => {
        listeners.delete(done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 25_000);
      listeners.add(done);
    });
    lastSeen = Date.now();
    job = queued.shift();
  }
  if (!job) return c.body(null, 204);
  taken.set(job.id, job);
  return c.json(
    { id: job.id, method: job.method, path: job.path, contentType: job.contentType, body: job.body },
    200,
    { "cache-control": "no-store" },
  );
});
speechWorkerApi.post("/result/:id", bodyLimit({ maxSize: 32 * 1024 * 1024 }), async (c) => {
  const job = taken.get(c.req.param("id"));
  if (!job) return c.json({ error: "Unknown or expired request" }, 404);
  taken.delete(job.id);
  job.release();
  const result = (await c.req.json()) as { status?: number; contentType?: string | null; body?: string | null };
  const status = Number.isInteger(result.status) && result.status! >= 200 && result.status! <= 599 ? result.status! : 502;
  const headers = new Headers();
  if (typeof result.contentType === "string") headers.set("content-type", result.contentType);
  job.resolve(
    new Response(status === 204 || !result.body ? null : Buffer.from(result.body, "base64"), { status, headers }),
  );
  return c.json({ ok: true });
});
