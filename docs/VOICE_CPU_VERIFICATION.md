# CPU voice verification — 2 November 2026

## Outcome and limits

The TypeScript app, protected inference gateway and local CPU services were implemented and tested. Application commit `7fbb86d` was deployed successfully to Render. Its health check returned PostgreSQL healthy, public registration did not require an access code, and the new playback control was present in the deployed asset.

The local app is connected to Colibri, Whisper and MOSS-TTS-Nano through the gateway. Render is **not yet connected to this PC**: the Docker quick tunnel could not contact Cloudflare's tunnel API, and automatic approval review rejected starting the native Cloudflare tunnel with “blocked by policy,” without a more specific reason. A manual tunnel startup was requested from the user. A stable always-on HTTPS worker remains necessary before sharing with testers.

The user attempted their own enrollment. The first attempt expired or reused its phrase; the next did not match the recognized phrase. Neither created a usable profile. The app was subsequently updated to show the recognized words on mismatch, display an expiry countdown, block expired submissions and offer a fresh-phrase button. The phrase-matching threshold was not relaxed, and the expected code words are never sent as an ASR prompt. English is specified only because the consent statement itself is English. Full user-voice enrollment, playback and download remain unverified until a successful fresh recording is made.

## Actual services

| Component | Result |
| --- | --- |
| VoiceStudio | 0.5.7, CPU, persistent data/HF cache; stable hostname preserved for stored-token decryption |
| Transcription | Whisper Base tested initially; upgraded to Whisper Small after the enrollment mismatch |
| PocketTTS | Installed and licence acknowledged by the user; saved HF token valid, but the provider still returned 403/not in authorized list for the cloning repository |
| MOSS-TTS-Nano | Ungated fallback installed from VoiceStudio's reviewed commit; torch/torchaudio 2.7.0+cpu; checkpoint and audio tokenizer downloaded |
| Colibri | Pinned engine, Ai2 OLMoE Q4_K_M, authenticated API; internal Host allow-list configured |
| Storage | Models moved from Windows/OneDrive bind mount to native Docker volume after a two-minute timeout |
| Inference gateway | Bearer authentication, inference/profile routes only; settings, installers and token administration excluded |

MOSS's stock installer initially fetched CUDA packages on this CPU-only container. It was stopped and the managed environment installed with `UV_NO_CONFIG=1` and `uv pip install --torch-backend cpu`; rerunning the installer verified the environment and persisted it. The CLI smoke test used a **synthetic reference** generated with the device voice, not a recording represented as the user's consent.

## Measured checks

| Check | Observed result |
| --- | --- |
| Whisper Base, synthetic question | Correct transcript; 45.4 s first call, 5.4 s repeated call during setup |
| Colibri before native storage | First completion exceeded 120 s |
| Colibri after native storage | Correct leave amount; 50.2 s first call, 1.25 s repeated prompt benefiting from warm cache |
| Actual app: synthetic recording → sourced draft | 54.8 s; correct transcript, 18-day answer with source; held for review |
| App verifier | Rejected Colibri's uncited draft and substituted sourced sentences; model connection alone is not proof of answer quality |
| MOSS reference synthesis | 89.3 s initial call including setup/loading, 11.5 s warm for one short sentence; 48 kHz output |
| Generated MOSS audio → ASR | Recognized “Employees receive 18 days of annual leave.” |
| Whisper Small, synthetic English question | Correct transcript in 5.6 s in one test |

These are individual measurements on this PC, not production percentiles or a streaming latency guarantee. Repeating the same Colibri prompt benefits from its cache. Voice resemblance to the user, physical-phone playback and total real-user speech-to-speech latency have not passed yet.

## Automated validation

- Full server suite after the main integration: 82 passed, one PostgreSQL-only test skipped in the PGlite run.
- Separate PostgreSQL voice and cross-instance event suite: all 33 passed, including real LISTEN/NOTIFY. An initial container attempt lacked the handbook fixture; mounting the fixture read-only resolved it.
- Enrollment-feedback follow-up: all 32 voice tests passed; mismatch text is returned only to the caller and is not stored in the audit payload.
- All workspace TypeScript checks passed; PWA, widget and Docker app builds succeeded.
- Gateway tests reject unauthorized requests and administrative paths and verify credential forwarding, audio bytes and incomplete-weight detection.
- A common secret-format scan of staged changes found zero matches. Local keys, enrollment recordings, test credentials, model files and screenshots remain outside git.

## Remaining acceptance steps

1. Establish the public HTTPS inference address and connect Render's operator speech/model settings with the gateway secret.
2. Enroll the user's own voice successfully; do not bypass a mismatch or expired phrase.
3. Approve a sample reply in that profile, play it, download it and confirm resemblance with the user.
4. Test the same flow on a physical phone over HTTPS, then run the real HR participant sessions. Keep source review and consent/revocation controls enabled.
