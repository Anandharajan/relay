import { extractiveAnswer, overlap, stems } from "../../engine/extractive.ts";
import type { Passage } from "../../engine/retrieve.ts";
import type { Source } from "./catalog.ts";
import {
  beforeOrAfter,
  dayScoped,
  inDocumentWords,
  mentions,
  rarity,
  sectionsOf,
  sourceSentences,
  topicTerms,
  twoParts,
  type SectionSentence,
} from "./topic.ts";
function toPassage(s: Source): Passage {
  return {
    id: s.id,
    sourceId: s.document_id,
    title: s.title,
    url: null,
    content: s.content,
    similarity: Number(s.score),
    keyword: 0,
    score: Number(s.score),
  };
}
function clockMinutes(text: string) {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!m) return Infinity;
  return (
    ((Number(m[1]) % 12) + (m[3]!.toLowerCase() === "pm" ? 12 : 0)) * 60 +
    Number(m[2] ?? 0)
  );
}
const cited = (sentences: SectionSentence[]) =>
  sentences
    .map((s, i) =>
      sentences[i + 1]?.n === s.n ? s.text : `${s.text} [${s.n}]`,
    )
    .join(" ");
/** Without a model, assemble the reply from whole source sentences, always cited. */
export function extractiveDraft(question: string, task: string, sources: Source[]) {
  if (sources.some((s) => /^\s*(Q|Question)\s*[:.]/im.test(s.content))) {
    const found = extractiveAnswer(question, sources.map(toPassage));
    if (found.answer) return `${found.answer} [${found.cited[0]! + 1}]`;
  }
  const q = stems(inDocumentWords(question));
  const terms = topicTerms(question);
  const scores = rarity(terms, sourceSentences(sources));
  const total = [...scores.values()].reduce((sum, s) => sum + s, 0);
  /** The share of the question's topic a text covers, with rare words counting most. */
  const coverage = (text: Set<string>) =>
    total
      ? terms.reduce((sum, t) => sum + (mentions(t, text) ? scores.get(t)! : 0), 0) / total
      : 0;
  // A prohibition rarely answers a factual question, unless the question is about what is allowed.
  const askingLimits = /\b(can|may|should|allowed|must)\b/i.test(question);
  const weight = (text: string) =>
    !askingLimits && /^(do not|don.t|never)\b/i.test(text) ? 0.5 : 1;
  const scored = sectionsOf(sources).map((section) => {
    const label = stems(section.heading);
    const best = Math.max(
      ...section.sentences.map(
        (s) => weight(s.text) * coverage(new Set([...label, ...stems(s.text)])),
      ),
    );
    return { ...section, best, heading_match: overlap(q, label) };
  });
  if (task === "answer" || task === "reply") {
    const oneDay = dayScoped.test(question) && !beforeOrAfter.test(question);
    const top = scored
      .filter((s) => !oneDay || !beforeOrAfter.test(s.heading))
      .sort((a, b) => b.best - a.best || b.heading_match - a.heading_match)[0];
    if (!top || top.best < 0.2) return "";
    // A drafted reply tells the whole of its section, in the order things happen.
    if (task === "reply")
      return cited(
        top.sentences
          .map((s, i) => ({ s, i, at: clockMinutes(s.text) }))
          .sort((a, b) => a.at - b.at || a.i - b.i)
          .slice(0, 6)
          .map(({ s }) => s),
      );
    // Stay in the best section, so a sentence sharing one word elsewhere cannot leak in.
    const candidates = top.sentences
      .map((s, i) => ({ s, i, score: weight(s.text) * coverage(stems(s.text)) }))
      .filter((r) => r.score > 0);
    // Neighbouring facts are noise unless the question has a second part they may answer.
    const floor = twoParts.test(question)
      ? 0
      : Math.max(0, ...candidates.map((r) => r.score)) * 0.5;
    const ranked = candidates
      .filter((r) => r.score >= floor)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, 3)
      .sort((a, b) => a.i - b.i)
      .map((r) => r.s);
    return cited(ranked.length ? ranked : top.sentences.slice(0, 1));
  }
  if (task === "checklist") {
    // A checklist needs every step of the matching sections, not the single best sentence.
    const topHeading = Math.max(0, ...scored.map((s) => s.heading_match));
    const matching = topHeading
      ? scored.filter((s) => s.heading_match >= topHeading * 0.6)
      : scored.filter((s) => s.best >= 0.2);
    // A request for one day excludes work before or after it, unless it asks for that too.
    const inScope = dayScoped.test(question) && !beforeOrAfter.test(question)
      ? matching.filter((s) => !beforeOrAfter.test(s.heading))
      : matching;
    const chosen = (inScope.length ? inScope : matching).sort(
      (a, b) => Number(/\bbefore\b/i.test(b.heading)) - Number(/\bbefore\b/i.test(a.heading)),
    );
    return chosen
      .map((section) => {
        const steps = section.sentences
          .map((s, i) => ({ s, i, at: clockMinutes(s.text) }))
          .sort((a, b) => a.at - b.at || a.i - b.i)
          .map(({ s }) => `- ${s.text} [${s.n}]`);
        return [section.heading && `${section.heading}:`, ...steps]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  }
  const ordered = [...scored].sort((a, b) => b.best - a.best);
  const topScore = ordered[0]?.best ?? 0;
  // A summary of one topic stays on it; a request naming nothing in the files gets an overview.
  if (topScore > 0)
    return ordered
      .filter((section) => section.best >= topScore * 0.5)
      .slice(0, 3)
      .map((section) => cited(section.sentences.slice(0, 4)))
      .join(" ");
  return ordered
    .slice(0, 3)
    .map((section) => cited(section.sentences.slice(0, 2)))
    .join(" ");
}
