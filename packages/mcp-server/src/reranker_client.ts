import http from 'http';
import { SearchResult } from '@mcp/shared';

export interface RerankResponseItem extends SearchResult {
  rerankerScore: number;
}

export class RerankerClient {
  constructor(private baseUrl: string, private endpoint: string) {}

  async rerank(query: string, candidates: SearchResult[], topK: number): Promise<RerankResponseItem[]> {
    const payload = JSON.stringify({
      query,
      top_k: topK,
      candidates: candidates.map(c => ({
        text: c.snippet,
        metadata: { file: c.file, symbol: c.symbol, startLine: c.startLine, endLine: c.endLine },
      })),
    });

    const url = new URL(this.endpoint, this.baseUrl);
    return new Promise((resolve, reject) => {
      const req = http.request(
        url,
        { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const results = (body.results as any[] | undefined) || [];
              const mapped = results.map(r => ({
                file: r.metadata?.file ?? '',
                symbol: r.metadata?.symbol ?? '',
                startLine: r.metadata?.startLine ?? 0,
                endLine: r.metadata?.endLine ?? 0,
                snippet: r.text ?? '',
                score: 0,
                rerankerScore: typeof r.score === 'number' ? r.score : 0,
              })) as RerankResponseItem[];
              resolve(mapped);
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on('error', err => reject(err));
      req.write(payload);
      req.end();
    });
  }
}
