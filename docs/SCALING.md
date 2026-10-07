# Scaling & operations

Relay is a 12-factor app. All configuration comes from environment variables and all state lives in Postgres (plus blob storage). So you scale it by adding processes, not by rewriting it.

## What runs where

| Process | `RELAY_ROLE` | Does | Scale by |
|---|---|---|---|
| Web | `web` | Dashboard, REST API, widget API, SSE streams, webhooks | Requests and concurrent SSE connections. Add replicas behind a load balancer. |
| Worker | `worker` | Knowledge ingestion (crawl/PDF/DOCX → embeddings), simulations, cron (auto-resolve, retention, re-sync) | Queue depth (`select count(*) from jobs where status='queued'`). Add replicas or raise `JOB_CONCURRENCY`. |
| All-in-one | `all` (default) | Both | One box. Fine up to thousands of conversations a day. |

Shared state, and how each piece copes with several instances:

| Concern | How it works across instances |
|---|---|
| Realtime (inbox, widget) | Every event is emitted locally **and** broadcast over Postgres `LISTEN/NOTIFY` (`lib/events.ts`). Large messages travel by reference. |
| Presence | Heartbeats are broadcast on the same bus. |
| Jobs | Postgres queue claimed with `FOR UPDATE SKIP LOCKED`, so any number of workers is safe. Jobs retry with backoff. |
| Sessions | Stateless signed JWT cookies. No sticky sessions needed. |
| Files | Local disk works for a single host. Use S3-compatible storage (MinIO, R2, S3) for multiple hosts. |
| Rate limits | **Per instance** (in-memory). With N web replicas, the effective limit is N×. Put a shared limiter (Valkey, or your load balancer or CDN) in front for strict global limits. |
| Answer cache | Postgres table `answer_cache`, shared. |

Embedded PGlite is single-process. `RELAY_ROLE=web|worker` refuses to start without `DATABASE_URL`.

## Growth stages

1. **Launch (one box).** `docker compose -f deploy/docker-compose.yml up -d` on a 2 vCPU / 4 GB VM gives you Postgres+pgvector and Relay `all`. Back up the `pg-data` volume daily (`pg_dump`).
2. **Split web and worker.** Add `-f deploy/docker-compose.scale.yml --scale relay=3`. Caddy load-balances (SSE-safe) and terminates HTTPS. Workers scale independently so a big crawl never slows the inbox.
3. **Managed database.** Move Postgres to a managed service with pgvector (Supabase, Neon, RDS, Cloud SQL) and point `DATABASE_URL` at it. Use a connection pooler (PgBouncer/Supavisor) in **session mode**, because `LISTEN/NOTIFY` needs session pooling. Alternatively, give the bus a direct (non-pooled) URL.
4. **Many hosts or Kubernetes.** Run the same image as two Deployments (`web`, `worker`) with `/healthz` as the readiness and liveness probe, plus an HPA on CPU for web and on queue depth for workers. Use S3-compatible storage for files. A rolling deploy is safe: shutdown stops accepting requests, drains in-flight jobs (20s), and SSE clients reconnect automatically.

## Database growth

- **Vectors.** At SMB scale, exact cosine search per workspace is fast because every query filters by `org_id`. Beyond roughly 100k chunks per workspace, pin one embedding dimension and add an HNSW index in a new migration, e.g. `alter table chunks alter column embedding type vector(384); create index on chunks using hnsw (embedding vector_cosine_ops);`
- **Messages.** The retention purge (`retentionDays`) bounds table size. For very large tenants, partition `messages` by month.
- **Hot paths** already have indexes: inbox listing `(org_id, status, last_message_at)`, the job queue `(status, run_at)`, full-text `gin(tsv)`.

## Load testing

```bash
k6 run -e BASE=https://staging.example.in -e SITE_KEY=pk_... deploy/k6/widget-load.js
```

Thresholds: <1% errors, p95 message POST under 800 ms, and an AI reply in at least 95% of conversations. Run it against staging before launch day, with the semantic cache warm.

## CI/CD (GitHub Actions)

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | Every PR and push to `main` | Typecheck, unit + e2e tests on PGlite **and** on Postgres+pgvector, production build, widget size budget (<30 KB), Docker build + container smoke test |
| `codeql.yml` | PRs, `main`, weekly | Static security analysis |
| `release.yml` | Tag `vX.Y.Z` | Multi-arch image to `ghcr.io/<owner>/<repo>`, GitHub Release with generated notes, optional deploy hook + health wait |
| Dependabot | Weekly | npm, Actions and Docker base-image updates |

Release flow: merge PRs into `main` (CI green, branch protection on) → `git tag v0.2.0 && git push --tags` → the image is published → `DEPLOY_HOOK_URL` triggers your host to pull it → the workflow waits for `PUBLIC_URL/healthz`.

Repository settings to turn on once:
- Branch protection on `main`: require the CI checks and one review.
- Private vulnerability reporting (Security tab).
- Discussions.
- An Actions **environment** named `production`, holding the secret `DEPLOY_HOOK_URL` and the variable `PUBLIC_URL`. Required reviewers on that environment act as a manual approval gate for production.

## Observability (next)

`/healthz` checks the database. Before scaling past one box, add:
- Error tracking (Sentry, or open-source GlitchTip).
- Product analytics (PostHog, which is open source).
- Uptime monitoring (Uptime Kuma).
- Structured JSON logs shipped to Loki or Grafana Cloud.
- Metrics worth alerting on: job queue depth, the AI handoff rate, p95 answer latency, and LLM ₹ spend per workspace.
