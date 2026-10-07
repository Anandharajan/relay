import { createHash } from 'node:crypto';
import { config } from '../config.ts';
import { contentTokens } from '../lib/text.ts';

export interface Embedder {
  /** Stored alongside vectors; retrieval only compares vectors with the same model id. */
  id: string;
  embed(texts: string[]): Promise<number[][]>;
}

const DIM = 384;

function bucket(feature: string): [number, number] {
  const h = createHash('md5').update(feature).digest();
  return [h.readUInt32LE(0) % DIM, h[4]! & 1 ? 1 : -1];
}

/**
 * Feature-hashing embedder: word unigrams + bigrams + character trigrams.
 * Zero-cost, offline, script-agnostic (works for Hindi/Kannada/Tamil out of the box).
 * Lexical rather than semantic; plug in an embedding model for paraphrase-level recall.
 */
export const hashEmbedder: Embedder = {
  id: `hash-${DIM}-v1`,
  async embed(texts) {
    return texts.map((text) => {
      const v = new Float64Array(DIM);
      const toks = contentTokens(text);
      const add = (f: string, w: number) => {
        const [i, s] = bucket(f);
        v[i]! += s * w;
      };
      toks.forEach((t, i) => {
        add(`w:${t}`, 1);
        if (i > 0) add(`b:${toks[i - 1]} ${t}`, 0.5);
        const padded = ` ${t} `;
        const chars = [...padded];
        for (let j = 0; j + 3 <= chars.length; j++) add(`c:${chars.slice(j, j + 3).join('')}`, 0.3);
      });
      let norm = 0;
      for (const x of v) norm += x * x;
      norm = Math.sqrt(norm) || 1;
      return Array.from(v, (x) => x / norm);
    });
  },
};

/** Any OpenAI-compatible /embeddings endpoint (Ollama `nomic-embed-text`/`bge-m3`, OpenAI, LiteLLM, TEI...). */
function openAiEmbedder(model: string, baseUrl: string, apiKey: string): Embedder {
  return {
    id: `oa:${model}`,
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 64) {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({ model, input: texts.slice(i, i + 64) }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(`Embedding error ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = (await res.json()) as { data: { embedding: number[]; index: number }[] };
        out.push(...data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
      }
      return out;
    },
  };
}

let instance: Embedder | null = null;

export function getEmbedder(): Embedder {
  if (instance) return instance;
  const e = config.embed;
  instance = e.provider === 'hash' || !e.baseUrl ? hashEmbedder : openAiEmbedder(e.model || 'nomic-embed-text', e.baseUrl, e.apiKey);
  return instance;
}

export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',')}]`;
}
