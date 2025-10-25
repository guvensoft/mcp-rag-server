export type ContextIntent = 'refactor' | 'test' | 'performance' | 'docs' | 'dataflow' | 'general';

export interface ContextProfile {
  intent: ContextIntent;
  tokenBudget: number;
  requestedTopK: number;
  effectiveTopK: number;
  notes: string[];
}

const KEYWORDS: Array<{ intent: ContextIntent; words: RegExp[]; budget: number; topK: number; note: string }> = [
  {
    intent: 'refactor',
    words: [/refactor/i, /rename/i, /cleanup/i, /architecture/i],
    budget: 1400,
    topK: 8,
    note: 'Refactor intent detected; widen snippet allocation.',
  },
  {
    intent: 'dataflow',
    words: [/data[\s-]?flow/i, /dependency/i, /graph/i, /call tree/i, /topolog/i],
    budget: 1300,
    topK: 7,
    note: 'Dataflow intent; prioritize dependency graph context.',
  },
  {
    intent: 'test',
    words: [/test/i, /assert/i, /coverage/i, /unit/i],
    budget: 900,
    topK: 6,
    note: 'Testing intent; focus on functions and call sites.',
  },
  {
    intent: 'performance',
    words: [/perf/i, /performance/i, /slow/i, /latenc/i, /optimi[sz]e/i],
    budget: 1100,
    topK: 7,
    note: 'Performance audit; include dependency graph context.',
  },
  {
    intent: 'docs',
    words: [/doc/i, /explain/i, /usage/i, /readme/i],
    budget: 700,
    topK: 5,
    note: 'Docs intent; concise summaries are sufficient.',
  },
];

export function profileContext(query: string, requestedTopK: number): ContextProfile {
  const trimmed = query.trim();
  for (const candidate of KEYWORDS) {
    if (candidate.words.some(re => re.test(trimmed))) {
      return {
        intent: candidate.intent,
        tokenBudget: candidate.budget,
        requestedTopK,
        effectiveTopK: Math.max(1, Math.min(candidate.topK, requestedTopK || candidate.topK)),
        notes: [candidate.note],
      };
    }
  }
  return {
    intent: 'general',
    tokenBudget: 600,
    requestedTopK,
    effectiveTopK: Math.max(1, Math.min(requestedTopK || 5, 5)),
    notes: ['General search; apply balanced context selection.'],
  };
}
