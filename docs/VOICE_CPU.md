# CPU voice deployment

## Architecture

Relay remains a TypeScript application: React/PWA, Hono API and widget. The separate open-source inference services use their native runtimes:

- VoiceStudio 0.5.7 + faster-whisper Small for transcription, selected through `/engines/select`. Base remains installed as the faster alternative; Small was selected after a real enrollment phrase mismatch.
- VoiceStudio + MOSS-TTS-Nano for ungated CPU reference-voice cloning. Its installer pins upstream commit `8b7bcc9341b3b4ef3a3a58ba1338a7d85ff133eb`; the checkpoint is `OpenMOSS-Team/MOSS-TTS-Nano-100M` and the tokenizer is `OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano`.
- PocketTTS 2.1.0 remains an optional English cloning engine if the account has gated model access. Its other languages need their own downloaded models and readiness metadata; this integration verifies PocketTTS English only.
- Colibri at commit `0a5504a1dc64f86fcd0fe7db298b0448c730e7e6`, with Ai2's Apache-2.0 OLMoE-1B-7B-0125-Instruct Q4_K_M. The GGUF revision is `2ac1d27317927518c9ef7bd99f91f3f1e4ee288d`.
- A TypeScript inference gateway authenticates every request and exposes only inference, model metadata and profile consent/revocation operations. Installation, settings, tokens and engine administration stay local.

The app downloads the completed WAV; this is record → process → review when required → speak, rather than streaming speech-to-speech. Playback is opt-in, with a Play fallback for phone browser restrictions. Old replies do not auto-play after reopening a page or changing clients.

## Local installation

Use `.env.voice`, which is ignored by git. Set `RELAY_SECRET`, `VOICE_DB_PASSWORD`, `OMNIVOICE_API_KEY`, `COLIBRI_API_KEY` and `INFERENCE_GATEWAY_SECRET` to separate random secrets. Never paste them into chat or commit them. Set `HTTPS_PROXY` and `NODE_USE_ENV_PROXY=1` only if this computer's container network needs a proxy.

```powershell
docker compose --env-file .env.voice -f deploy/docker-compose.voice.yml --profile voicestudio up -d voicestudio
```

Open `http://localhost:3900`, authenticate with the local admin key, and select Advanced in setup. Install/select MOSS-TTS-Nano, download its checkpoint and tokenizer, and download/select `Systran/faster-whisper-small`. Alternatively install PocketTTS, personally review its licence, obtain access at <https://huggingface.co/kyutai/pocket-tts>, and save a read token in Credentials. Never substitute the public **without-voice-cloning** weights for PocketTTS's gated cloning checkpoint.

The application checks actual cached cloning weights, tokenizer, backend availability and licence acknowledgement. VoiceStudio 0.5.7 omits PocketTTS from its model catalogue API; the gateway adds read-only metadata for the pinned English cloning checkpoint and checks its safetensors header/data length to reject incomplete files. Merely installing the Python package does not make cloning ready. A valid HF token can still receive 403 for the gated repository; check account access and fine-grained token permissions.

### Preserve existing VoiceStudio data

Older compose versions mounted `/app/omnivoice_data`, while this image actually wrote to `/root/.omnivoice`. Before recreating an older container, back up its `/root/.omnivoice` directory and SQLite database and migrate them into the existing `voicestudio-data` volume. This session copied the files and used SQLite's backup API before changing the mount. The corrected compose mounts the volume at `/root/.omnivoice` and keeps the Hugging Face cache there. Preserve the old container's hostname in `VOICESTUDIO_HOSTNAME` before recreation: this image can derive its stored-token encryption key from hostname and user. Fresh installs use a stable hostname. Do not recreate an older container until its live directory has been backed up.

### Colibri model

Download `OLMoE-1B-7B-0125-Instruct-Q4_K_M.gguf` from the pinned Ai2 revision above into `data/colibri-models/`. Import it using the same mounted path used by the service:

```powershell
docker compose --env-file .env.voice -f deploy/docker-compose.voice.yml --profile cpu-ai build colibri
docker volume create fin-voice_colibri-models
docker run --rm --network none --entrypoint python --mount "type=bind,source=$((Resolve-Path data/colibri-models).Path),target=/source,readonly" --mount type=volume,source=fin-voice_colibri-models,target=/models relay-colibri:cpu -c "import shutil; shutil.copyfile('/source/OLMoE-1B-7B-0125-Instruct-Q4_K_M.gguf','/models/OLMoE-1B-7B-0125-Instruct-Q4_K_M.gguf')"
docker run --rm --network none --entrypoint python --mount type=volume,source=fin-voice_colibri-models,target=/models relay-colibri:cpu /opt/colibri/coli import /models/OLMoE-1B-7B-0125-Instruct-Q4_K_M.gguf --out /models/olmoe-q4
```

