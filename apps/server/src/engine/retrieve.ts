import { ctx } from '../ctx.ts';
import { getEmbedder, toVectorLiteral } from '../adapters/embed.ts';
import { contentTokens } from '../lib/text.ts';

export interface Passage {
  id: string;
  sourceId: string;
  title: string;
  url: string | null;
  content: string;
  /** cosine similarity from the vector leg (0 if only matched by keywords) */
  similarity: number;
  /** keyword rank from the full-text leg (0 if only matched by vectors) */
  keyword: number;
  /** reciprocal-rank-fusion score */
  score: number;
}

/**
 * Hybrid retrieval: pgvector cosine top-k + Postgres full-text top-k, fused with RRF.
 * Every query is scoped by org_id (tenant isolation).
 */
export async function retrieve(orgId: string, query: string, k = 5): Promise<Passage[]> {
  const embedder = getEmbedder();
  const [vec] = await embedder.embed([query]);
  const terms = [...new Set(contentTokens(query))].slice(0, 16).map((t) => t.replace(/['"\\:&|!()<>*]/g, '')).filter(Boolean);

  const vectorRows = await ctx.db.query(
    `select id, source_id, title, url, content, 1 - (embedding <=> $2::vector) as sim
       from chunks where org_id = $1 and embed_model = $3
       order by embedding <=> $2::vector limit 12`,
    [orgId, toVectorLiteral(vec!), embedder.id],
  );
  const keywordRows = terms.length
    ? await ctx.db.query(
        `select id, source_id, title, url, content, ts_rank_cd(tsv, q) as rank
           from chunks, to_tsquery('simple', $2) q
          where org_id = $1 and tsv @@ q
          order by rank desc limit 12`,
        [orgId, terms.map((t) => `'${t}'`).join(' | ')],
      )
    : [];

  const fused = new Map<string, Passage>();
  const upsert = (r: any, rank: number) => {
    let p = fused.get(r.id);
    if (!p) {
      p = { id: r.id, sourceId: r.source_id, title: r.title, url: r.url, content: r.content, similarity: 0, keyword: 0, score: 0 };
      fused.set(r.id, p);
    }
    p.score += 1 / (60 + rank);
    return p;
  };
  vectorRows.forEach((r, i) => (upsert(r, i).similarity = Number(r.sim) || 0));
  keywordRows.forEach((r, i) => (upsert(r, i).keyword = Number(r.rank) || 0));
  return [...fused.values()]
    .filter((p) => p.similarity > 0.05 || p.keyword > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
