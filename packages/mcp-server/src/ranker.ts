import { SearchResult } from '@mcp/shared';

export interface HybridSignals {
  semantic: number; // engine score [0..1]
  lexical: number;  // token hit ratio [0..1]
  graph: number;    // normalized degree [0..1]
}

let weights = { semantic: 0.6, lexical: 0.25, graph: 0.15 };
export function set_weights(w: { semantic: number; lexical: number; graph: number }) {
  const s = w.semantic + w.lexical + w.graph;
  weights = { semantic: w.semantic / s, lexical: w.lexical / s, graph: w.graph / s };
}

export function rank_hybrid(results: SearchResult[], query: string, fileDegree?: (file: string) => number): SearchResult[] {
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
  return results.map(r => {
    const snippetLower = r.snippet.toLowerCase();
    let hits = 0;
    for (const t of tokens) if (snippetLower.includes(t)) hits++;
    const lexical = tokens.length ? hits / tokens.length : 0;
    const graph = degrees.has(r.file) ? (degrees.get(r.file)! / maxDeg) : 0;
    const semantic = r.score; // assume engine score in [0..1]
    const score = semantic * weights.semantic + lexical * weights.lexical + graph * weights.graph;
    return { ...r, score };
  }).sort((a, b) => b.score - a.score);
}

export function pack_tokens(results: SearchResult[], budgetTokens: number): SearchResult[] {
  // naive token estimate: ~1 token per 4 chars
  const estimate = (s: string) => Math.ceil(s.length / 4);
  const selected: SearchResult[] = [];
  let used = 0;
  // MMR-like greedy selection with diversity by file
  const usedFiles = new Set<string>();
  for (const r of results) {
    const cost = estimate(r.snippet);
    if (used + cost > budgetTokens) continue;
    if (usedFiles.has(r.file)) continue; // diversity: one per file first
    selected.push(r);
    used += cost;
    usedFiles.add(r.file);
  }
  // fill remaining budget regardless of file if space left
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
