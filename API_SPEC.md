# MCP Project — API Özellikleri

Bu belge HTTP uçları ve MCP (JSON-RPC/stdio) metotlarını tanımlar. Örnekler, gerçek kodla uyumludur.

## HTTP API

Sunucu: `src/server.ts` (demo) ve `packages/mcp-server/src/server.ts` (üretim benzeri)

- GET `/search_code`
  - Query:
    - `q` (string, zorunlu) — arama sorgusu
    - `top_k` (int, opsiyonel, varsayılan 5)
  - Yanıt 200
    - `{"query": string, "results": SearchResult[]}`
  - Hata 500
    - `{"error": string}`

- GET `/get_file`
  - Query:
    - `path` (string, zorunlu) — indeks içinde göreli dosya yolu
  - Yanıt 200
    - `{"path": string, "content": string}`
  - Hata 400/404
    - `{"error": string}`

### Tipler
```
SearchResult {
  file: string
  symbol: string
  startLine: number
  endLine: number
  score: number
  snippet: string
}
```

## Semantic Engine (Python) — HTTP

Sunucu: `packages/semantic-engine/semantic_engine_fastapi.py`

- GET `/health`
  - Yanıt 200 `{ "ok": true }`

- GET `/search`
  - Query: `q` (string), `top_k` (int, varsayılan 5)
  - Yanıt 200 `{ "query": string, "results": EngineSearchResult[] }`

```
EngineSearchResult {
  file: string
  symbol: string
  startLine: number
  endLine: number
  score: number  // [0..1] (ST+Chroma) veya TF-IDF benzerliği
  snippet: string
}
```

## MCP (stdio, JSON-RPC 2.0)

Uygulama: `packages/mcp-server/src/mcp_adapter.ts` ve minimal `src/mcp.ts`

### Genel İstek/Response
```
Request {
  jsonrpc: "2.0",
  id: string|number|null,
  method: string,
  params?: any
}

Response (başarılı) {
  jsonrpc: "2.0",
  id: eşleşen id,
  result: any
}

Response (hata) {
  jsonrpc: "2.0",
  id: eşleşen id,
  error: { code: number, message: string, data?: any }
}
```

### Tools (tools/call)

- `search_code`
  - params: `{ q: string, top_k?: number }`
  - result: `SearchResult[]`

- `get_file`
  - params: `{ path: string }`
  - result: `{ path: string, content: string }`

- `list_symbols`
  - params: `{ file?: string }`
  - result: `Array<{ file?: string, name: string, kind: string, startLine: number, endLine: number }>`

- `find_refs`
  - params: `{ symbol: string }`
  - result: `Array<{ file: string }>`

- `summarize_architecture`
  - params: none
  - result: `{ files: number, symbols: number, edges: number }`

- `detect_smells`
  - params: `{ root?: string }`
  - result: `Array<{ file: string, issue: string }>`

- `suggest_tests`
  - params: `{ symbols: Array<{ file: string, name: string }> }`
  - result: `Array<{ symbol: string, suggestion: string }>`

- `submit_feedback`
  - params: `{ kind: 'up'|'down' }`
  - result: `{ ok: true, weights: { semantic: number, lexical: number, graph: number } }`

- `get_weights`
  - params: none
  - result: `{ semantic: number, lexical: number, graph: number }`

### Resources

- `resources/list`
  - params: `{ root?: string|uri, max?: number }`
  - result: `{ resources: Array<{ uri: string, name: string }> }`

- `resources/read`
  - params: `{ path?: string|uri, uri?: string, maxChars?: number }`
  - result: `{ contents: Array<{ uri: string, mimeType: string, text: string }> }`

Kısıtlar: `ROOTS` kontrolü ve `allowPath()` politikası (secret/çok büyük dosyalar reddedilir)

### Prompts

- `prompts/list`
  - result: `[{ name, description, arguments[] }]`
    - `refactor` → args: `file?`, `symbol?`, `context?`, `notes?`
    - `test` → args: `file?`, `symbol?`, `context?`
    - `perf` → args: `file?`, `symbol?`, `target?`, `context?`

- `prompts/call`
  - params: `{ name: 'refactor'|'test'|'perf', args?: { file?, symbol?, context?, notes?, target? } }`
  - result: `{ content: [{ type: 'text', text: string }] }` — dönen metin ilgili dosya/simge için grafik tabanlı bağlam, sembol listesi, importlar ve ilk satırlar ile zenginleştirilmiştir.

## Hata Kodları (Örnekler)
- `-32601` Method not found
- `-32000` Internal error
- `-32001` Root/Path policy violation
- `-32002` Path not allowed by policy
- `-32003` File read error
