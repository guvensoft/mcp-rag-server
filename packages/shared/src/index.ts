export interface SymbolMeta {
  name: string;
  kind: 'function' | 'class' | 'method' | 'unknown';
  file: string;
  startLine: number;
  endLine: number;
}

export interface FileMeta {
  path: string;
  content: string;
  symbols: SymbolMeta[];
  /**
   * Optional namespace and tenant fields allow multi-tenant and multi-namespace
   * deployments to keep entries segregated at the schema level.
   */
  namespace?: string;
  tenant?: string;
  /**
   * Arbitrary metadata captured during indexing. This can be filtered by the
   * indexer or downstream services to scope search results.
   */
  metadata?: Record<string, string | number | boolean | null>;
  /**
   * Modification timestamp used by incremental index builds to detect stale
   * entries. Stored as milliseconds since epoch.
   */
  mtimeMs?: number;
}

export interface SemanticEntry {
  id: string;
  file: string;
  symbol: string;
  startLine: number;
  endLine: number;
  text: string;
  namespace?: string;
  tenant?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface SearchResult {
  file: string;
  symbol: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}

