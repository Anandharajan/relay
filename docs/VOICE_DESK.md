# Relay Voice

A horizontal workspace for teachers, care administrators, HR teams, advisors and service professionals. Create a client, add their files, speak or type a question, review a sourced reply, then play or download it in your enrolled voice. No replies are automatically sent to clients.

Voice is a separate deployment from the Relay hospital site. `RELAY_PRODUCT=voice` makes `/` the voice landing page and `/app` the Voice desk. Without it, a deployment stays the support product and offers the desk at `/app/voice` under **More**.

## Start locally

Node 24 and pnpm are required. Set `RELAY_PRODUCT=voice`, then `pnpm install --frozen-lockfile` and `pnpm dev`. The API runs on 8787 and Vite on 5173. An empty `DATABASE_URL` uses persistent local PGlite in `DATA_DIR`; use a dedicated local configuration, not a production database. Disable the hospital demo with `DEMO_SEED=false`. Set a long, random `RELAY_SECRET` before storing real data. Keep it stable: changing it makes existing encrypted assets and keys unreadable and invalidates sessions.

For an isolated Docker/PostgreSQL setup, create an untracked `.env.voice` in the repository root containing independently generated random secrets:

```dotenv
RELAY_SECRET=replace-with-a-long-random-secret
VOICE_DB_PASSWORD=replace-with-an-independent-random-password
OMNIVOICE_API_KEY=replace-with-a-third-random-secret
```

Run from the repository root:

```powershell
docker compose --env-file .env.voice -f deploy/docker-compose.voice.yml up -d --build
```

Open http://localhost:8788 and create your account. This compose project has its own PostgreSQL volume, does not publish the database port, and does not load the existing `.env`. Use HTTPS when accessing from a phone: browsers restrict microphone access to secure origins (localhost is the development exception). `docker compose ... stop` preserves data. Do not delete the volume unless you intend to erase it.

## Connect VoiceStudio

