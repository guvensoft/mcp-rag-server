/**
 * Shared type definitions for the MCP project.
 */

/**
 * Information about a code symbol extracted during indexing. Symbols can be
 * functions, classes or methods. The range describes the start and end
 * positions (in terms of line numbers) in the file.
 */
export interface SymbolMeta {
  name: string;
  kind: 'function' | 'class' | 'method' | 'unknown';
  file: string;
  startLine: number;
  endLine: number;
}

/**
 * Metadata about a file discovered during indexing. It contains the path
 * relative to the repository root as well as its raw contents. A file can
 * reference any number of symbols.
 */
export interface FileMeta {
  path: string;
  content: string;
  symbols: SymbolMeta[];
}

/**
 * Representation of an entry used by the semantic engine. Each entry
 * corresponds to a code snippet (usually a symbol). The engine uses the
 * `text` field to compute an embedding and the other fields for context.
 */
export interface SemanticEntry {
  id: string;
  file: string;
  symbol: string;
  startLine: number;
  endLine: number;
  text: string;
}

/**
 * Structure of a search result returned from the semantic engine. The
 * orchestrator will combine the `score` with additional heuristics to
 * determine the final ranking. The `snippet` contains a short excerpt of
 * the code around the matched symbol.
 */
export interface SearchResult {
  file: string;
  symbol: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}