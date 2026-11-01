import { ctx } from "../../ctx.ts";
import { decrypt } from "../../lib/crypto.ts";
import { speechConfig, transcribeAudio } from "../../adapters/speech.ts";
import { PermanentError } from "../../lib/permanent-error.ts";
import { speakable } from "../../lib/speakable.ts";
import { llmForOrg } from "../orgs.ts";
import { boardFor } from "./agent-board.ts";
import { notFoundReply, voiceChanged, type Citation } from "./catalog.ts";
import { extractiveDraft } from "./extractive-draft.ts";
import { isFollowUp, planRun } from "./model-agents.ts";
import { renderVoiceRun } from "./render.ts";
import { searchChunks } from "./retrieval.ts";
import { addressesQuestion, coversTopic, mentions, sourceSentences, topicTerms } from "./topic.ts";
import { writeWithModel } from "./writer.ts";
export async function processVoiceRun({
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
    ["ready", "ready_text", "review", "needs_input"].includes(run.status)
  )
    return;
  // Resume approved audio work without rewriting a draft a person has edited.
  if (run.status === "audio_failed" || (run.answer && run.approved_at))
    return renderVoiceRun({ runId, orgId });
  const agents = boardFor(runId, orgId, run.steps);
  if (!run.voice_id) agents.settle("speak", "Text only; no voice selected.", "skipped");
  try {
    let question = run.question;
    if (run.input_enc) {
      await agents.start("listen", "transcribing");
      const { settings, secrets } = await speechConfig(orgId);
      const transcript = await transcribeAudio(
        new Uint8Array(Buffer.from(decrypt(run.input_enc), "base64")),
        run.input_mime,
        settings,
        secrets,
      );
      question = (
        run.question
          ? transcript + "\nAdditional instructions: " + run.question
          : transcript
      ).slice(0, 6000);
      await ctx.db.query(
        "update voice_runs set question=$2,input_enc=null where id=$1",
        [run.id, question],
      );
      await agents.finish("listen", `Heard ${question.split(/\s+/).length} words.`);
    } else if (agents.board[0]!.status === "waiting")
      await agents.finish("listen", "Typed question; nothing to transcribe.", "skipped");
    const model = await llmForOrg(orgId);
    if (model.budgetExceeded)
      throw new PermanentError(
        "The workspace reasoning budget is exhausted. Update the budget in AI settings.",
      );
    if (model.keyMissing)
      throw new PermanentError(
        "Your selected reasoning provider needs an API key in Settings.",
      );
    // The same question, already approved for this client on unchanged files, costs no tokens.
    if (model.llm) {
      const previous = await ctx.db.one(
        `select r.answer,r.citations from voice_runs r
         where r.client_id=$1 and r.org_id=$2 and r.id<>$3 and r.task=$4 and r.profession=$5
           and lower(trim(r.question))=lower(trim($6)) and r.approved_at is not null and r.answer<>'' and r.answer<>$7
           and r.approved_at > coalesce((select max(d.created_at) from voice_documents d where d.client_id=$1 and d.org_id=$2), r.approved_at - interval '1 second')
           and not exists (select 1 from voice_documents d where d.client_id=$1 and d.org_id=$2 and d.status<>'ready')
         order by r.approved_at desc limit 1`,
        [run.client_id, orgId, run.id, run.task, run.profession, question, notFoundReply],
      );
      if (previous) {
        for (const id of ["plan", "research", "write", "verify"] as const)
          agents.settle(id, id === "write" ? "Reused your approved answer to this question; no model call." : "Not needed.", "skipped");
        await ctx.db.query(
          "update voice_runs set answer=$2,citations=$3::jsonb,status='review',approved_at=null,error=null,updated_at=now(),steps=$4::jsonb where id=$1",
          [run.id, previous.answer, JSON.stringify(previous.citations), agents.board],
        );
        voiceChanged(orgId);
        return;
      }
    }
    await agents.start("plan", "planning");
    const documents = await ctx.db.query(
      "select id,name,status from voice_documents where client_id=$1 and org_id=$2 order by created_at",
      [run.client_id, orgId],
    );
    const ready = documents.filter((d) => d.status === "ready");
    const skipped = documents
      .filter((d) => d.status !== "ready")
      .map((d) => ({
        name: d.name,
        reason:
          d.status === "failed" ? "could not be read" : "is still processing",
      }));
    const earlier = (
      await ctx.db.query(
        "select question,answer from voice_runs where client_id=$1 and org_id=$2 and user_id=$3 and id<>$4 and approved_at is not null and answer<>'' order by created_at desc limit 3",
        [run.client_id, orgId, run.user_id, run.id],
      )
    ).map((r) => ({
      question: String(r.question).slice(0, 300),
      answer: speakable(String(r.answer)).slice(0, 400),
    }));
    const plan = await planRun(
      model.llm,
      orgId,
      question,
      ready.map((d) => d.name),
      earlier,
      !run.clarified,
    );
    if (plan.clarify) {
      agents.settle("plan", `Asked: ${plan.clarify}`, "done");
      await ctx.db.query(
        "update voice_runs set clarify_question=$2,clarified=true,error=null where id=$1",
        [run.id, plan.clarify],
      );
      await agents.save("needs_input");
      return;
    }
    await agents.finish(
      "plan",
      `${plan.queries.length} search${plan.queries.length === 1 ? "" : "es"} across ${plan.documents.length || ready.length} of ${ready.length} ready document${ready.length === 1 ? "" : "s"}.`,
    );
    await agents.start("research", "retrieving");
    const chosen = plan.documents.map((n) => ready[n - 1]!.id);
    let rows = await searchChunks(orgId, run.client_id, plan.queries, chosen);
    if (chosen.length && !rows.length)
      rows = await searchChunks(orgId, run.client_id, plan.queries, []);
    const sources =
      run.task === "summary" ? rows : rows.filter((r) => Number(r.score) > 0.08);
    const citations: Citation[] = sources.map((s, i) => ({
      n: i + 1,
      title: s.title,
      documentId: s.document_id,
      excerpt: s.content,
    }));
    await agents.finish(
      "research",
      `${sources.length} relevant passage${sources.length === 1 ? "" : "s"} from ${new Set(sources.map((s) => s.document_id)).size} document(s).` +
        (skipped.length ? ` ${skipped.length} not searched.` : ""),
    );
    await agents.start(
      "write",
      "drafting",
      model.llm ? undefined : "Picking the sentences that answer the question",
    );
    const candidate = sources.length
      ? extractiveDraft(question, run.task, sources)
      : "";
    // A quoted sentence on another topic is worse than saying nothing was found.
    const extracted =
      candidate &&
      addressesQuestion(question, run.task, candidate, sources, true).ok
        ? candidate
        : "";
    let reply = extracted || notFoundReply;
    let verified = false;
    let modelFailed = false;
    const noModelNote = (done: string) =>
      plan.modelDown || modelFailed
        ? `The AI model did not respond. ${done}`
        : done;
    const followUp = earlier.length > 0 && isFollowUp(question);
    // When no passage mentions the topic there is nothing for a model to write from.
    const known = sourceSentences(sources);
    const topicFound =
      followUp ||
      (run.task !== "answer" && run.task !== "reply") ||
      topicTerms(question).some((t) => known.some((s) => mentions(t, s)));
    // BYOK tokens are the customer's money: a confident answer quoted from the files needs no model.
    const answeredFromFiles =
      model.byok && run.task === "answer" && !followUp && !!extracted && coversTopic(question, extracted, sources);
    const askModel =
      !!model.llm && sources.length > 0 && !plan.modelDown && topicFound && !answeredFromFiles;
    if (askModel) try {
      ({ reply, verified } = await writeWithModel({
        llm: model.llm!,
        orgId,
        question,
        task: run.task,
        profession: run.profession,
        sources,
        citations,
        followUp,
        earlier,
        extracted,
        agents,
      }));
    } catch (e) {
      // Keep a usable reply: an unreachable or refusing model must not cost the person their answer.
      console.error("[voice] model failed, using source sentences:", (e as Error).message);
      modelFailed = true;
      reply = extracted || notFoundReply;
      verified = false;
    }
    if (!askModel || modelFailed) {
      await agents.finish(
        "write",
        noModelNote(
          extracted
            ? "Extractive mode: sentences selected, no AI rewrite."
            : "No answer found in the selected sources.",
        ),
      );
      verified = !!extracted && !plan.modelDown && !modelFailed;
      await agents.finish(
        "verify",
        extracted
          ? "Quoted from the sources and mentions the question's topic. Check it answers the question."
          : "Nothing to check.",
        extracted ? "done" : "skipped",
      );
    }
    // Regulated/high-impact professional contexts always require an explicit human review.
    const client = await ctx.db.one(
      "select kind from voice_clients where id=$1 and org_id=$2",
      [run.client_id, orgId],
    );
    const needsReview =
      ["healthcare", "hr", "advisory"].includes(run.profession) ||
      ["patient", "employee"].includes(client?.kind) ||
      !verified ||
      !sources.length ||
      skipped.length > 0 ||
      run.task === "reply";
    await ctx.db.query(
      "update voice_runs set answer=$2,citations=$3::jsonb,skipped_documents=$4::jsonb,status=$5,approved_at=case when $6::boolean then null else now() end,error=null,clarify_question=null,updated_at=now() where id=$1",
      [
        run.id,
        reply,
        // Passages that did not answer the question are not its sources.
        reply === notFoundReply ? [] : citations,
        skipped,
        needsReview ? "review" : "drafted",
        needsReview,
      ],
    );
    voiceChanged(orgId);
    if (needsReview) return;
    await renderVoiceRun({ runId: run.id, orgId });
  } catch (e) {
    await agents.fail((e as Error).message);
    await ctx.db.query(
      "update voice_runs set status='failed',error=$2,updated_at=now() where id=$1 and org_id=$3 and status<>'audio_failed'",
      [run.id, (e as Error).message.slice(0, 300), orgId],
    );
    voiceChanged(orgId);
    throw e;
  }
}