The preparation container has a writable model mount and no network. The serving container's model mount remains read-only. Keep inference files in the native Docker volume: random expert reads through a Windows/OneDrive bind mount caused a two-minute answer timeout in this session.

Start `colibri` and `inference-gateway` after building the current app image:

```powershell
docker compose --env-file .env.voice -f deploy/docker-compose.voice.yml build app
docker compose --env-file .env.voice -f deploy/docker-compose.voice.yml --profile cpu-ai up -d --no-deps colibri inference-gateway
```

For the local app, set `VOICESTUDIO_URL=http://inference-gateway:8790/speech`, `VOICESTUDIO_API_KEY` to the gateway secret, `LLM_PROVIDER=colibri`, `LLM_BASE_URL=http://inference-gateway:8790/llm/v1`, `LLM_MODEL=relay-olmoe`, and `LLM_API_KEY` to the gateway secret. Recreate only the `app` service. Existing workspace settings can override these operator defaults; inspect them in the desk.

## Render connection

### Outbound worker (no tunnel)

Render reaches VoiceStudio without any inbound connection to this computer. The `speech-worker` service connects out to Render over HTTPS, long-polls for queued VoiceStudio requests, sends each to the local gateway and posts the answer back. Only `/speech/...` routes are forwarded, and the gateway still applies its own allow-list.

1. In `.env.voice`: `RELAY_URL=https://relay-voice-8knp.onrender.com` and a random `SPEECH_WORKER_SECRET` of at least 32 characters.
2. On Render: `VOICESTUDIO_URL=worker://relay/speech` and the same `SPEECH_WORKER_SECRET`, then redeploy.
3. Here, rebuild the image and start the worker: `docker compose --env-file .env.voice -f deploy/docker-compose.voice.yml --profile cpu-ai --profile voicestudio up -d --build speech-worker`.

The desk's readiness says "The voice computer is not connected" whenever the worker has not polled for 45 seconds. Requests are held in the web service's memory, so a Render restart drops in-flight speech work; the durable job queue then retries it. Render's free plan sleeps when idle; the worker's polling keeps it awake, which counts against the free monthly hours.

On 3 November 2026 a spoken question generated with VoiceStudio's bundled demo voice went from a local stand-in app through the worker to Whisper Small and came back correctly transcribed, with a sourced reply held for review, in 34 seconds.

### Inbound alternative

Keep models outside Render's small web-service container. Publish **only the authenticated gateway** through a stable HTTPS tunnel or an always-on server; never publish port 3900 or Colibri directly. A temporary Cloudflare quick tunnel is suitable only for an attended test: its hostname changes after restart, it has no pilot availability guarantee, and the computer must remain awake.

On Render, operator environment values point to `https://<gateway-host>/speech` and `https://<gateway-host>/llm/v1`, with the gateway secret for each corresponding key. The database, session secret and Aiven certificate stay unchanged. Do not log gateway or upstream keys. Workspace-owned custom speech URLs additionally require the operator's explicit hostname allow-list.

## Verification gates

1. Check app health and public signup (no access code).
2. Confirm unauthorized gateway requests return 401 and authenticated administrative paths return 404.
3. Confirm Whisper Base and the gated PocketTTS cloning weights are installed; stock speech alone is insufficient.
4. Test Colibri with short cited questions, paraphrases, missing information and source instructions. Keep the existing claim checks and human review.
5. The actual user enrolls their own voice by reading a fresh phrase. A synthesized fixture or another person's recording cannot establish their consent.
6. Record a real question, inspect transcript and citations, approve where required, play on a physical phone over HTTPS, download, revoke and verify the audio is inaccessible.
7. Record cold and warm times separately for transcription, reasoning and synthesis, plus total elapsed time. Do not infer production latency from an upstream benchmark or test fixture.

## Measurements from this session

On 2 November 2026, CPU Whisper Base correctly transcribed the synthetic question “How many annual leave days do employees receive?” in 45.4 seconds cold and 5.4 seconds warm while setup work was running. These are transcription measurements only; no end-to-end cloning latency or voice resemblance result is implied.

Primary documentation: [VoiceStudio PocketTTS](https://github.com/debpalash/VoiceStudio/blob/main/docs/engines/pockettts.md), [Colibri API](https://github.com/JustVugg/colibri/blob/main/docs/api.md), [Ai2 quantized model](https://huggingface.co/allenai/OLMoE-1B-7B-0125-Instruct-GGUF).
