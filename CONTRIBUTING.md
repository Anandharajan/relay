# Contributing to Relay

Thanks for helping build AI support for the next billion customers! 🙏

## Ways to help

- **Try it and report what breaks.** [Open a bug](../../issues/new?template=bug.yml) with steps to reproduce.
- **Add a language.** The canned replies in `apps/server/src/engine/i18n.ts` and the stopwords in `apps/server/src/lib/text.ts` need native speakers (Marathi, Bengali, Gujarati, Odia, Punjabi, Malayalam…).
- **Add a channel or integration**: email, Shopify order lookup, Instamojo, Zoho Desk import.
- **Improve the docs**, especially self-hosting guides for your favourite platform.

Issues labelled [`good first issue`](../../labels/good%20first%20issue) are a great place to start.

## Development

```bash
pnpm install
pnpm dev          # API on :8787 (watch mode) + dashboard on :5173
pnpm test         # unit + end-to-end on in-memory Postgres (PGlite)
pnpm typecheck
```

To run the suite against real Postgres + pgvector (as CI does), point `TEST_DATABASE_URL` at an **empty** database:

```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=relay pgvector/pgvector:pg17
TEST_DATABASE_URL=postgres://postgres:relay@localhost:5432/postgres pnpm test
```

## Pull requests

1. Fork, then branch from `main` (`feat/whatsapp-templates`, `fix/widget-scroll`).
2. Keep PRs focused. Add or update tests for behaviour changes (`apps/server/test`).
3. `pnpm typecheck && pnpm test` must pass. CI also tests on Postgres and builds the Docker image.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) in titles (`feat:`, `fix:`, `docs:`). The release notes are generated from them.
5. Database changes go in a **new** file in `apps/server/migrations/` (never edit an applied one).

## Principles

- **Works without an LLM.** Every feature should degrade gracefully in extractive mode.
- **Never send raw PII to a model.** Use `lib/redact.ts`.
- **Every query is scoped by `org_id`.** Tenant isolation is not optional.
- **Vendors go behind interfaces** (`Db`, `Llm`, `Embedder`, `BlobStore`), so self-hosters keep a fully open-source path.

By contributing you agree that your contributions are licensed under the project's licenses (AGPL-3.0; the widget under MIT) and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
