# Voice completion and deployment plan

## Intended behavior

A person explicitly enrolls their own voice once by reading the server's consent phrase. Subsequent spoken questions use that enrolled profile; enrollment is not silently inferred from arbitrary recordings. The app transcribes, answers the actual question from the selected client's sources, pauses for required HR/healthcare/advisory review, and speaks the approved reply in the selected authorized voice. Automatic playback is opt-in and subject to the phone browser's playback restrictions. Completed audio remains downloadable.

## Execution order

1. Inspect the existing pipeline and verify actual engine status without downloading models or accepting licences.
2. Remove unnecessary local queue-poll latency after transactional job creation while retaining durable jobs and polling as recovery.
3. Make speech readiness fail closed when model installation cannot be confirmed. Handle failed upstream consent recording as a failed enrollment, with cleanup rather than silently reporting success.
4. Add explicit automatic playback for completed authorized audio, with a visible Play fallback when a browser blocks it. Preserve review gates and standard-device-voice labeling.
5. Display measured processing timings rather than promise an unmeasured response-time guarantee. No optimization may remove ownership checks, source review or consent revocation.
6. Test missing/stopped engines, enrollment failures, job dispatch, audio ownership and review behavior; run typechecks, the regression suite and production build.
7. Deploy the application changes to Render and verify its health and UI. Use the CPU route in VOICE_CPU.md: VoiceStudio/MOSS-TTS-Nano (or PocketTTS when access is granted), Whisper Base and Colibri, reached through an authenticated inference gateway. Model terms and gated Hugging Face access remain the user's actions.
8. The user enrolls their own voice. Measure cold and warm response time, then test recording, transcript, answer relevance, review, cloned speaker playback, download and revocation on a physical phone. Report failed and unmeasured gates.

## Current external dependencies

The user replaced the unavailable GPU route with an open-source CPU alternative and agreed to review PocketTTS's model terms personally. The CPU runtime removes the GPU requirement, but needs model downloads, gated cloning-weight access, an always-on host and a reachable HTTPS inference gateway. API keys must be entered in service/app settings; no licence acceptance or live voice phrase is performed on the user's behalf. Deploying app code alone does not validate live voice cloning.

## Performance boundary

The existing speech adapter receives a complete audio file before publishing it. Avoiding queue delay and adding automatic playback improves the current workflow, but it is not streaming speech-to-speech. True first-audio streaming must be implemented against the selected GPU engine's verified streaming protocol and measured on that engine. Correctness and the slowest connected service constrain latency; no specific response-time target is claimed without measurements.
