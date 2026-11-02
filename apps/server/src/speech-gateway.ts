import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { open, stat } from 'node:fs/promises';

export interface GatewayConfig {
  secret: string;
  speechUrl: string;
  speechKey: string;
  llmUrl: string;
  llmKey: string;
  /** Read-only, pinned PocketTTS 2.1.0 English cache files. Never client-supplied. */
  pocketFiles?: { weights: string; tokenizer: string };
}

export async function completeSafetensors(path: string) {
  let file;
  try {
    file = await open(path, 'r');
    const size = (await file.stat()).size;
    const prefix = Buffer.alloc(8);
    if ((await file.read(prefix, 0, 8, 0)).bytesRead !== 8) return false;
    const length = Number(prefix.readBigUInt64LE());
    if (!Number.isSafeInteger(length) || length < 2 || length > 4 * 1024 * 1024 || 8 + length >= size) return false;
    const bytes = Buffer.alloc(length);
    if ((await file.read(bytes, 0, length, 8)).bytesRead !== length) return false;
    const header = JSON.parse(bytes.toString());
    const tensors = Object.entries(header).filter(([key]) => key !== '__metadata__').map(([, value]) => value as any);
    return tensors.length > 0 && tensors.every((t) => Array.isArray(t.data_offsets) && t.data_offsets.length === 2 && t.data_offsets.every(Number.isSafeInteger) && t.data_offsets[0] >= 0 && t.data_offsets[1] > t.data_offsets[0] && t.data_offsets[1] <= size - 8 - length) && Math.max(...tensors.map((t) => t.data_offsets[1])) === size - 8 - length;
  } catch { return false; }
  finally { await file?.close(); }
}

/** Public bridge exposes inference and enrolled-profile operations, never engine administration. */
export function buildSpeechGateway(config: GatewayConfig) {
  if (config.secret.length < 32 || !config.speechKey || !config.llmKey)
    throw new Error('Gateway and upstream keys must be configured; gateway secret needs at least 32 characters.');
  const app = new Hono();
  app.use('*', async (c, next) => {
    const supplied = Buffer.from(c.req.header('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${config.secret}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return c.json({ error: 'Unauthorized' }, 401);
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 22 * 1024 * 1024 }));
  app.get('/healthz', (c) => c.json({ status: 'ok', service: 'relay-inference-gateway' }));
  app.all('*', async (c) => {
    const path = c.req.path;
    const method = c.req.method;
    const speechPath = path.startsWith('/speech/') ? path.slice('/speech'.length) : '';
    const speechRead = method === 'GET' && ['/health', '/.well-known/voicestudio-speech', '/engines/tts', '/engines/asr', '/models'].includes(speechPath);
    const speechWrite = method === 'POST' && (
      ['/profiles', '/v1/audio/transcriptions', '/v1/audio/speech'].includes(speechPath) ||
      /^\/profiles\/[A-Za-z0-9_-]+\/(consent|attestation)$/.test(speechPath)
    );
    const speechDelete = method === 'DELETE' && /^\/profiles\/[A-Za-z0-9_-]+$/.test(speechPath);
    const llm = (method === 'GET' && path === '/llm/v1/models') || (method === 'POST' && path === '/llm/v1/chat/completions');
    if (!(speechRead || speechWrite || speechDelete || llm))
      return c.json({ error: 'Route not exposed by the inference gateway' }, 404);
    const base = (llm ? config.llmUrl : config.speechUrl).replace(/\/+$/, '');
    const suffix = llm ? path.slice('/llm/v1'.length) : speechPath;
    const headers: Record<string, string> = { authorization: `Bearer ${llm ? config.llmKey : config.speechKey}` };
    const contentType = c.req.header('content-type');
    if (contentType) headers['content-type'] = contentType;
    try {
      const upstream = await fetch(base + suffix, {
        method, headers, redirect: 'error',
        body: method === 'POST' ? await c.req.arrayBuffer() : undefined,
        signal: AbortSignal.timeout(300_000),
      });
      // VoiceStudio 0.5.7 omits PocketTTS from /models and reports no model identity.
      // Supply honest cache evidence for the pinned English cloning checkpoint;
      // the separate backend availability/licence checks still must pass.
      if (upstream.ok && method === 'GET' && ['/engines/tts', '/models'].includes(speechPath)) {
        const metadata = await upstream.json() as any;
        if (speechPath === '/engines/tts' && metadata.active === 'pockettts') metadata.active_model = 'kyutai/pocket-tts';
        if (speechPath === '/engines/tts' && metadata.active === 'moss-tts-nano') metadata.active_model = 'OpenMOSS-Team/MOSS-TTS-Nano-100M';
        if (speechPath === '/models' && config.pocketFiles) {
          const files = config.pocketFiles;
          const installed = await completeSafetensors(files.weights) && await stat(files.tokenizer).then((s) => s.isFile() && s.size > 1000).catch(() => false);
          metadata.models = [...(metadata.models ?? []).filter((m: any) => m.repo_id !== 'kyutai/pocket-tts'), { repo_id: 'kyutai/pocket-tts', installed }];
        }
        return c.json(metadata, 200, { 'cache-control': 'no-store' });
      }
      const responseHeaders = new Headers({ 'cache-control': 'no-store' });
      if (upstream.headers.has('content-type')) responseHeaders.set('content-type', upstream.headers.get('content-type')!);
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch {
      return c.json({ error: 'Inference service unavailable or timed out' }, 502);
    }
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { serve } = await import('@hono/node-server');
  const app = buildSpeechGateway({
    secret: process.env.INFERENCE_GATEWAY_SECRET ?? '',
    speechUrl: process.env.VOICESTUDIO_URL ?? 'http://voicestudio:3900',
    speechKey: process.env.VOICESTUDIO_API_KEY ?? '',
    llmUrl: process.env.LLM_BASE_URL ?? 'http://colibri:8000/v1',
    llmKey: process.env.LLM_API_KEY ?? '',
    pocketFiles: {
      weights: '/voicestudio-data/huggingface/hub/models--kyutai--pocket-tts/snapshots/39592ff23c9ef80098bb74895d104c26275fe2c9/languages/english/model.safetensors',
      tokenizer: '/voicestudio-data/huggingface/hub/models--kyutai--pocket-tts-without-voice-cloning/snapshots/d29db7978e464fb90cb3359ee0c69a273b9142cc/languages/english/tokenizer.model',
    },
  });
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8790) });
}
