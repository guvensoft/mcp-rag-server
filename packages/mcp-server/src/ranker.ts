import { SearchResult } from '@mcp/shared';

export interface HybridSignals {
  semantic: number; // engine score [0..1]
  lexical: number;  // token hit ratio [0..1]
  graph: number;    // normalized degree [0..1]
  reranker?: number; // optional reranker score
}

export interface HybridWeights {
  semantic: number;
  lexical: number;
  graph: number;
  reranker: number;
}

export interface PackTokenOptions {
  charsPerToken?: number;
  useMMR?: boolean;
  mmrLambda?: number;
}

let weights: HybridWeights = { semantic: 0.6, lexical: 0.25, graph: 0.1, reranker: 0.05 };
export function set_weights(w: HybridWeights) {
  const s = w.semantic + w.lexical + w.graph + w.reranker;
  if (s <= 0) return;
  weights = {
    semantic: w.semantic / s,
    lexical: w.lexical / s,
    graph: w.graph / s,
    reranker: w.reranker / s,
  };
}

export type RerankableResult = SearchResult & { rerankerScore?: number };

export function rank_hybrid(
  results: RerankableResult[],
  query: string,
  fileDegree?: (file: string) => number,
): RerankableResult[] {
  const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);
  const degrees = new Map<string, number>();
  let maxDeg = 1;
  if (fileDegree) {
    for (const r of results) {
      const d = fileDegree(r.file) || 0;
      degrees.set(r.file, d);
      if (d > maxDeg) maxDeg = d;
    }
  }
  return results
    .map(r => {
      const snippetLower = r.snippet.toLowerCase();
      let hits = 0;
      for (const t of tokens) if (snippetLower.includes(t)) hits++;
      const lexical = tokens.length ? hits / tokens.length : 0;
      const graph = degrees.has(r.file) ? degrees.get(r.file)! / maxDeg : 0;
      const semantic = r.score; // assume engine score in [0..1]
      const reranker = r.rerankerScore ?? semantic;
      const score =
        semantic * weights.semantic +
        lexical * weights.lexical +
        graph * weights.graph +
        reranker * weights.reranker;
      return { ...r, score, rerankerScore: r.rerankerScore ?? reranker };
    })
    .sort((a, b) => b.score - a.score);
}

function tokenEstimate(text: string, charsPerToken = 4) {
  return Math.max(1, Math.ceil(text.length / charsPerToken));
}

function similarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size || 1;
  return intersection / union;
}

export function pack_tokens(
  results: SearchResult[],
  budgetTokens: number,
  options: PackTokenOptions = {},
): SearchResult[] {
  const charsPerToken = options.charsPerToken ?? 4;
  const enableMMR = options.useMMR ?? false;
  const lambda = options.mmrLambda ?? 0.3;

  if (!enableMMR) {
    // original greedy strategy with per-file diversity
    const estimate = (s: string) => tokenEstimate(s, charsPerToken);
    const selected: SearchResult[] = [];
    let used = 0;
    const usedFiles = new Set<string>();
    for (const r of results) {
      const cost = estimate(r.snippet);
      if (used + cost > budgetTokens) continue;
      if (usedFiles.has(r.file)) continue; // diversity: one per file first
      selected.push(r);
      used += cost;
      usedFiles.add(r.file);
    }
    if (used < budgetTokens) {
      for (const r of results) {
        if (selected.includes(r)) continue;
        const cost = estimate(r.snippet);
        if (used + cost > budgetTokens) continue;
        selected.push(r);
        used += cost;
      }
    }
    return selected;
  }

  // MMR-based selection
  const remaining = [...results];
  const chosen: SearchResult[] = [];
  let budget = budgetTokens;
  while (remaining.length && budget > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const redundancy = chosen.length
        ? Math.max(...chosen.map(c => similarity(candidate.snippet, c.snippet)))
        : 0;
      const mmrScore = lambda * (candidate as any).score - (1 - lambda) * redundancy;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }
    const picked = remaining.splice(bestIdx, 1)[0];
    const cost = tokenEstimate(picked.snippet, charsPerToken);
    if (cost > budget) continue;
    chosen.push(picked);
    budget -= cost;
  }
  return chosen;
}
