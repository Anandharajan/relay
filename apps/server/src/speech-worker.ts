import { pathToFileURL } from 'node:url';

/**
 * Runs on the voice computer. Connects out to the hosted app, takes its queued VoiceStudio
 * requests, sends them to the local inference gateway and posts the answers back. It opens no
 * port, and only speech routes are forwarded; the gateway still decides which of those it serves.
 */
export interface WorkerConfig {
  relayUrl: string;
  secret: string;
  gatewayUrl: string;
  gatewayKey: string;
  /** Requests handled at once; VoiceStudio on a CPU gains nothing from more. */
  concurrency?: number;
  log?: (message: string) => void;
}

type Job = { id: string; method: string; path: string; contentType: string | null; body: string | null };

export async function handleJob(job: Job, config: WorkerConfig) {
  if (!/^\/speech\//.test(job.path) || !['GET', 'POST', 'DELETE'].includes(job.method))
    return { status: 403, contentType: 'application/json', body: Buffer.from('{"error":"Only speech routes are forwarded"}').toString('base64') };
  try {
    const headers: Record<string, string> = { authorization: `Bearer ${config.gatewayKey}` };
    if (job.contentType) headers['content-type'] = job.contentType;
    const upstream = await fetch(config.gatewayUrl.replace(/\/+$/, '') + job.path, {
      method: job.method,
      headers,
      body: job.body ? Buffer.from(job.body, 'base64') : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(300_000),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    return { status: upstream.status, contentType: upstream.headers.get('content-type'), body: body.length ? body.toString('base64') : null };
  } catch (e) {
    config.log?.(`[speech-worker] gateway request failed: ${(e as Error).message}`);
    return { status: 502, contentType: 'application/json', body: Buffer.from('{"error":"The voice computer could not reach VoiceStudio"}').toString('base64') };
  }
}

export async function runWorker(config: WorkerConfig, stop: AbortSignal = new AbortController().signal) {
  if (config.secret.length < 32) throw new Error('SPEECH_WORKER_SECRET needs at least 32 characters.');
  const relay = config.relayUrl.replace(/\/+$/, '') + '/api/speech-worker';
  const auth = { authorization: `Bearer ${config.secret}` };
  const limit = config.concurrency ?? 2;
  let active = 0;
  let failures = 0;
  while (!stop.aborted) {
    if (active >= limit) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    try {
      const res = await fetch(relay + '/next', { headers: auth, signal: AbortSignal.any([stop, AbortSignal.timeout(40_000)]) });
      if (res.status === 204) { failures = 0; continue; }
      if (!res.ok) throw new Error(`relay answered ${res.status}`);
      failures = 0;
      const job = (await res.json()) as Job;
      active++;
      void handleJob(job, config)
        .then((result) => fetch(`${relay}/result/${encodeURIComponent(job.id)}`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify(result),
          signal: AbortSignal.timeout(60_000),
        }))
        .catch((e) => config.log?.(`[speech-worker] could not return a result: ${(e as Error).message}`))
        .finally(() => active--);
    } catch (e) {
      if (stop.aborted) break;
      failures++;
      config.log?.(`[speech-worker] ${(e as Error).message}; retrying`);
      // Back off up to a minute while the hosted app sleeps or restarts.
      await new Promise((r) => setTimeout(r, Math.min(60_000, 1000 * 2 ** Math.min(failures, 6))));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config: WorkerConfig = {
    relayUrl: process.env.RELAY_URL ?? '',
    secret: process.env.SPEECH_WORKER_SECRET ?? '',
    gatewayUrl: process.env.GATEWAY_URL ?? 'http://inference-gateway:8790',
    gatewayKey: process.env.INFERENCE_GATEWAY_SECRET ?? '',
    log: (m) => console.log(m),
  };
  if (!config.relayUrl.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1|app)(:|\/|$)/.test(config.relayUrl))
    throw new Error('RELAY_URL must be the hosted app’s https:// address.');
  console.log(`[speech-worker] connecting out to ${new URL(config.relayUrl).host}`);
  await runWorker(config);
}
