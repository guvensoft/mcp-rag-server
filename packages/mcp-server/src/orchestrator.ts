import fs from 'fs';
import path from 'path';
import http from 'http';
import { FileMeta, SearchResult } from '@mcp/shared';
import { rank_hybrid, pack_tokens, set_weights, RerankableResult } from './ranker';
import { GraphStore } from './graph_store';
import { profileContext, ContextProfile } from './context_profiler';
import { loadConfig, AppConfig } from './config';
import { RerankerClient } from './reranker_client';

interface EngineSearchResult {
  file: string;
  symbol: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}

export class Orchestrator {
  private fileIndex: Map<string, FileMeta> = new Map();
  private engineUrl: string;
  private graph?: GraphStore;
  private lastProfile: ContextProfile | null = null;
  private config: AppConfig;
  private reranker?: RerankerClient;

  constructor(dataDir: string, engineUrl: string = 'http://localhost:8000', graph?: GraphStore, configPath?: string) {
    this.engineUrl = engineUrl;
    this.loadIndex(dataDir);
    this.graph = graph;
    this.config = loadConfig(configPath);
    set_weights(this.config.ranking.weights);
    if (this.config.reranker.enabled) {
      this.reranker = new RerankerClient(this.config.reranker.url, this.config.reranker.endpoint);
    }
  }

  private loadIndex(dataDir: string) {
    const idxPath = path.join(dataDir, 'index.json');
    const json = fs.readFileSync(idxPath, 'utf8');
    const files: FileMeta[] = JSON.parse(json);
    for (const file of files) {
      this.fileIndex.set(file.path, file);
    }
  }

  public getFile(filePath: string): string {
    const fileMeta = this.fileIndex.get(filePath);
    if (!fileMeta) throw new Error(`File not found in index: ${filePath}`);
    return fileMeta.content;
  }

  public getLastProfile(): ContextProfile | null {
    return this.lastProfile ? { ...this.lastProfile } : null;
  }

  private async fetchEngineResults(query: string, topK: number): Promise<EngineSearchResult[]> {
    const url = new URL('/search', this.engineUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('top_k', topK.toString());
    return new Promise((resolve, reject) => {
      const req = http.get(url.toString(), res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(parsed.results as EngineSearchResult[]);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', err => reject(err));
    });
  }

  private async rerankIfEnabled(query: string, initial: RerankableResult[], topK: number) {
    if (!this.reranker) return initial;
    try {
      const reranked = await this.reranker.rerank(query, initial, topK);
      const map = new Map<string, number>();
      for (const r of reranked) {
        const key = `${r.file}:${r.symbol}:${r.startLine}:${r.endLine}`;
        map.set(key, r.rerankerScore);
      }
      return initial.map(r => {
        const key = `${r.file}:${r.symbol}:${r.startLine}:${r.endLine}`;
        const rerankerScore = map.get(key);
        return rerankerScore !== undefined ? { ...r, rerankerScore } : r;
      });
    } catch {
      return initial;
    }
  }

  public async searchCode(query: string, topK = 5): Promise<SearchResult[]> {
    const engineResults = await this.fetchEngineResults(query, topK);
    const initial: RerankableResult[] = engineResults.map(er => ({ ...er } as RerankableResult));
    const profile = profileContext(query, topK, this.config.chunking.windowTokenLimit);
    const withReranker = await this.rerankIfEnabled(query, initial, profile.effectiveTopK);
    const ranked = rank_hybrid(withReranker, query, this.graph ? (f => this.graph!.degree(f)) : undefined);
    let curated = pack_tokens(ranked, profile.tokenBudget, {
      charsPerToken: this.config.chunking.charsPerToken,
      useMMR: this.config.ranking.diversity.enableMMR,
      mmrLambda: this.config.ranking.diversity.lambda,
    });
    if (!curated.length) {
      curated = ranked.slice(0, Math.max(1, profile.effectiveTopK));
    }
    if (curated.length > profile.effectiveTopK) {
      curated = curated.slice(0, profile.effectiveTopK);
    }
    this.lastProfile = profile;
    return curated;
  }
}
