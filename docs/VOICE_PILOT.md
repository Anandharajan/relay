# Relay Voice pilot on one GPU PC

Runs the whole product on one machine, with no BYOK. **Not yet run on real hardware.** The compose file and scripts have only been reviewed; speed, GPU sharing and voice quality are unmeasured.

## Architecture

```
Phone or browser (split screen: chat left, agents right)
      │ HTTPS
Cloudflare tunnel ── the only way in
      │
Relay app (Hono) ── Postgres + pgvector: runs, documents, durable job queue
      │
Job: voice_process
  Transcriber ──────► VoiceStudio  /v1/audio/transcriptions   (speech to text)
  Planner ──────────► FreeToken    /v1/chat/completions       (search queries, documents)
  Researcher ───────► Postgres                                (this client's passages only)
  Writer ───────────► FreeToken                               (cited draft)
  Verifier ─────────► code checks, then FreeToken as reviewer (sources, topic, on-question)
      │
      ├─ needs review (HR, healthcare, advisory, unverified) ─► person approves in chat
      ▼
Job: voice_render
  Voice ────────────► VoiceStudio  /v1/audio/speech           (reply in the enrolled voice)
```

Each model agent is a separate stateless call with its own instructions. Most replies make one model call or none, and the most a reply can make is five: plan (follow-ups only), write, review (only when the draft barely touches the topic), and one rewrite with a second review (only when no source sentences can answer).

To keep tokens and waiting down, the model receives only the sentences relevant to the question, up to a fixed size for each task. With a BYOK provider, a clear answer quoted from the files makes no model call. An approved answer to the same question comes back for review without a model call, unless a document has been added since. A question whose topic no passage mentions gets "could not find" without one.

On this PC, choosing quantized model weights is the main way to fit the model and speech engines in GPU memory and speed up answers. Measure answer quality before and after choosing them.

| If this stops | The person gets |
| --- | --- |
| FreeToken | A reply quoting source sentences, held for review, with the board saying the model did not respond |
| VoiceStudio, transcribing | The run fails after retries; typing still works |
| VoiceStudio, speaking | The text reply stays, status `audio_failed`, and approving retries the audio |
| The app, mid-run | The job is retried once it has been idle for `JOB_STALE_MINUTES` (default 10) |

Voice enrollment still needs the live phrase described in `VOICE_DESK.md`. Only the person being cloned can do it.

## Install

1. **Check the machine.** Nothing is changed by this:

   ```bash
   bash deploy/pilot-preflight.sh
   ```

   The default preflight does not pull images or start containers. Read and report its results before installing anything. CUDA must be version 13, not merely any `nvcc` executable. GPU access inside Docker remains unverified until explicitly probed: after reviewing the static results and caching the image through the installation steps, run `PILOT_GPU_PROBE=1 bash deploy/pilot-preflight.sh`. That probe uses `--pull=never` and no network, and never downloads an image automatically. Do not run the pilot inside Docker Desktop's internal `docker-desktop` WSL distribution; use the intended Linux host or a user-managed Linux WSL2 distribution.

2. **Create `.env.pilot`** (untracked) with independently generated random secrets: `RELAY_SECRET`, `VOICE_DB_PASSWORD`, `OMNIVOICE_API_KEY`, `FREETOKEN_API_KEY`, `SIGNUP_INVITE_CODE`. Add `PUBLIC_URL`, `CLOUDFLARE_TUNNEL_TOKEN` and `FREETOKEN_MODEL`.

3. **Start FreeToken on the host.** Review the model's licence on its model card first. The key is required because auth is off by default. Docker containers reach the host through its gateway address, so bind to that address rather than `0.0.0.0`, and keep port 1919 closed in the firewall. The `--memory-ratio` value is a starting point that leaves room for speech engines:

   ```bash
   FREETOKEN_API_KEY=... ft serve --model <model> --host <docker-gateway-ip> --memory-ratio 0.5
   ```

4. **Start the stack:**

   ```bash
   docker compose --env-file .env.pilot -f deploy/docker-compose.pilot.yml up -d --build
   ```

5. **Set up VoiceStudio** at `http://localhost:3900` on that PC. **You accept licences yourself.** Download a speech-to-text model and a cloning engine whose licence allows business use. Do not use the default OmniVoice engine, which lists CC-BY-NC.

6. **In the app,** open Voice settings, set the cloning provider to VoiceStudio and pick that engine. Enroll your voice on a phone over the HTTPS address.

7. **Schedule `deploy/pilot-backup.sh`,** and store `RELAY_SECRET` separately.

## Before sharing the link

- The regression set has no wrong or off-topic answers on the hosted app.
- Typical questions get a first response within 10 seconds.
- No timeouts with 3 people at once.
- Recording, transcription, enrollment, cloned playback, download and revocation all work on a physical phone.
- Stopping FreeToken and VoiceStudio mid-run behaves as in the table above.

If a check fails, don't describe the pilot as ready. Use fictional or consented data only, and tell participants the service runs on one machine and is down when it is off.
