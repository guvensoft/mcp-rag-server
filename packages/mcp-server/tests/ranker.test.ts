import { describe, it, expect } from 'vitest';
import { rank_hybrid, set_weights } from '../src/ranker';
import type { SearchResult } from '@mcp/shared';

describe('rank_hybrid', () => {
  it('combines signals and sorts', () => {
    set_weights({ semantic: 0.6, lexical: 0.3, graph: 0.1 });
    const res: SearchResult[] = [
      { file: 'a.ts', symbol: 'A.fn', startLine: 1, endLine: 5, score: 0.6, snippet: 'alpha beta' },
      { file: 'b.ts', symbol: 'B.fn', startLine: 1, endLine: 5, score: 0.5, snippet: 'beta gamma' }
    ];
    const ranked = rank_hybrid(res, 'beta', f => (f === 'b.ts' ? 2 : 1));
    expect(ranked[0].file).toBe('a.ts');
  });
});
