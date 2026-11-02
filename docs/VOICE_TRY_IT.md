# Try Relay Voice with your own cloned voice

The desk shows a **Step n of 7** guide at the top; each step has a button that takes you to the right place. These are the same steps, with what to do outside the app.

## 1. Run VoiceStudio beside the app

VoiceStudio turns recorded questions into text, clones your voice and speaks approved replies. It will not start without an admin key.

1. Put a long random `OMNIVOICE_API_KEY` in `.env.voice` (untracked).
2. Start it:

   ```bash
   docker compose --env-file .env.voice -f deploy/docker-compose.voice.yml --profile voicestudio up -d voicestudio
   ```

3. Open `http://localhost:3900` on the same computer. Download a speech-to-text model and a cloning model and accept their licences yourself. VoiceStudio's default cloning model, OmniVoice, is listed as **CC-BY-NC (non-commercial)**; for business use pick an engine whose licence allows it.

It runs on a CPU, slowly. A GPU makes cloned replies much faster.

## 2. Connect it in the desk

Sign in as an owner or admin, open the **VoiceStudio** tab, enter `http://voicestudio:3900` (or `http://localhost:3900` when the app runs outside Docker) and the key, then press **Save, test and use VoiceStudio**. The tab says exactly which models are still missing.

The app only accepts local addresses when the operator sets `SPEECH_ALLOW_PRIVATE_HOSTS=true`, as the voice compose file does. If the operator sets `VOICESTUDIO_URL`, new workspaces use that VoiceStudio without this step.

## 3. Clone your voice

**My voices** walks through it: get a phrase, record yourself reading it, listen back, confirm permission, **Clone my voice**. The recording is checked against the phrase before anything is cloned.

## 4. Add a client and a document, then ask

Add a client, upload a policy or guide under **Documents**, tick the consent box and either record or type a question. Without VoiceStudio's speech-to-text, **Speak your question** uses the browser's own speech recognition and types the words into the box (Chrome sends that audio to Google).

## 5. Approve in your voice

Edit the draft if needed, choose your voice under **Speak it in**, and press **Approve & speak in …**. A text-only reply can be voiced later the same way. The first cloned reply can take minutes while VoiceStudio loads its model; then play or download it.

## Hosted demo

The Render service has no VoiceStudio, so recording uses the browser fallback and replies stay text-only there. Cloning needs a VoiceStudio the app can reach over HTTPS, allowed by the operator in `SPEECH_STT_ALLOWED_HOSTS`.
