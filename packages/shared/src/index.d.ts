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
}
export interface SemanticEntry {
    id: string;
    file: string;
    symbol: string;
    startLine: number;
    endLine: number;
    text: string;
}
export interface SearchResult {
    file: string;
    symbol: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
}