[VoiceStudio](https://github.com/debpalash/VoiceStudio) is an open-source, self-hosted service for voice cloning and transcription. It runs separately; this repository includes no Python process, model weights or GPU provisioning. Review its licence and the licence of each model before commercial use.

1. Add `--profile voicestudio` to the compose command above to run it beside the app. The stable image is about 17 GB, and model weights download on top of that. To run it elsewhere, follow its [Docker guide](https://github.com/debpalash/VoiceStudio/blob/main/docs/install/docker.md).
2. In VoiceStudio's own interface, accept the licence of the model you want and download a speech-to-text model (Whisper large-v3 is 2.9 GB). Relay never accepts a licence for you, and VoiceStudio refuses generation until one is accepted. **Its default OmniVoice engine lists a non-commercial licence (CC-BY-NC)**, so choose a different engine, or ElevenLabs, for paid use.
3. In Relay, open **Voice settings**. Enter the server URL (`http://voicestudio:3900` for the compose profile) and its `OMNIVOICE_API_KEY`, then choose **Save and test connection**. The test reads `/health`, `/.well-known/voicestudio-speech` and `/engines/tts`, shows the version, device and active engine, and lists the engines that can clone. It never loads a model.
4. Set **Cloning provider** to VoiceStudio and pick an engine. With no separate transcription URL, VoiceStudio also transcribes.

An operator can instead set `VOICESTUDIO_URL` and `VOICESTUDIO_API_KEY` for all workspaces; a workspace's own connection takes precedence.

## Other speech and reasoning providers

- **AI settings** chooses Gemini, Claude, OpenAI, Groq, Ollama or another OpenAI-compatible model with your BYOK key. Without a model, extractive mode selects the sentences that answer the question and does not rewrite them.
- **Transcription** can use any OpenAI-compatible base URL such as `https://api.openai.com/v1` or `https://api.groq.com/openai/v1`.
- **ElevenLabs** cloning needs a BYOK key, an account with cloning access, and a transcription service for the enrollment check.

### Which addresses a workspace may use

Workspace admins choose these URLs, so a shared server must not let them reach internal services:

| Address | Allowed when |
| --- | --- |
| `api.openai.com`, `api.groq.com` (transcription only) | Always, over HTTPS |
| Hosts in `SPEECH_STT_ALLOWED_HOSTS` | The operator listed them, over HTTPS |
| `localhost`, `127.0.0.1`, `host.docker.internal`, `voicestudio` | The operator set `SPEECH_ALLOW_PRIVATE_HOSTS=true` |
| Anything else, including raw internal IPs | Never |

The check runs when settings are saved and again on each use, so removing the opt-in stops saved addresses immediately. It is off by default even with `RELAY_MODE=selfhost`, because a shared deployment can run in that mode. The voice compose file turns it on because that install is single-tenant and bound to localhost.

## Enrolling a voice

Cloning someone's voice needs more than a ticked box. **My voices** gives you a server-generated phrase containing a spoken consent statement and six random code words. You read it in a live in-browser recording, and the server transcribes the recording and compares it to the phrase before anything reaches the cloning engine. Each phrase expires in five minutes and allows one attempt. There is no file upload.

This stops anyone enrolling an existing recording of another person, because that recording cannot contain the code words. It does not identify the speaker: someone who persuades another person to read the phrase, or who feeds it to a synthetic voice, can still pass. Treat it as a strong barrier, and add your own identity checks before offering cloning to the public. Enrollment fails closed if no transcription service is connected. On VoiceStudio the recording is also stored as the profile's consent record.

Voices enrolled before this check existed are revoked by migration `010_voice_agents.sql` and must be enrolled again.

## How a reply is made

Each reply shows an agent board reusing the Live desk's `RunBoard`:

| Agent | What it does |
| --- | --- |
| Transcriber | Turns the recording into text |
| Planner | With a model, chooses search queries and which documents to read, using up to three of your earlier approved answers for this client to resolve follow-ups. Asks you one clarifying question if the request cannot be understood. |
| Researcher | Searches only this client's ready documents |
| Writer | Drafts with citations, or picks the relevant sentences in extractive mode |
| Verifier | Checks every sentence against the passage it cites (citation exists, numbers match, words overlap), checks the reply mentions the question's topic, then with a model asks a separate reviewer whether it addresses the question. A failing draft gets one rewrite, then falls back to source sentences for human review. |
| Voice | Generates speech after removing citations and formatting, which stay on screen |

The Verifier is a deterministic check, not a guarantee of correctness: it catches invented numbers and unsupported claims, not every misreading. Replies in a different script from the source are only checked on numbers and citations.

Documents that are processing or failed no longer block a client. They are skipped, named on the reply, and that reply requires review because it may be incomplete. Documents indexed before sentence-aware chunking keep their old passages until re-uploaded.

This is still a request-and-review flow rather than a hands-free conversation, and agents cannot take actions such as reminders or sending messages.

## Workflow and limits

- Create client spaces for students, patients, employees, customers or general clients. Staff in the same workspace share client files; personal voices and generated replies belong to their creator. This is workspace-level collaboration, not a patient-facing record portal or per-client ACL system.
- Upload PDF, DOCX, TXT, Markdown, CSV or JSON (20 MB; at most 50 files per client; up to 500,000 extracted characters per document). Passages are indexed locally with 384-dimensional hash embeddings and pgvector. Retrieval selects at most seven relevant passages, so summaries are **not exhaustive document audits**. OCR, images, spreadsheets, legacy `.doc`, and arbitrary binary formats are not supported.
- Record up to 90 seconds in the browser, upload up to 12 MB, or type up to 6,000 characters. Provider limits and costs also apply. A reply with a model makes up to five model calls.
- Queue workers retry transient failures up to three times. Failures that cannot clear by themselves, such as a missing key or a rejected request, stop immediately.
- Healthcare, HR, advisory, missing-source, partly searched, unverified and client-reply drafts require human approval. The app does not diagnose, prescribe, make employment/eligibility decisions, or send replies externally.
- Revoke a voice to erase its local reference and generated audio and block further use. The app attempts upstream profile deletion; if that fails, it tells you to remove the profile in the provider console. Revocation cannot recall previously downloaded copies.
- Delete a reply, individual document or client to remove its local records. Existing legacy privacy export/erasure tooling does **not** cover the voice tables.

## Website chat

Voice input on the public chat is off by default and set per workspace in **Voice settings**. The microphone is hidden until it is on and the workspace has connected its own transcription or VoiceStudio, so visitors never spend the operator's capacity unless the operator sets `WIDGET_SPEECH_USE_OPERATOR=true`. It requires explicit visitor consent and accepts up to 10 MB or 60 seconds. Playback uses the device's standard voice; the chat cannot reach staff clones or private client documents.

## Security and architecture

React 19, Router 7, Vite 7, custom light/dark CSS and a Vite PWA/Workbox shell. Node 24/Hono serves the API, dashboard and esbuild-bundled vanilla TypeScript widget. Production uses PostgreSQL/pgvector (Aiven TLS configuration remains in `docs/AIVEN.md`); local PGlite shares the SQL schema. The existing SSE bus uses PostgreSQL LISTEN/NOTIFY across instances.

Authentication reuses scrypt password hashes, signed HttpOnly session cookies, CSRF checks and role enforcement. AES-256-GCM protects provider keys, original file bytes, voice references and generated audio. Search chunks, transcripts, enrollment phrases, draft answers and audit metadata remain plaintext inside the access-controlled database. Rate limits are currently per-process, not globally distributed.

PWA installation caches the application shell, not private API responses or audio. True air-gapped operation requires local reasoning, transcription and cloning engines.

## Deployment and verification

To run on one GPU PC with no BYOK, using FreeToken and VoiceStudio, see `VOICE_PILOT.md`.

`render.yaml` is the hospital site and is unaffected by Voice. To deploy Voice, create a second Render Blueprint with its path set to `deploy/render.voice.yaml` and its own database. Set `PUBLIC_URL` to the deployed HTTPS origin. Production refuses to start with the development secret.

```powershell
pnpm typecheck
pnpm test
pnpm build
docker build -f deploy/Dockerfile -t fin-voice:local .
```

`apps/server/test/voice.test.ts` uses an explicitly synthetic HTTP speech fixture, not a real clone. Set `TEST_VOICE_DATABASE_URL` to a dedicated empty PostgreSQL/pgvector test database to run those tests on PostgreSQL. Never point tests at production.
