/**
 * The orchestrator coordinates between the local TypeScript index and the
 * Python semantic engine. It exposes simple functions for fetching file
 * contents and performing semantic searches. Results from the semantic
 * engine are combined with a lightweight lexical heuristic to improve
 * relevance. This module is used both by the HTTP server and unit tests.
 */

import fs from 'fs';
import path from 'path';
import { FileMeta, SearchResult } from './types';
import http from 'http';

interface EngineSearchResult {
  file: string;
  symbol: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}

/**
 * Orchestrator class encapsulates access to the index and remote semantic
 * engine. It reads the precomputed index from disk and exposes methods
 * for retrieving files and performing searches.
 */
export class Orchestrator {
  private fileIndex: Map<string, FileMeta> = new Map();
  private engineUrl: string;

  constructor(dataDir: string, engineUrl: string = 'http://localhost:8000') {
    this.engineUrl = engineUrl;
    this.loadIndex(dataDir);
  }

  /**
   * Load the file metadata index from the specified directory. The file
   * `index.json` is expected to contain an array of FileMeta objects.
   */
  private loadIndex(dataDir: string) {
    const idxPath = path.join(dataDir, 'index.json');
    const json = fs.readFileSync(idxPath, 'utf8');
    const files: FileMeta[] = JSON.parse(json);
    for (const file of files) {
      // Use relative path as key for lookup.
      this.fileIndex.set(file.path, file);
    }
  }

  /**
   * Retrieve the contents of a file by its relative path. Throws if the
   * file cannot be found in the index.
   */
  public getFile(filePath: string): string {
    const fileMeta = this.fileIndex.get(filePath);
    if (!fileMeta) {
      throw new Error(`File not found in index: ${filePath}`);
    }
    return fileMeta.content;
  }

  /**
   * Perform a semantic search through the Python engine and combine its
   * scores with a simple lexical match. The lexical score boosts results
   * containing the query terms within their snippet. The final score is
   * a weighted sum of semantic (0.7) and lexical (0.3) scores.
   */
  public async searchCode(query: string, topK = 5): Promise<SearchResult[]> {
    // Query the Python semantic engine via HTTP GET. URL encode the query.
    const url = new URL('/search', this.engineUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('top_k', topK.toString());

    const engineResults: EngineSearchResult[] = await new Promise((resolve, reject) => {
      const req = http.get(url.toString(), res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          try {
            const parsed = JSON.parse(body);
            resolve(parsed.results as EngineSearchResult[]);
          } catch (err) {
            reject(new Error(`Failed to parse engine response: ${body}`));
          }
        });
      });
      req.on('error', err => reject(err));
    });

    // Compute lexical score: proportion of query terms present in the snippet.
    const tokens = query
      .toLowerCase()
      .split(/\W+/)
      .filter(t => t.length > 0);
    const results: SearchResult[] = engineResults.map(er => {
      const snippetLower = er.snippet.toLowerCase();
      let hits = 0;
      for (const token of tokens) {
        if (snippetLower.includes(token)) hits++;
      }
      const lexicalScore = tokens.length > 0 ? hits / tokens.length : 0;
      const finalScore = er.score * 0.7 + lexicalScore * 0.3;
      return {
        file: er.file,
        symbol: er.symbol,
        startLine: er.startLine,
        endLine: er.endLine,
        score: finalScore,
        snippet: er.snippet,
      };
    });
    // Sort by final score descending and return topK.
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }
}