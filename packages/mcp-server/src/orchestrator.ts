import fs from 'fs';
import path from 'path';
import http from 'http';
import { FileMeta, SearchResult } from '@mcp/shared';
import { rank_hybrid, pack_tokens } from './ranker';
import { GraphStore } from './graph_store';
import { profileContext, ContextProfile } from './context_profiler';

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

  constructor(dataDir: string, engineUrl: string = 'http://localhost:8000', graph?: GraphStore) {
    this.engineUrl = engineUrl;
    this.loadIndex(dataDir);
    this.graph = graph;
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

  public async searchCode(query: string, topK = 5): Promise<SearchResult[]> {
    const url = new URL('/search', this.engineUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('top_k', topK.toString());
    const engineResults: EngineSearchResult[] = await new Promise((resolve, reject) => {
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
    const initial: SearchResult[] = engineResults.map(er => ({ ...er } as SearchResult));
    const profile = profileContext(query, topK);
    const ranked = rank_hybrid(initial, query, this.graph ? (f => this.graph!.degree(f)) : undefined);
    let curated = pack_tokens(ranked, profile.tokenBudget);
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
