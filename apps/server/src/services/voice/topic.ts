import { overlap, stems } from "../../engine/extractive.ts";
import { splitSentences } from "../../lib/text.ts";
import type { Source } from "./catalog.ts";
import { saysFilesSilent } from "./claims.ts";
/** Markdown headings plus the short all-caps or Title Case lines that plain-text documents use. */
export function isHeading(line: string) {
  const text = line.trim();
  if (/^#{1,4}\s+\S/.test(text)) return true;
  if (!text || text.length > 80 || /[.!?:;,]$/.test(text) || !/\p{L}/u.test(text))
    return false;
  if (text === text.toUpperCase()) return true;
  const words = text.split(/\s+/);
  return (
    words.length <= 6 &&
    words.every((w) => /^(\p{Lu}|[-&/\d]|(of|and|the|for|to|in|on)$)/u.test(w))
  );
}
export interface SectionSentence {
  text: string;
  n: number;
}
/** Groups passages by heading, dropping sentences repeated by chunk overlap. */
export function sectionsOf(sources: Source[]) {
  const sections = new Map<string, SectionSentence[]>();
  const seen = new Set<string>();
  sources.forEach((source, i) => {
    let heading = "";
    for (const line of source.content.split("\n")) {
      if (isHeading(line)) {
        heading = line.replace(/^#+\s*/, "").trim();
        continue;
      }
      for (const text of splitSentences(line)) {
        const key = text.toLowerCase();
        if (text.length < 12 || seen.has(key)) continue;
        seen.add(key);
        const section = sections.get(heading) ?? [];
        section.push({ text, n: i + 1 });
        sections.set(heading, section);
      }
    }
  });
  return [...sections].map(([heading, sentences]) => ({ heading, sentences }));
}
/** Words that say what kind of thing is asked for, not which topic it is about. */
const askWords = stems(
  "allow allowed allowance amount benefit checklist copy draft each employee entitled entitlement explain get happens hire ignore joiner long look much many member money new once person policy receive reimbursement reply rule send sent staff starter summarize summary take tell telling time worker",
);
/** Lengths of time: a question's other words decide whether its topic is covered. */
const timeWords = stems("day days week weeks month months year years");
/** Everyday workplace wording that documents usually put differently, for replies without a model. */
const sameMeaning: [RegExp, string][] = [
  [/\b(paid time off|pto|time off|vacation( days?)?)\b/gi, "annual leave"],
  [/\b(roll(ing)?[- ]?over|carry(ing)? over)\b/gi, "carry forward"],
  [/\b(work(ing)? from home|wfh)\b/gi, "remote work"],
  [/\b(passports?|aadhaar|id proofs?|id cards?)\b/gi, "identity documents"],
  [/\bfirst[- ]day\b/gi, "day one"],
];
export const inDocumentWords = (question: string) =>
  sameMeaning.reduce((text, [from, to]) => text.replace(from, to), question);
/** The words that name the question's topic. Falls back to all its words if every one is generic. */
export function topicTerms(question: string) {
  const all = stems(inDocumentWords(question));
  const topic = [...all].filter((t) => !askWords.has(t));
  return topic.length ? topic : [...all];
}
export const mentions = (term: string, text: Set<string>) =>
  overlap(new Set([term]), text) > 0;
/** How rare each term is across the passages: unmatched terms map to 0, the rarest to the highest value. */
export function rarity(terms: string[], sentences: Set<string>[]) {
  return new Map(
    terms.map((term) => {
      const hits = sentences.filter((s) => mentions(term, s)).length;
      return [term, hits ? Math.log(1 + sentences.length / hits) : 0];
    }),
  );
}
export const sourceSentences = (sources: Source[]) =>
  sectionsOf(sources).flatMap((section) =>
    section.sentences.map((s) => stems(`${section.heading} ${s.text}`)),
  );
export const quotedInSources = (reply: string) => reply.replace(/\[\d+\]/g, " ");
/**
 * Being quoted from a source does not make a sentence an answer. A reply must mention the rarest
 * topic word the sources contain. `strict` also rejects a topic the sources never mention, for
 * extractive replies, which cannot tell that "vacation" means "annual leave" as a model can.
 */
export function addressesQuestion(
  question: string,
  task: string,
  reply: string,
  sources: Source[],
  strict: boolean,
) {
  if (task !== "answer" && task !== "reply") return { ok: true, term: null };
  const terms = topicTerms(question);
  const scores = rarity(terms, sourceSentences(sources));
  const named = terms.filter((t) => !timeWords.has(t));
  const absent = named.filter((t) => !scores.get(t));
  // Half or more: one unknown word in a longer question is usually just phrasing.
  if (strict && task === "answer" && named.length && absent.length * 2 >= named.length)
    return { ok: false, term: absent[0]! };
  const rarest = [...scores].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!rarest) return { ok: !strict, term: terms[0] ?? null };
  // A model may rephrase, and "9:30 AM" answers "what time": it need only stay on the topic.
  if (!strict) {
    const replied = stems(quotedInSources(reply));
    return {
      ok:
        saysFilesSilent.test(reply) ||
        [...scores].some(([t, s]) => s > 0 && mentions(t, replied)),
      term: rarest,
    };
  }
  return {
    ok: mentions(rarest, stems(quotedInSources(reply))),
    term: rarest,
  };
}
export const beforeOrAfter = /\b(before|after|prior|pre)\b/i;
export const dayScoped = /\b(first|day one|day 1|today)\b/i;
/** A question with a second part may be answered by sentences that share little with the first. */
export const twoParts = /\band\b.*\b(how|what|when|where|who|why|which)\b/i;
/** A request about one day should not repeat work from a section set before or after it. */
export function leavesDayScope(question: string, reply: string, sources: Source[]) {
  if (!dayScoped.test(question) || beforeOrAfter.test(question)) return false;
  if (/\b(before|prior to) (day one|day 1|the start date|starting)\b|\bpre-day-one\b/i.test(reply)) return true;
  const lines = reply.split("\n").flatMap(splitSentences).map((line) => stems(quotedInSources(line)));
  return sectionsOf(sources)
    .filter((section) => beforeOrAfter.test(section.heading))
    .some((section) =>
      section.sentences.some((s) => lines.some((line) => overlap(line, stems(s.text)) >= 0.6)),
    );
}
/** Whether a reply names most of the topic words the sources know. */
export function coversTopic(question: string, reply: string, sources: Source[]) {
  const scores = rarity(topicTerms(question), sourceSentences(sources));
  const known = [...scores].filter(([, s]) => s > 0).map(([t]) => t);
  const said = stems(quotedInSources(reply));
  return known.length > 0 && known.filter((t) => mentions(t, said)).length / known.length >= 0.6;
}
