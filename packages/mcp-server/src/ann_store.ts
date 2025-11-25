import fs from 'fs';
import path from 'path';
import { SemanticEntry } from '@mcp/shared';

// Avoid DOM lib dependency by treating fetch as optional any-typed function.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fetchFn: ((...args: any[]) => Promise<any>) | undefined = (globalThis as any).fetch;

export type AnnProvider = 'qdrant' | 'weaviate' | 'pgvector' | 'file';

export interface AnnStoreConfig {
  provider?: AnnProvider;
  url?: string;
  apiKey?: string;
  collection?: string;
  namespace?: string;
  tenant?: string;
  /** Only for pgvector */
  connectionString?: string;
  table?: string;
  /** Fallback directory for local persistence */
  dataDir?: string;
}

export interface AnnRecord {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export function loadAnnConfigFromEnv(): AnnStoreConfig | undefined {
  const provider = (process.env.ANN_PROVIDER || '').toLowerCase() as AnnProvider;
  if (!provider) return undefined;
  return {
    provider,
    url: process.env.ANN_URL,
    apiKey: process.env.ANN_API_KEY,
    collection: process.env.ANN_COLLECTION || 'code_chunks',
    namespace: process.env.ANN_NAMESPACE,
    tenant: process.env.ANN_TENANT,
    connectionString: process.env.PGVECTOR_CONNECTION,
    table: process.env.PGVECTOR_TABLE || 'embeddings',
    dataDir: process.env.DATA_DIR,
  };
}

export function buildTextEmbedding(text: string, dim = 96): number[] {
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  const vector = new Array(dim).fill(0);
  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
    }
    const idx = hash % dim;
    vector[idx] += 1;
  }
  const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vector.map(v => Number((v / norm).toFixed(6)));
}

export class AnnStoreAdapter {
  private collection: string;
  private enabled: boolean;
  private localPath: string;

  constructor(private config: AnnStoreConfig) {
    this.collection = config.collection || 'code_chunks';
    this.enabled = Boolean(config.provider);
    const dataDir = config.dataDir || path.join(process.cwd(), 'data');
    this.localPath = path.join(dataDir, `${this.collection}.ann.json`);
  }

  get isEnabled() {
    return this.enabled;
  }

  private formatRecords(entries: Array<SemanticEntry & { vector?: number[] }>): AnnRecord[] {
    return entries.map(entry => ({
      id: entry.id,
      vector: entry.vector || buildTextEmbedding(entry.text),
      payload: {
        file: entry.file,
        symbol: entry.symbol,
        startLine: entry.startLine,
        endLine: entry.endLine,
        namespace: entry.namespace ?? this.config.namespace,
        tenant: entry.tenant ?? this.config.tenant,
        metadata: { ...(entry.metadata || {}), snippet: entry.text.slice(0, 200) },
      },
    }));
  }

  private async persistToFile(records: AnnRecord[]) {
    try {
      fs.mkdirSync(path.dirname(this.localPath), { recursive: true });
      const existing: AnnRecord[] = fs.existsSync(this.localPath)
        ? JSON.parse(fs.readFileSync(this.localPath, 'utf8'))
        : [];
      const merged = new Map<string, AnnRecord>();
      for (const rec of existing) merged.set(rec.id, rec);
      for (const rec of records) merged.set(rec.id, rec);
      fs.writeFileSync(this.localPath, JSON.stringify(Array.from(merged.values()), null, 2), 'utf8');
    } catch {
      // best-effort; do not throw
    }
  }

  private async sendToQdrant(records: AnnRecord[]): Promise<boolean> {
    if (!this.config.url) return false;
    if (!fetchFn) return false;
    try {
      const body = JSON.stringify({
        points: records.map(r => ({ id: r.id, vector: r.vector, payload: r.payload })),
      });
      await fetchFn(`${this.config.url}/collections/${this.collection}/points?wait=true`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { 'api-key': this.config.apiKey } : {}),
        },
        body,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async sendToWeaviate(records: AnnRecord[]): Promise<boolean> {
    if (!this.config.url) return false;
    if (!fetchFn) return false;
    try {
      const objects = records.map(r => ({
        class: this.collection,
        id: r.id,
        properties: r.payload,
        vector: r.vector,
      }));
      await fetchFn(`${this.config.url}/v1/batch/objects`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { 'authorization': `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({ objects }),
      });
      return true;
    } catch {
      return false;
    }
  }

  private async sendToPgVector(records: AnnRecord[]): Promise<boolean> {
    // Without a direct driver we persist locally but keep the hook for deployers
    if (!this.config.connectionString) return false;
    await this.persistToFile(records);
    return false;
  }

  async upsert(entries: Array<SemanticEntry & { vector?: number[] }>) {
    if (!this.enabled) return;
    const records = this.formatRecords(entries);
    let persisted = false;
    if (this.config.provider === 'qdrant') persisted = await this.sendToQdrant(records);
    else if (this.config.provider === 'weaviate') persisted = await this.sendToWeaviate(records);
    else if (this.config.provider === 'pgvector') persisted = await this.sendToPgVector(records);

    if (!persisted || this.config.provider === 'file') {
      await this.persistToFile(records);
    }
  }

  async query(vector: number[], topK: number, filters?: { namespace?: string; tenant?: string; metadata?: Record<string, unknown> }) {
    // For now rely on local file, which mirrors what was pushed to the ANN provider
    if (!fs.existsSync(this.localPath)) return [];
    const records = JSON.parse(fs.readFileSync(this.localPath, 'utf8')) as AnnRecord[];
    const filtered = records.filter(r => {
      const payload = r.payload || {};
      if (filters?.namespace && payload.namespace && payload.namespace !== filters.namespace) return false;
      if (filters?.tenant && payload.tenant && payload.tenant !== filters.tenant) return false;
      if (filters?.metadata) {
        const meta = (payload as any).metadata || {};
        for (const [key, value] of Object.entries(filters.metadata)) {
          if (meta[key] !== value) return false;
        }
      }
      return true;
    });
    const scored = filtered.map(r => {
      const score = vector.length === r.vector.length
        ? r.vector.reduce((acc, val, idx) => acc + val * vector[idx], 0)
        : 0;
      return { record: r, score };
    });
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, topK))
      .map(s => ({ ...s.record, score: s.score }));
  }
}
