# MCP Project — Sistem Akışları

Bu doküman; indeksleme, başlatma, sorgulama ve MCP etkileşim akışlarını ASCII diyagramlarla özetler.

## 1) İndeksleme (Gelişmiş)

Kaynak: `packages/mcp-server/src/indexer.ts`

```
TS Kaynaklar (rootDir)
     │  ts-morph           madge
     ├──────────────┬───────────────┐
     │              │               │
  Semboller       İçerik         Bağımlılıklar
     │              │               │
     ▼              ▼               ▼
 index.json   semantic_entries.json  edges.json
                                 │
                                 ▼
                              graph.db (SQLite)
```

Önemli çıktılar:
- `index.json` — dosya + sembol meta
- `semantic_entries.json` — snippet içerikleri
- `edges.json` — import/re-export kenarları
- `graph.db` — files, symbols, edges tabloları

## 2) Başlatma ve Motor

Kaynak: `packages/mcp-server/src/launch_mcp.ts`

```
start
  ├─ ensureIndex() → data/* oluştur
  ├─ chokidar watcher → dosya değişimini algıla → runIndexer kuyruğa al
  ├─ (opsiyon) FastAPI motoru dene → /health → ok?
  │     └─ değilse Node içi fallback motor başlat (/search)
  ├─ ENGINE_URL = http://127.0.0.1:<port>
  └─ MCP adapter bağla (stdio)
```

## 3) HTTP Sorgu Akışı

Kaynak: `src/server.ts`, `packages/mcp-server/src/server.ts`

```
Client --HTTP--> /search_code?q=...&top_k=K
   │
   ▼
 Orchestrator.searchCode()
   │            │
   │            ├─ GET ENGINE_URL/search?q=...&top_k=K
   │            │       └─ Python engine (ST+Chroma | TF-IDF)
   │            │            └─ sonuç listesi [ semantic score ]
   │            │
   │            └─ Hibrit sıralama (rank_hybrid):
   │                   semantic + lexical + graph → final score
   │
   └─ JSON yanıt { query, results[] }
```

`/get_file?path=...` akışı:
```
Client --HTTP--> /get_file?path=rel/path.ts
   │
   ▼
 Orchestrator.getFile() → index.json → content
   │
   └─ JSON yanıt { path, content }
```

## 4) MCP (stdio) Akışı

Kaynak: `packages/mcp-server/src/mcp_adapter.ts` ve `src/mcp.ts`

```
IDE/Client --stdio(JSON-RPC)--> MCP Adapter
   │
   ├─ tools/call: search_code → Orchestrator.searchCode → hybrid rank → results
   ├─ tools/call: get_file    → Orchestrator.getFile → content
   ├─ tools/call: list_symbols/find_refs → GraphStore (SQLite)
   ├─ resources/list|read → policy + file system (ROOTS + allowPath)
   └─ prompts/list|call → refactor/test/perf metinleri
```

## 5) Hibrit Sıralama Ayrıntı

Kaynak: `packages/mcp-server/src/ranker.ts`

```
Girdi: SearchResult[] (semantic score [0..1])
Ek: lexical (token hit ratio), graph (degree norm)

score = w_s*semantic + w_l*lexical + w_g*graph
varsayılan: w_s=0.6, w_l=0.25, w_g=0.15 (normalize)
```

## 6) Güvenlik / Politika

Kaynak: `packages/mcp-server/src/policy.ts`, `mcp_adapter.ts`
- `ROOTS` altında olmayan path’ler reddedilir
- `.env/.key/.pem` uzantıları ve >50MB dosyalar reddedilir
