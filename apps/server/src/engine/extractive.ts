import { contentTokens, splitSentences } from '../lib/text.ts';
import type { Passage } from './retrieve.ts';

function stem(t: string): string {
  if (!/^[a-z]+$/.test(t) || t.length <= 4) return t;
  return t.replace(/(ing|edly|ed|es|s|ly)$/, '');
}

function stems(text: string): Set<string> {
  return new Set(contentTokens(text).map(stem));
}

function overlap(q: Set<string>, s: Set<string>): number {
  if (!q.size) return 0;
  let hit = 0;
  for (const t of q) {
    if (s.has(t)) hit++;
    else if (t.length >= 5 && [...s].some((x) => x.length >= 5 && (x.startsWith(t.slice(0, 5)) || t.startsWith(x.slice(0, 5))))) hit += 0.7;
  }
  return hit / q.size;
}

interface FaqPair {
  q: string;
  a: string;
}

const qLabel = /^\s*(?:Q|Question|प्रश्न|ಪ್ರಶ್ನೆ|கேள்வி)\s*[:.]\s*/i;
const aLabel = /^\s*(?:A|Answer|उत्तर|ಉತ್ತರ|பதில்)\s*[:.]\s*/i;

function parseFaq(content: string): FaqPair[] {
  const pairs: FaqPair[] = [];
  let cur: FaqPair | null = null;
  let inAnswer = false;
  for (const line of content.split('\n')) {
    if (qLabel.test(line)) {
      if (cur?.a) pairs.push(cur);
      cur = { q: line.replace(qLabel, '').trim(), a: '' };
      inAnswer = false;
    } else if (cur && aLabel.test(line)) {
      cur.a = line.replace(aLabel, '').trim();
      inAnswer = true;
    } else if (cur && inAnswer && line.trim()) {
      cur.a += '\n' + line.trim();
    } else if (cur && !inAnswer && line.trim()) {
      cur.q += ' ' + line.trim();
    }
  }
  if (cur?.a) pairs.push(cur);
  return pairs;
}

export interface Extracted {
  answer: string;
  confidence: number;
  cited: number[]; // indexes into passages
}

/** No-LLM answerer: picks the best FAQ answer or the most relevant sentences, with citations. */
export function extractiveAnswer(question: string, passages: Passage[]): Extracted {
  const q = stems(question);
  if (!passages.length || !q.size) return { answer: '', confidence: 0, cited: [] };

  // 1. FAQ pairs: match the customer's question against stored questions.
  let bestFaq: { pair: FaqPair; score: number; idx: number } | null = null;
  passages.forEach((p, idx) => {
    for (const pair of parseFaq(p.content)) {
      const qs = stems(pair.q);
      const score = (overlap(q, qs) + overlap(qs, q)) / 2 + 0.25 * overlap(q, stems(pair.a));
      if (!bestFaq || score > bestFaq.score) bestFaq = { pair, score, idx };
    }
  });
  const faq = bestFaq as { pair: FaqPair; score: number; idx: number } | null;
  if (faq && faq.score >= 0.45) {
    const sim = Math.min(1, (passages[faq.idx]!.similarity || 0.3) / 0.45);
    return { answer: faq.pair.a, confidence: Math.min(0.98, 0.75 * Math.min(1, faq.score) + 0.25 * sim), cited: [faq.idx] };
  }

  // 2. Sentence extraction from the top passages.
  const scored: { text: string; score: number; idx: number; pos: number }[] = [];
  passages.slice(0, 3).forEach((p, idx) => {
    // Never quote FAQ question lines back at the customer; keep only answer/body text.
    const body = p.content
      .split('\n')
      .filter((line) => !qLabel.test(line))
      .map((line) => line.replace(aLabel, ''))
      .join('\n');
    splitSentences(body).forEach((s, pos) => {
      if (s.length < 12) return;
      scored.push({ text: s, score: overlap(q, stems(p.title + ' ' + s)) * (1 - idx * 0.15), idx, pos });
    });
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < 0.2) return { answer: '', confidence: top?.score ?? 0, cited: [] };

  const picked = scored.filter((s) => s.idx === top.idx && s.score >= top.score * 0.6).slice(0, 3);
  picked.sort((a, b) => a.pos - b.pos);
  const answer = picked.map((s) => s.text).join(' ');
  const coverage = overlap(q, stems(passages[top.idx]!.title + ' ' + answer));
  const sim = Math.min(1, (passages[top.idx]!.similarity || 0.3) / 0.45);
  return { answer, confidence: Math.min(0.95, 0.7 * coverage + 0.3 * sim), cited: [top.idx] };
}
