# Relay Voice Desk implementation plan

Date: 1 November 2026. Target: `fin`, preserving existing migrations, accounts and legacy routes.

## Product boundary

A TypeScript application for professionals who work with client information: record or type a question, choose a client and professional workflow, retrieve relevant client files, review a source-grounded draft, then hear and download the reply in an explicitly authorized voice. Profiles include education, healthcare administration, HR, advice and field services. The workflow prepares information; it does not autonomously diagnose, prescribe, make employment decisions or send messages externally.

## Architecture

- Reuse React 19 / Router 7 / Vite 7 / CSS themes / PWA; add a Voice Desk as the default authenticated page.
- Reuse Hono, Node 24, workspace membership, scrypt passwords, signed sessions and AES-256-GCM. Require a non-development signing/encryption secret in production.
- Add additive SQL migrations for client spaces, document chunks, consented voices, encrypted audio and asynchronous voice runs. Scope every query by organization and client; voices additionally belong to a user. Never let client files fall into the institution-wide public knowledge collection.
- Reuse the PostgreSQL queue and SSE bus. Voice/document processing must show explicit queued/working/review/ready/failed states. Store encrypted audio in PostgreSQL for consistent PGlite/PostgreSQL behavior and durable container deployments.
- Reuse unpdf, Mammoth, embeddings and BYOK model adapters. Accept bounded PDF/DOCX/TXT/Markdown/CSV/JSON inputs; scanned PDFs explicitly need OCR, unsupported formats are rejected. Only selected client's retrieved passages enter a model request.
- Configure speech separately from reasoning: OpenAI-compatible speech-to-text plus a verified local VoiceStudio or ElevenLabs cloning adapter. Keys remain encrypted server-side; only a provider readiness summary is returned. No simulated audio is presented as generated speech.
- Record voice-owner consent before enrollment or generation. Provide revocation and deletion. Public widget visitors cannot use an employee's personal clone or read private client files.
- Play generated audio using HTML audio (mobile-compatible user gesture), provide authenticated downloads and support a clearly labeled standard browser voice when cloning is unavailable. Browser speech is not a downloadable cloned file.
- Add microphone and speaker controls to the vanilla TypeScript/esbuild widget, with original visitor/session isolation retained.

## Execution sequence

1. Inspect contracts and document implementation plan (this file).
2. Add schema and speech adapter contracts; implement scoped processing and route authorization.
3. Add mobile-first Voice Desk, client/document/voice management, provider setup, playback/download and review.
4. Integrate widget voice affordances and update default product navigation/copy.
5. Run TypeScript, existing regressions, voice contract/integration tests, app builds and available Docker/browser checks.

## Verification requirements

Cover login/encryption, cross-workspace and cross-client isolation, voice ownership/consent/revocation, safe provider failures, job stages, source citations, review gates, audio access/download, document extraction, microphone denial and resource cleanup. Provider tests may use controlled HTTP fixtures, but fixtures are never shipped as a working speech engine. Report live inference and deployment limits honestly. Keep production secrets and `.env` contents out of logs and responses.

## Implemented and verified

The horizontal Voice Desk, scoped document pipeline, speech adapters, consent/revocation, review workflow, authenticated playback/download, widget controls and isolated Docker Compose configuration are implemented. Existing application migrations and legacy routes are retained.

TypeScript checks, the existing regression suite, production PWA/widget build, voice integration tests on PGlite and PostgreSQL, PostgreSQL LISTEN/NOTIFY, and Docker build/health checks passed. Browser checks exercised onboarding, client creation, a real PDF upload and a sourced reply; 390px mobile and 1440px desktop layouts had no horizontal overflow. A synthetic example workspace is available in the local Docker application. Microphone capture on a real phone, actual speaker output and live cloned-voice quality have not been verified. Speech tests use an explicit HTTP contract fixture, not a deployed inference engine.

The local app uses a separate PostgreSQL volume and ignored `.env.voice` configuration. No production Render/Aiven deployment or inference-service installation was performed. To enable real cloned replies, the operator/user must connect a speech engine and enroll their own voice through the consent flow. See `VOICE_DESK.md` for setup and practical limits.
