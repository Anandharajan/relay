import { ctx } from "../../ctx.ts";
import { encrypt } from "../../lib/crypto.ts";
import { speechConfig, synthesizeSpeech } from "../../adapters/speech.ts";
import { PermanentError } from "../../lib/permanent-error.ts";
import { speakable } from "../../lib/speakable.ts";
import { boardFor } from "./agent-board.ts";
import { voiceChanged } from "./catalog.ts";
export async function renderVoiceRun({
  runId,
  orgId,
}: {
  runId: string;
  orgId: string;
}) {
  const run = await ctx.db.one(
    "select * from voice_runs where id=$1 and org_id=$2",
    [runId, orgId],
  );
  if (
    !run ||
    !run.answer ||
    !run.approved_at ||
    (run.status === "ready" && run.output_enc)
  )
    return;
  const agents = boardFor(runId, orgId, run.steps);
  if (!run.voice_id) {
    agents.settle("speak", "Text reply ready; no cloned voice selected.", "skipped");
    await agents.save("ready_text");
    return;
  }
  try {
    const voice = await ctx.db.one(
      "select * from voice_profiles where id=$1 and org_id=$2 and user_id=$3 and revoked_at is null",
      [run.voice_id, orgId, run.user_id],
    );
    if (!voice)
      throw new PermanentError(
        "Voice consent was revoked or the voice is unavailable.",
      );
    await agents.start("speak", "synthesizing");
    const { settings, secrets } = await speechConfig(orgId);
    // Citations and formatting stay on screen; a voice must not read "bracket one" aloud.
    const spoken = speakable(run.answer);
    if (!spoken) throw new PermanentError("This reply has no words to speak.");
    const audio = await synthesizeSpeech(
      spoken,
      { provider: voice.provider, provider_id: voice.provider_id },
      settings,
      secrets,
    );
    await ctx.db.tx(async (db) => {
      const valid = await db.one(
        "select id from voice_profiles where id=$1 and org_id=$2 and user_id=$3 and revoked_at is null for share",
        [run.voice_id, orgId, run.user_id],
      );
      if (!valid)
        throw new PermanentError("Voice consent was revoked during generation.");
      agents.settle("speak", "Audio ready to play and download", "done");
      await db.query(
        "update voice_runs set output_enc=$2,output_mime=$3,status='ready',error=null,input_enc=null,steps=$5::jsonb,updated_at=now() where id=$1 and org_id=$4 and answer=$6 and approved_at is not null",
        [
          run.id,
          encrypt(Buffer.from(audio.data).toString("base64")),
          audio.mime,
          orgId,
          agents.board,
          run.answer,
        ],
      );
    });
    voiceChanged(orgId);
  } catch (e) {
    await agents.fail((e as Error).message);
    await ctx.db.query(
      "update voice_runs set status='audio_failed',error=$2,updated_at=now() where id=$1 and org_id=$3",
      [run.id, (e as Error).message.slice(0, 300), orgId],
    );
    voiceChanged(orgId);
    throw e;
  }
}
