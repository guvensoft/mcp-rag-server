import fs from 'fs';
import path from 'path';

export interface ChunkingConfig {
  chunkTokenLimit: number;
  windowTokenLimit: number;
  overlapTokens: number;
  charsPerToken: number;
}

export interface RankingWeights {
  semantic: number;
  lexical: number;
  graph: number;
  reranker: number;
}

export interface DiversityConfig {
  enableMMR: boolean;
  lambda: number;
}

export interface RerankerConfig {
  enabled: boolean;
  url: string;
  endpoint: string;
}

export interface AppConfig {
  chunking: ChunkingConfig;
  ranking: { weights: RankingWeights; diversity: DiversityConfig };
  reranker: RerankerConfig;
}

const defaultConfig: AppConfig = {
  chunking: {
    chunkTokenLimit: 256,
    windowTokenLimit: 1400,
    overlapTokens: 32,
    charsPerToken: 4,
  },
  ranking: {
    weights: { semantic: 0.6, lexical: 0.2, graph: 0.1, reranker: 0.1 },
    diversity: { enableMMR: false, lambda: 0.3 },
  },
  reranker: {
    enabled: false,
    url: 'http://localhost:8000',
    endpoint: '/rerank',
  },
};

function normalizeWeights(w: RankingWeights): RankingWeights {
  const sum = w.semantic + w.lexical + w.graph + w.reranker;
  if (sum <= 0) return { ...defaultConfig.ranking.weights };
  return {
    semantic: w.semantic / sum,
    lexical: w.lexical / sum,
    graph: w.graph / sum,
    reranker: w.reranker / sum,
  };
}

function resolveConfigPath(custom?: string): string | undefined {
  if (custom && fs.existsSync(custom)) return custom;
  const envPath = process.env.RAG_CONFIG_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const defaultPath = path.join(process.cwd(), 'config', 'rag_config.json');
  if (fs.existsSync(defaultPath)) return defaultPath;
  const moduleRelative = path.resolve(__dirname, '..', '..', '..', 'config', 'rag_config.json');
  if (fs.existsSync(moduleRelative)) return moduleRelative;
  return undefined;
}

export function loadConfig(customPath?: string): AppConfig {
  const cfgPath = resolveConfigPath(customPath);
  if (!cfgPath) return { ...defaultConfig };
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Partial<AppConfig>;
    const weights = normalizeWeights({
      ...defaultConfig.ranking.weights,
      ...(parsed?.ranking?.weights || {}),
    });
    return {
      chunking: { ...defaultConfig.chunking, ...(parsed.chunking || {}) },
      ranking: {
        weights,
        diversity: { ...defaultConfig.ranking.diversity, ...(parsed.ranking?.diversity || {}) },
      },
      reranker: { ...defaultConfig.reranker, ...(parsed.reranker || {}) },
    };
  } catch {
    return { ...defaultConfig };
  }
}
