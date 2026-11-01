import { contentTokens, splitSentences } from "../../lib/text.ts";
import type { Citation } from "./catalog.ts";
const prefix = (t: string) => t.slice(0, 5);
const claimFree =
  /\b(could not find|couldn.t find|not (contain|mention|say|state|include|specif|cover|provide)|no information|missing|unclear|does not)/i;
/** A sentence saying the files are silent. It cannot be checked against them, and has no facts to check. */
export const saysFilesSilent =
  /\b(excerpts?|documents?|handbook|sources?|files?|information)\b.*\b(not (contain|mention|say|state|include|specif|cover|provide|define)|no information)|\b(could not find|couldn.t find|no information)\b/i;
/** Some open-weight models write 【3】 or 【3†source】 for [3], and typographic hyphens that hide a word from the source check. */
export const plainCitations = (text: string) =>
  text.replace(/【\s*(\d+)[^】]*】/g, "[$1]").replace(/[‐-–]/g, "-");
/** Deterministic check: each sentence needs a valid citation whose passage really contains its facts. */
export function verifyClaims(text: string, citations: Citation[]) {
  const problems: string[] = [];
  const sentences: string[] = [];
  for (const line of splitSentences(text)) {
    // A citation pushed past the full stop belongs to the sentence before it.
    if (/^(\[\d+\][\s.,;]*)+$/.test(line) && sentences.length)
      sentences[sentences.length - 1] += " " + line;
    else sentences.push(line);
  }
  let checked = 0;
  const refsIn = (sentence: string) =>
    [...sentence.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  for (const [i, sentence] of sentences.entries()) {
    // One citation can close a run of sentences; each is still checked against that source.
    const refs = refsIn(sentence).length
      ? refsIn(sentence)
      : (sentences.slice(i + 1).map(refsIn).find((r) => r.length) ?? []);
    const claim = sentence.replace(/\[\d+\]/g, " ");
    const words = contentTokens(claim);
    if (saysFilesSilent.test(claim) && !/\d/.test(claim)) continue;
    if (refs.some((n) => n < 1 || n > citations.length)) {
      problems.push(`Cites a source that does not exist: “${claim.trim()}”`);
      continue;
    }
    if (!refs.length) {
      if (words.length >= 4 && !claimFree.test(claim))
        problems.push(`No citation: “${claim.trim()}”`);
      continue;
    }
    checked++;
    const source = refs
      .map((n) => citations[n - 1]!.excerpt)
      .join(" ")
      .toLowerCase();
    const sourceWords = new Set(contentTokens(source).map(prefix));
    const missing = (claim.match(/\d[\d.,:]*\d|\d/g) ?? []).filter(
      (n) => !source.includes(n),
    );
    // Word overlap only means something in the source's script; translations rely on the numbers.
    const latin = /^[\x00-\x7f]*$/.test(claim);
    const support = words.length
      ? words.filter((w) => sourceWords.has(prefix(w))).length / words.length
      : 1;
    if (missing.length || (latin && support < 0.5))
      problems.push(`Not found in source [${refs.join(", ")}]: “${claim.trim()}”`);
  }
  if (!checked && !claimFree.test(text)) problems.push("No claim is cited.");
  return { ok: !problems.length, checked, problems };
}
