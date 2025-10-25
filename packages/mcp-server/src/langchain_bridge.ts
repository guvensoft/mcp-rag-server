import fs from 'fs';
import path from 'path';

interface SemanticEntry {
  id: string;
  file: string;
  symbol: string;
  text: string;
}

interface BridgeResult {
  id: string;
  file: string;
  symbol: string;
  score: number;
  snippet: string;
}

export class LangChainBridge {
  private entries: SemanticEntry[] = [];
  private available = false;
  private reason = 'langchain package not detected';

  constructor(private dataDir: string) {
    this.loadEntries();
    this.detectLangChain();
  }

  private loadEntries() {
    const semanticPath = path.join(this.dataDir, 'semantic_entries.json');
    if (!fs.existsSync(semanticPath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(semanticPath, 'utf8')) as Array<any>;
      this.entries = parsed.map(e => ({
        id: String(e.id ?? `${e.file}:${e.symbol}`),
        file: String(e.file),
        symbol: String(e.symbol),
        text: String(e.text ?? ''),
      }));
    } catch {
      this.entries = [];
    }
  }

  private detectLangChain() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require.resolve('langchain');
      this.available = true;
      this.reason = '';
    } catch {
      this.available = false;
    }
  }

  private lexicalQuery(query: string, topK: number): BridgeResult[] {
    const tokens = query
      .toLowerCase()
      .split(/\W+/)
      .filter(Boolean);
    const scored = this.entries.map(entry => {
      const text = entry.text.toLowerCase();
      let hits = 0;
      for (const token of tokens) {
        if (text.includes(token)) hits += 1;
      }
      const score = tokens.length ? hits / tokens.length : 0;
      return {
        id: entry.id,
        file: entry.file,
        symbol: entry.symbol,
        score,
        snippet: entry.text.slice(0, 200),
      };
    });
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(topK, scored.length)));
  }

  async query(query: string, topK: number): Promise<{ available: boolean; provider: 'langchain' | 'fallback'; reason?: string; results: BridgeResult[] }> {
    if (!this.entries.length) {
      return {
        available: this.available,
        provider: this.available ? 'langchain' : 'fallback',
        reason: this.entries.length ? undefined : 'semantic_entries.json not found or empty',
        results: [],
      };
    }

    if (!this.available) {
      return {
        available: false,
        provider: 'fallback',
        reason: this.reason,
        results: this.lexicalQuery(query, topK),
      };
    }

    // Placeholder for real LangChain integration. Until dependencies are present,
    // fall back to lexical scoring while reporting availability.
    return {
      available: true,
      provider: 'langchain',
      reason: 'LangChain detected but no vector store configured; using lexical fallback.',
      results: this.lexicalQuery(query, topK),
    };
  }
}

