/** Language, tokenization and chunking utilities. Unicode-aware so Indic scripts work. */

const scripts: [RegExp, string][] = [
  [/[ऀ-ॿ]/g, 'hi'], // Devanagari (Hindi, Marathi)
  [/[ಀ-೿]/g, 'kn'], // Kannada
  [/[஀-௿]/g, 'ta'], // Tamil
  [/[ఀ-౿]/g, 'te'], // Telugu
  [/[ഀ-ൿ]/g, 'ml'], // Malayalam
  [/[ঀ-৿]/g, 'bn'], // Bengali
  [/[઀-૿]/g, 'gu'], // Gujarati
  [/[਀-੿]/g, 'pa'], // Gurmukhi
  [/[؀-ۿ]/g, 'ur'], // Arabic script (Urdu)
];

export const languageNames: Record<string, string> = {
  en: 'English', hi: 'Hindi', kn: 'Kannada', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam',
  bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu',
};

export function detectLanguage(text: string): string {
  let best = 'en';
  let bestCount = 0;
  for (const [re, lang] of scripts) {
    const count = text.match(re)?.length ?? 0;
    if (count > bestCount) {
      best = lang;
      bestCount = count;
    }
  }
  return bestCount >= 2 ? best : 'en';
}

const stop = new Set(
  (
    'a an the is are was were be been am do does did i me my you your we our it its this that these those to of in on at for from by with and or ' +
    'but if then so can could would should will shall may might how what when where which who whom why please hi hello hey there any some ' +
    'have has had get got want need about tell know let us much many there here just also not no yes thanks thank ' +
    'है हैं का की के में से को और क्या कैसे मैं मेरा मेरी आप कृपया हो था ' +
    'ನಾನು ನನ್ನ ನೀವು ಏನು ಹೇಗೆ ಮತ್ತು ಇದೆ'
  ).split(' '),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize('NFC').match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? []).filter((t) => t.length > 1 || /\p{N}/u.test(t));
}

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !stop.has(t));
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?।॥])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface Chunk {
  title: string;
  content: string;
  url?: string;
}

/**
 * Split a markdown-ish document into ~maxChars chunks, keeping headings as context
 * and never splitting a "Q: ... A: ..." FAQ pair.
 */
export function chunkDocument(doc: string, opts: { title?: string; url?: string; maxChars?: number } = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 900;
  const blocks: { heading: string; text: string }[] = [];
  let heading = opts.title ?? '';
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) blocks.push({ heading, text });
    buf = [];
  };
  for (const line of doc.replace(/\r\n/g, '\n').split('\n')) {
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) {
      flush();
      heading = h[1]!.trim();
    } else if (/^\s*(Q|Question|प्रश्न|ಪ್ರಶ್ನೆ)\s*[:.]/i.test(line)) {
      flush();
      buf.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();

  const chunks: Chunk[] = [];
  for (const block of blocks) {
    const paragraphs = block.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let current = '';
    const push = () => {
      if (current.trim()) chunks.push({ title: block.heading, content: current.trim(), url: opts.url });
      current = '';
    };
    for (const p of paragraphs) {
      if (p.length > maxChars) {
        push();
        let piece = '';
        for (const s of splitSentences(p)) {
          if ((piece + ' ' + s).length > maxChars && piece) {
            chunks.push({ title: block.heading, content: piece.trim(), url: opts.url });
            // carry the last sentence over for context
            piece = piece.split(/(?<=[.!?।])\s+/).slice(-1)[0] ?? '';
          }
          piece += ' ' + s;
        }
        if (piece.trim()) chunks.push({ title: block.heading, content: piece.trim(), url: opts.url });
      } else if ((current + '\n\n' + p).length > maxChars) {
        push();
        current = p;
      } else {
        current = current ? current + '\n\n' + p : p;
      }
    }
    push();
  }
  return chunks;
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}
