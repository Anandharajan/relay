# Relay: an open-source AI support agent for the next billion customers

> Working name: "Relay". Check trademark and domain availability before launch.
> Reference product: [Fin by Intercom](https://fin.ai/) ([Product Hunt](https://www.producthunt.com/products/fin))
> Idea sources: YC Requests for Startups, Fall 2026

---

## 1. Product concept

### What Fin does (the baseline)
- An AI agent that resolves support conversations over chat, email and voice, grounded in a company's help content.
- **Procedures and Actions** handle multi-step workflows such as refunds and order lookups by calling backend APIs.
- **Simulations and batch testing** let a team check answers before going live. Fin also reads images and supports 45+ languages.
- **Pricing:** about $0.99 per resolution, a 50-resolution monthly minimum, plus Intercom seat costs. Most small businesses in India and other emerging markets can't afford this.

### The gap
SMBs, D2C brands, clinics, coaching institutes and local services mostly support customers over **WhatsApp**, **in local languages**, and on a **tight budget**. Fin is priced and built for SaaS companies in the US and EU.

### Relay = Fin-style resolution + YC Fall 2026 ideas

| YC RFS (Fall 2026) | How Relay uses it |
|---|---|
| **AI-Powered Consumer Products for 1 Billion People** | WhatsApp-first, vernacular (Hindi, Kannada, Tamil and others), INR pricing, BYOK so the free tier costs us almost nothing |
| **Multiplayer AI** | A shared inbox where the AI and human agents work the same conversation. The AI drafts, a human approves with one tap, and the AI learns from the edit. Teammates can @mention the AI inside a thread. |
| **Self-Maintaining APIs** | "Self-healing Actions": when a merchant's order or refund API changes shape or starts failing, a Workflow detects schema drift, proposes a fixed mapping, and asks the owner to approve it |
| **Proving You're Human** | Agent-aware support: an MCP/agent endpoint so customers' *personal AI agents* can query order status and policies, with human verification (OTP/passkey) required for sensitive actions like refunds or address changes |
| **AI-Native Compliance Infrastructure** | Built-in compliance with India's DPDP Act: a PII redaction layer before any LLM call, consent logs, retention policies, and an exportable audit trail of every AI action |
| **A Cloud for Small Software** | Relay itself runs almost entirely on free tiers and is self-hostable. That makes a good open-source launch story. |

**One-liner:** *"Fin for the next billion customers: an open-source, BYOK AI agent that resolves support on WhatsApp and web chat in your customers' language, works alongside your team, and keeps its integrations working on its own."*

### MVP scope (what launches on Product Hunt)
1. Onboarding: sign up, create a workspace, add a knowledge source (URL crawl, PDF/DOCX upload, FAQ paste).
2. RAG answer engine with citations, confidence scoring, and hand-off to a human below a threshold.
3. An embeddable web chat widget (one `<script>` tag) with a PWA dashboard.
4. A multiplayer inbox: AI drafts, human approve/edit/override, live presence.
5. **Simulations:** paste or generate 50 test questions and see the AI's answers and a pass rate before going live.
6. Actions v1: HTTP actions such as order lookup, using a merchant-supplied OpenAPI or JSON sample.
7. BYOK model settings (OpenAI, Claude or Gemini) and a free default (Workers AI or Gemini free).
8. Analytics: resolution rate, deflection, CSAT, cost per resolution.
9. Billing: Razorpay subscriptions plus usage-based resolution packs.

**Phase 2 (after launch):** WhatsApp Cloud API channel, email channel, self-healing Actions, agent/MCP endpoint, DPDP compliance pack.
**Phase 3:** voice (phone/WhatsApp voice notes), vision (screenshots of errors), auto-generated help articles from resolved tickets.

---

## 2. Stack feasibility check

### Verdict
- **Can this stack build the full product end to end?** Yes. Every MVP and Phase 2 feature maps to a service in the stack (see the table below). There are two small gaps, outbound email and WhatsApp, and both are covered by free third-party APIs.
- **Is it a fully open-source stack?** No. Your **code** can be 100% open source, but most of the **infrastructure** is proprietary managed services that have free tiers. What you can honestly say at launch is "open-source app (MIT/AGPL), runs on free tiers, self-hostable." Section 2.3 lists an open-source replacement for each piece.
- **"Host on Product Hunt":** Product Hunt doesn't host apps. It's a launch and listing platform. You host the app on Cloudflare Pages/Workers and then *launch* it on Product Hunt with a listing that links to your URL and GitHub repo (see section 6).

### 2.1 Service-by-service mapping

> Free-tier limits change often. The numbers below are approximate, as of late 2026. **Verify each one on the provider's pricing page before committing.**

| Layer | Service | Role in Relay | Free tier (approx.) | Open source? | Fit / caveats |
|---|---|---|---|---|---|
| Frontend | React + Vite + `vite-plugin-pwa` | Dashboard PWA, chat widget (separate small bundle) | n/a | ✅ MIT | ✅ Good fit |
| Hosting | Cloudflare Pages | Static hosting for the dashboard, widget and landing page | Unlimited static requests, ~500 builds/mo | ❌ (proprietary) | ✅ |
| API | Cloudflare Workers (Hono router) | REST and streaming chat API, webhooks, widget API | ~100k req/day, **10 ms CPU/request** | Runtime `workerd` ✅ Apache-2.0; platform ❌ | ⚠️ The 10 ms CPU limit is fine for I/O (waiting on an LLM costs no CPU) but **too little for parsing PDFs or chunking**. Move that work into Workflows steps or `env.AI.toMarkdown()`. |
| Realtime | Supabase Realtime **or** Durable Objects (free, SQLite-backed) | Live inbox presence, "AI is typing", human takeover | Supabase: ~200 concurrent connections | Supabase ✅ | ✅ Start with Supabase Realtime, move to DOs when you scale |
| Auth + DB | Supabase Auth + Postgres | Users, orgs, RLS multi-tenancy, conversations, billing state | 500 MB DB, 50k MAU, 2 projects, **pauses after 7 days idle** | ✅ Apache-2.0, self-hostable | ⚠️ Keep it awake with a daily cron ping. Verify JWTs in Workers via JWKS (`jose`). Connect over supabase-js (HTTP) or Hyperdrive. |
| Orchestration | Cloudflare Workflows | Knowledge ingestion (crawl → parse → chunk → embed), simulations, self-healing Action jobs, retention purges | Available on the Free plan with step limits | ❌ | ✅ Durable, retryable steps work around the 10 ms CPU limit |
| Vectors | Cloudflare Vectorize | Per-tenant knowledge embeddings (namespaces = org_id) | ~5M stored dimensions, ~30M queried dimensions/mo | ❌ | ⚠️ **Tight.** At 768 dimensions that's only about 6.5k chunks in total. Use a **384-dim model** (`bge-small-en-v1.5`, or `bge-m3` truncated if you need multilingual), or fall back to **pgvector in Supabase** for the free tier. |
| Files | Cloudflare R2 | Uploaded docs, crawled HTML snapshots, chat attachments, exports | 10 GB, 1M Class A, 10M Class B ops/mo, **zero egress** | ❌ (S3 API) | ✅ |
| Cache / rate limit | Upstash Redis (free) | Per-tenant rate limits, semantic answer cache, idempotency keys, widget session cache | ~256 MB, ~500k commands/mo | ❌ (Redis protocol) | ✅ Use `@upstash/ratelimit`. Watch the command budget and prefer Workers KV for read-heavy caching. |
| LLM proxy | Cloudflare AI Gateway | One endpoint for all providers: logging, caching, retries/fallback, rate limits, cost analytics, BYOK key storage | Free core features | ❌ | ✅ Its per-tenant cost logs drive "cost per resolution" analytics |
| Models | Workers AI (Llama / Qwen / Gemma, bge embeddings, Whisper) | Free default chat model, embeddings, classification, PII NER | ~10k neurons/day | Open-weight models ✅; platform ❌ | ✅ for embeddings and classification. ⚠️ The daily cap means the free model is **demo-tier only**. |
| | Gemini API free tier | Better free default answers | Rate-limited per minute and per day | ❌ | ⚠️ **Free-tier prompts may be used for training, so don't send customer PII.** Put the redaction layer in front, or require BYOK or the paid tier for production tenants. |
| | BYOK OpenAI / Claude / Gemini | Production-quality answers; the tenant pays for their own tokens | Tenant's own key | ❌ | ✅ Store keys AES-GCM encrypted (master key held as a Worker secret) or in AI Gateway's BYOK store |
| Payments | Razorpay | INR subscriptions, UPI autopay, resolution packs, webhooks | No setup fee; ~2% per domestic transaction | ❌ | ✅ for India. ⚠️ Needs a KYC'd business entity (a sole proprietorship works). International cards need extra approval. Plan Stripe or Lemon Squeezy for global Product Hunt traffic later. |

### 2.2 Gaps the stack doesn't cover (and free fills)
| Need | Fill |
|---|---|
| Scheduled jobs | Workers **Cron Triggers** (free) |
| Inbound email channel | Cloudflare **Email Routing + Email Workers** (free) |
| Outbound email (transactional + replies) | Resend free tier (~3k/mo) or Supabase Auth SMTP for auth emails |
| WhatsApp channel | Meta **WhatsApp Cloud API**. Customer-initiated service conversations are cheap or free; template messages are paid per message. |
| Async fan-out | Workflows (already in the stack); Cloudflare Queues optional |
| Error tracking / product analytics | Sentry free tier / PostHog free tier (PostHog is open source) |
| Domain | `*.pages.dev` is free; a custom `.com` or `.in` is about ₹800–1,200/yr (**the only unavoidable cost**) |

### 2.3 If "fully open source" is a hard requirement: drop-in swaps
| Managed | OSS / self-host equivalent |
|---|---|
| Cloudflare Workers / Pages | `workerd` self-hosted, or Node/Bun + Hono (same code) behind Caddy/Nginx |
| Workflows | Temporal, Inngest (self-host), or Hatchet |
| Vectorize | pgvector (in Supabase), Qdrant, Weaviate |
| R2 | MinIO / Garage (S3-compatible) |
| Upstash Redis | Valkey (BSD) / Dragonfly |
| AI Gateway | LiteLLM proxy, Portkey gateway (OSS) |
| Workers AI / Gemini | Ollama / vLLM serving Llama, Qwen or Gemma, plus bge embeddings |
| Razorpay | No OSS payment rails exist. Payments always go through a licensed processor. |

**Design rule so the swap is real:** put every vendor behind a small interface in `packages/core` (`VectorStore`, `BlobStore`, `KV`, `LLM`, `JobRunner`, `Payments`). Cloudflare adapters are the defaults; Docker Compose ships the OSS adapters. That gives a credible "self-host in one command" README.

---

## 3. Architecture

```
            ┌───────────────────────── Cloudflare ──────────────────────────┐
 Browser    │  Pages: dashboard PWA + widget.js + landing                    │
 / WhatsApp │                                                               │
 / Email ──►│  Worker "api" (Hono)                                          │
            │   ├─ auth middleware (Supabase JWT via JWKS)                   │
            │   ├─ /chat  → PII redact → retrieve (Vectorize) → LLM via     │
            │   │           AI Gateway (Workers AI | Gemini | BYOK) → SSE   │
            │   ├─ /webhooks/razorpay, /webhooks/whatsapp, email handler    │
            │   ├─ /agent (MCP endpoint for customers' AI agents)  [P2]     │
            │   └─ rate limit + semantic cache (Upstash)                    │
            │  Workflows: ingest · simulate · heal-actions · retention      │
            │  R2: raw docs/attachments   Vectorize: per-org namespaces     │
            │  Cron: keep-alive, usage rollups, renewals reconciliation     │
            └───────────────┬───────────────────────────────────────────────┘
                            │ HTTPS (supabase-js / Hyperdrive)
                     ┌──────▼───────┐        ┌──────────┐
                     │  Supabase    │        │ Razorpay │
                     │ Auth · PG ·  │        └──────────┘
                     │ RLS · Realtime│
                     └──────────────┘
```

### Answer pipeline (per message)
1. Rate-limit check and idempotency (Upstash).
2. **PII redaction:** regex rules for phone, email, Aadhaar/PAN patterns and card numbers, plus a small NER model on Workers AI. Real values go into a vault map so they can be restored in the reply.
3. Classify intent and language (Workers AI small model).
4. If the intent matches an Action, call the merchant API with a strict JSON schema and a human-verification gate for sensitive Actions.
5. Otherwise run hybrid retrieval: Vectorize top-k plus a Postgres full-text keyword search, then rerank (bge-reranker on Workers AI).
6. Generate the answer through AI Gateway using the tenant's model choice, with citations required.
7. **Confidence gate:** below the threshold, or if the customer asks for a human, hand off to the inbox (Realtime notification).
8. Log tokens and cost against the tenant (AI Gateway metadata), and record a "resolution" when the customer confirms or the conversation goes idle without escalation.

### Multi-tenancy & security
- Every table has an `org_id`, and Supabase RLS policies use `auth.jwt()` claims.
- The Worker uses the service role only for webhooks and Workflows, never in the browser.
- Each Vectorize namespace equals one `org_id`, and every query passes the namespace explicitly.
- R2 keys are prefixed `org/{org_id}/…`; downloads go through short-lived signed URLs.
- BYOK keys are stored encrypted, never returned to the client, and decrypted only inside the Worker.
- The widget uses a public `site_key` plus an origin allow-list plus a per-visitor anonymous JWT.

---

## 4. Data model (Postgres, first cut)

```
orgs(id, name, plan, razorpay_customer_id, settings jsonb, created_at)
members(org_id, user_id, role)                         -- owner/admin/agent
knowledge_sources(id, org_id, type[url|file|faq], uri, status, last_synced_at)
chunks(id, org_id, source_id, content, tsv tsvector, vector_id, lang)  -- text kept for keyword search/rerank
conversations(id, org_id, channel[web|whatsapp|email|agent], customer_ref,
              status[ai|human|resolved|escalated], lang, csat, resolved_by)
messages(id, conversation_id, org_id, role[customer|ai|human|system],
         content, redacted_content, citations jsonb, confidence, tokens, cost_inr)
ai_drafts(id, message_id, draft, final, edited_by, accepted bool)   -- multiplayer learning signal
actions(id, org_id, name, openapi jsonb, mapping jsonb, sensitive bool, health)
action_runs(id, action_id, conversation_id, request, response, status, latency_ms)
simulations(id, org_id, name, pass_rate, created_at) / simulation_cases(...)
model_settings(org_id, provider, model, encrypted_key, monthly_budget_inr)
usage_daily(org_id, date, resolutions, tokens, cost_inr)
subscriptions(org_id, razorpay_sub_id, plan, status, current_period_end)
audit_log(id, org_id, actor, action, target, payload jsonb, at)    -- DPDP trail
consents(id, org_id, customer_ref, purpose, granted_at, withdrawn_at)
```

---

## 5. Build plan (about 10 weeks, solo or a two-person team)

| Week | Milestone | Deliverables |
|---|---|---|
| 0 | **Setup** | pnpm monorepo, Wrangler config, Supabase project + migrations, GitHub Actions CI, preview deploys on Pages, `.env.example`, LICENSE (AGPL-3.0 for the server, MIT for the widget SDK) |
| 1 | **Auth & tenancy** | Supabase Auth (email OTP + Google), org creation, invites, RLS policies with tests, JWT verification middleware in the Worker |
| 2 | **Knowledge ingestion** | Upload to R2, `ingest` Workflow (fetch/crawl → `toMarkdown` → chunk → embed → Vectorize upsert), source status UI, re-sync cron |
| 3 | **Answer engine** | `/chat` SSE endpoint, hybrid retrieval and reranking, AI Gateway routing, citations, confidence gate, semantic cache |
| 4 | **Widget + PWA** | A widget bundle under 30 KB (Preact), theming, anonymous visitor sessions, PWA install and push notifications for agents |
| 5 | **Multiplayer inbox** | Realtime inbox, AI drafts, approve/edit/takeover, presence, @AI in threads, draft-edit learning stored |
| 6 | **Simulations + analytics** | Test-set generator, batch runs as a Workflow, pass-rate report, dashboard (resolution rate, cost per resolution, CSAT) |
| 7 | **Actions v1 + BYOK** | OpenAPI import, field mapping, sensitive-action OTP gate, encrypted key storage, per-tenant budget caps |
| 8 | **Billing** | Razorpay plans and subscriptions, UPI autopay, webhook signature verification, usage metering, plan limits enforced in the Worker |
| 9 | **Hardening** | PII redaction, audit log, rate limits, load test (k6), Sentry/PostHog, docs site, Docker Compose self-host |
| 10 | **Launch** | Demo store with a live widget, Product Hunt assets, launch (section 6) |
| 11+ | Phase 2 | WhatsApp, email, self-healing Actions, MCP agent endpoint, DPDP compliance pack |

### Repo layout
```
relay/
├─ apps/
│  ├─ web/            # React+Vite PWA dashboard + landing
│  └─ widget/         # Preact embeddable chat (widget.js)
├─ workers/
│  ├─ api/            # Hono API, webhooks, cron
│  └─ workflows/      # ingest, simulate, heal-actions, retention
├─ packages/
│  ├─ core/           # domain logic + vendor interfaces (VectorStore, LLM, …)
│  ├─ adapters-cf/    # Vectorize, R2, Workers AI, AI Gateway impls
│  ├─ adapters-oss/   # pgvector, MinIO, Valkey, LiteLLM, Ollama impls
│  └─ shared/         # zod schemas, types
├─ supabase/migrations/
└─ deploy/docker-compose.yml   # self-host
```

---

## 6. Pricing & Product Hunt launch

### Pricing (INR via Razorpay; USD later)
| Plan | Price | Includes |
|---|---|---|
| **Open Source** | Free, self-host | Everything |
| **Cloud Free** | ₹0 | 1 site, 100 AI conversations/mo on the free model, or unlimited with BYOK |
| **Starter** | ~₹999/mo | 1,000 resolutions, Relay-provided model, WhatsApp |
| **Growth** | ~₹3,999/mo | 5,000 resolutions, Actions, simulations, 5 seats |
| Overage | ~₹5 per resolution | ≈ $0.06, about 16× cheaper than Fin's $0.99 |

### Launch checklist
- [ ] Production URL on a custom domain, with status page and docs
- [ ] Public GitHub repo with a clean README, a one-command self-host, and a demo GIF
- [ ] **Live demo:** a fake D2C store whose widget answers in English, Hindi and Kannada
- [ ] Product Hunt listing: name, tagline (60 chars), 3–5 gallery images, a 60–90 s video, maker's first comment explaining "why Fin is unaffordable for 90% of businesses"
- [ ] Topics: Customer Support, Artificial Intelligence, Open Source, Developer Tools
- [ ] Launch at 12:01 AM PT (12:31 PM IST), Tuesday–Thursday; line up early supporters (no vote-asking, which Product Hunt forbids)
- [ ] Product Hunt launch offer, e.g. 3 months of Starter free via a Razorpay coupon
- [ ] Make sure the free tiers can absorb the launch spike: aggressive semantic caching, per-IP widget rate limits, a demo running on BYOK-paid keys, Supabase usage alerts

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Free-tier caps hit on launch day (Workers AI neurons, Vectorize dimensions, Upstash commands) | Cache, cap the demo, fail over to BYOK or Gemini through AI Gateway fallback, upgrade Workers Paid ($5/mo) if needed |
| Supabase free project pauses or hits 500 MB | Keep-alive cron, prune old raw messages to R2 archives, upgrade to Pro when you have revenue |
| 10 ms CPU limit on Workers Free | Heavy work runs in Workflows steps; never parse files in the request path |
| Hallucinated answers | Citations required, confidence gate, simulations before go-live, human approval mode |
| Customer PII sent to LLMs (Gemini free tier trains on data) | Redaction layer; production tenants must use BYOK or paid models |
| Razorpay KYC delays / international cards | Start KYC in week 0; keep the Payments interface abstract so Stripe or Lemon Squeezy can be added |
| Prompt injection via knowledge docs or customer messages | Separate system instructions from untrusted content, an allow-list of tools per intent, sensitive Actions need human verification, output schema validation |
| Copying Fin too closely | Lead with the YC-inspired differences: WhatsApp and vernacular, multiplayer, self-healing Actions, agent endpoint, open source |

---

## 8. Immediate next steps
1. Confirm the name, the open-source licence, and that Razorpay KYC can start.
2. Create Cloudflare, Supabase, Upstash, Razorpay (test mode) and AI Gateway accounts.
3. Scaffold the monorepo (week 0) and deploy a "hello" Worker and Pages site end to end.
4. Build the vertical slice first: upload a PDF, ask a question in the widget, get a cited answer.
