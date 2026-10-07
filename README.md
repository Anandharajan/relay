# Relay

[![CI](https://github.com/Anandharajan/relay/actions/workflows/ci.yml/badge.svg)](https://github.com/Anandharajan/relay/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Self-host](https://img.shields.io/badge/self--host-docker%20compose-2496ED)](#self-host-with-docker-fully-open-source-stack)
[![Live demo](https://img.shields.io/badge/demo-try%20it-8b4513)](#quick-start-local-no-docker-no-keys)


**Fin for the next billion customers:** an open-source, BYOK AI agent that resolves support on WhatsApp and web chat in your customers' language, works alongside your team, and keeps its integrations working on its own.

- 🗣️ **Vernacular by default.** It detects Hindi, Kannada, Tamil, Telugu, Bengali and more, and answers from your help content with citations.
- 💬 **WhatsApp + web chat.** The web widget is one `<script>` tag (~13 KB, Shadow DOM). WhatsApp uses the Cloud API.
- 👥 **Multiplayer inbox.** AI and humans share one thread. Approve or edit AI drafts in one tap, take over or hand back, `@AI` inside internal notes, live presence.
- 🧠 **Learns from your team.** Edited drafts and "Teach AI" replies become knowledge immediately.
- ⚡ **Actions.** Order lookup, cancellation, refunds via your APIs, with OpenAPI import. Sensitive actions need a human to verify.
- 🩹 **Self-healing Actions.** When your API changes shape, Relay detects the schema drift and proposes the fixed field mapping for one-click approval.
- 🧪 **Simulations.** Batch-test real questions through the real pipeline and get a pass rate before going live.
- 📈 **Analytics.** Resolution rate, deflection, CSAT, cost per resolution, languages, handoff reasons, unanswered questions.
- 🔐 **DPDP-ready.** PII is redacted before any LLM call. Also included: consent log, retention purge, per-customer export/erase, and an audit trail.
- 🔑 **BYOK or fully local.** Claude, OpenAI, Gemini, Groq, OpenRouter, Ollama or any OpenAI-compatible server. It also works **with no LLM at all**: the built-in extractive engine answers verbatim from your knowledge base, for free.
- 💸 **INR billing.** Razorpay subscriptions with UPI Autopay (Relay Cloud mode).

Product plan: [docs/PLAN.md](docs/PLAN.md). Launch kit: [launch/PRODUCT_HUNT.md](launch/PRODUCT_HUNT.md).

---

## Quick start (local, no Docker, no keys)

Requires Node ≥ 22.18 and pnpm.

```bash
pnpm install
pnpm build          # builds widget.js + dashboard
pnpm start          # http://localhost:8787
```

The first boot creates an embedded Postgres (PGlite + pgvector) in `apps/server/data` and seeds the demo workspace **Kaapi & Co.**, a fictional Bengaluru coffee store:

- `/` is the landing page, `/demo` is the demo store with the live widget, and `/app` is the dashboard.
- Demo login: `DEMO_EMAIL` / `DEMO_PASSWORD` from [.env.example](.env.example). These are local test credentials. Change or disable them (`DEMO_SEED=false`) in production.

For development with hot reload: `pnpm dev`. The API runs on :8787 and Vite on :5173, which proxies the API.

## Self-host with Docker (fully open-source stack)

```bash
cp .env.example .env        # set RELAY_SECRET (long random string)
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml --profile ollama up -d   # optional local LLM
```

| Concern | Default | Open-source option | Managed option |
|---|---|---|---|
| App server | Node + Hono | the same code runs on `workerd` | Cloudflare Workers, Fly, Render |
| Database + vectors | PGlite (embedded) | PostgreSQL + **pgvector** | Supabase, Neon |
| Full-text search | Postgres `tsvector` | (same) | (same) |
| Files | local disk | MinIO / Garage (S3 API) | Cloudflare R2, S3 |
| Jobs / workflows | Postgres queue (`SKIP LOCKED`) | (same) | (same) |
| Realtime | in-process SSE bus | Postgres LISTEN/NOTIFY (multi-node) | Supabase Realtime |
| LLM | extractive (none) | **Ollama**, vLLM, LiteLLM | Claude, OpenAI, Gemini, Groq |
| Embeddings | hashed n-grams (offline, multilingual) | Ollama `bge-m3`, TEI | OpenAI |
| Payments | n/a | n/a (payments need a licensed processor) | Razorpay |

Every vendor sits behind a small interface: `Db` (`src/db.ts`), `Llm` (`adapters/llm.ts`), `Embedder` (`adapters/embed.ts`) and `BlobStore` (`adapters/blob.ts`). Swapping one is configuration, not a rewrite.

## How an answer is made

`apps/server/src/engine/answer.ts` runs for every customer message:

1. **Redact PII**: phone, email, Aadhaar, PAN, card (Luhn-checked) and UPI become placeholders like `[PHONE_1]`, and are restored in the reply.
2. **Detect language** from the script.
3. **Human request?** Hand off immediately. **Small talk?** Answer free.
4. **Plan and budget checks.** BYOK conversations never count toward plan limits, and a monthly ₹ budget cap falls back to the free engine.
5. **Actions.** The LLM router (or the keyword router without an LLM) extracts parameters. Missing parameters get a follow-up question, and sensitive actions go to human verification.
6. **Semantic cache** keyed by org, engine, language and normalized question.
7. **Hybrid retrieval**: pgvector cosine + Postgres full-text, fused with reciprocal rank fusion, always scoped by `org_id`.
8. **Generate** with the workspace's model (JSON answer + cited sources + self-rated confidence), or **extract** without one.
9. **Confidence gate.** Below the threshold, Relay escalates and keeps the uncertain answer as a draft for the human.
10. **Meter** tokens and ₹ cost. A resolution is counted on 👍, or when the conversation goes idle after an AI answer.

Prompt-injection hygiene: knowledge and customer text are framed as untrusted data, the router can only choose configured actions, sensitive actions require a human, and the model never sees raw PII.

## Repository layout

```
apps/
  server/   Hono API, answer engine, jobs, channels (AGPL-3.0)
    migrations/   SQL schema (Postgres/PGlite)
    src/engine/   answer pipeline, retrieval, extractive engine, actions
    src/jobs/     ingest (crawl/PDF/DOCX → chunks → vectors), simulations, maintenance
    src/routes/   dashboard API, widget API, billing, demo store API
    src/channels/ WhatsApp Cloud API
    test/         unit + end-to-end tests (node:test)
  web/      React + Vite PWA: landing, demo store, dashboard (AGPL-3.0)
  widget/   embeddable chat widget, vanilla TS → widget.js (MIT)
deploy/     Dockerfile + docker-compose (Postgres+pgvector, Ollama, MinIO)
docs/       product plan
launch/     Product Hunt launch kit
```

## Configuration

Everything is set through environment variables. See [.env.example](.env.example) for the full annotated list. The most important ones:

| Variable | Purpose |
|---|---|
| `RELAY_SECRET` | **Required in production.** Signs sessions and encrypts BYOK keys (AES-256-GCM). |
| `DATABASE_URL` | Postgres with pgvector. Empty means embedded PGlite. |
| `RELAY_MODE` | `selfhost` (everything unlocked) or `cloud` (plan limits + Razorpay). |
| `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY` | Platform default model for workspaces without BYOK. |
| `EMBED_PROVIDER` / `EMBED_BASE_URL` / `EMBED_MODEL` | `hash` (default) or any OpenAI-compatible embeddings endpoint. |
| `RAZORPAY_*` | Billing keys, webhook secret and plan IDs (cloud mode). |
| `WHATSAPP_APP_SECRET` | Verifies WhatsApp webhook signatures. |

## Tests, CI/CD and scaling

```bash
pnpm test        # unit + end-to-end (boots the server on an in-memory DB)
pnpm typecheck
TEST_DATABASE_URL=postgres://… pnpm test   # same suite on real Postgres + pgvector
```

GitHub Actions runs on every PR:
- typecheck;
- tests on PGlite and on Postgres+pgvector;
- the build, with a widget size budget;
- a Docker build with a container smoke test;
- CodeQL.

Tagging `vX.Y.Z` publishes a multi-arch image to GHCR, creates a release and can trigger a deploy hook. Relay scales horizontally: stateless `web` replicas plus `worker` processes, with realtime crossing instances over Postgres LISTEN/NOTIFY. See [docs/SCALING.md](docs/SCALING.md) and `deploy/docker-compose.scale.yml`.

## Contributing

PRs are welcome, especially new languages and channels. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## Roadmap

- **Phase 2:** email channel, an MCP endpoint for customers' personal AI agents (with OTP/passkey verification for sensitive actions), a Postgres LISTEN/NOTIFY realtime bus for multi-node deployments.
- **Phase 3:** WhatsApp voice notes (Whisper), screenshot understanding, auto-generated help articles from resolved tickets.

## License

Server and dashboard: [AGPL-3.0](LICENSE). Widget SDK (`apps/widget`): [MIT](apps/widget/LICENSE).
