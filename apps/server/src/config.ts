import { resolve } from 'node:path';

const env = process.env;
const port = Number(env.PORT ?? 8787);

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const devSecret = 'relay-dev-secret-change-me-relay-dev-secret';

export const config = {
  port,
  publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  /** Empty = embedded PGlite in DATA_DIR. Otherwise a postgres:// URL (pgvector required). */
  databaseUrl: env.DATABASE_URL ?? '',
  dataDir: resolve(env.DATA_DIR ?? './data'),
  secret: env.RELAY_SECRET || devSecret,
  usingDevSecret: !env.RELAY_SECRET,
  /** all = HTTP + background jobs (single box). web = HTTP only. worker = jobs + cron only. */
  role: (['web', 'worker'].includes(env.RELAY_ROLE ?? '') ? env.RELAY_ROLE : 'all') as 'all' | 'web' | 'worker',
  /** selfhost = everything unlocked, no billing. cloud = plan limits + Razorpay. */
  mode: (env.RELAY_MODE === 'cloud' ? 'cloud' : 'selfhost') as 'cloud' | 'selfhost',
  /** Platform default model, used when a workspace has not configured BYOK. */
  defaultLlm: {
    provider: env.LLM_PROVIDER ?? 'extractive',
    model: env.LLM_MODEL ?? '',
    baseUrl: env.LLM_BASE_URL ?? '',
    apiKey: env.LLM_API_KEY ?? '',
  },
  embed: {
    /** hash (built-in, offline) | openai-compatible (Ollama, OpenAI, LiteLLM, ...) */
    provider: env.EMBED_PROVIDER ?? 'hash',
    model: env.EMBED_MODEL ?? '',
    baseUrl: env.EMBED_BASE_URL ?? '',
    apiKey: env.EMBED_API_KEY ?? '',
  },
  blob: {
    s3Endpoint: env.S3_ENDPOINT ?? '',
    s3Bucket: env.S3_BUCKET ?? 'relay',
    s3Region: env.S3_REGION ?? 'auto',
    s3AccessKey: env.S3_ACCESS_KEY ?? '',
    s3SecretKey: env.S3_SECRET_KEY ?? '',
  },
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID ?? '',
    keySecret: env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '',
    plans: {
      starter: env.RAZORPAY_PLAN_STARTER ?? '',
      growth: env.RAZORPAY_PLAN_GROWTH ?? '',
    } as Record<string, string>,
  },
  whatsapp: {
    appSecret: env.WHATSAPP_APP_SECRET ?? '',
    graphVersion: env.WHATSAPP_GRAPH_VERSION ?? 'v21.0',
  },
  demo: {
    seed: bool(env.DEMO_SEED, true),
    email: env.DEMO_EMAIL ?? 'demo@relay.local',
    password: env.DEMO_PASSWORD ?? 'relay-demo-1234',
  },
  allowSignup: bool(env.ALLOW_SIGNUP, true),
  /** Fetching private-network URLs during crawls/actions. Off in cloud mode. */
  allowPrivateFetch: bool(env.ALLOW_PRIVATE_FETCH, env.RELAY_MODE !== 'cloud'),
  usdToInr: Number(env.USD_INR ?? 88),
  staticDir: resolve(env.STATIC_DIR ?? '../web/dist'),
};

export type Config = typeof config;
