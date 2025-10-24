# MCP Project — Architektur Dokümantasyonu

Bu dokümantasyon, proje kod tabanına (monorepo) bakılarak çıkarılmış mevcut mimariyi, modülleri, veri akışını, sınıf/katman ilişkilerini ve temel tasarım kararlarını özetler. Hedef; geliştiricilere uygulamayı anlama, genişletme ve doğru bileşenlerde geliştirme yapma konusunda net bir yol haritası sunmaktır.

## Amaç ve Kapsam
- Hibrit (semantic + lexical + graph) arama ile kod tabanında semantik arama yapabilen bir MCP sunucusu sağlamak
- TypeScript tarafında indeksleme, orkestrasyon ve HTTP/MCP köprüleri; Python tarafında semantik arama motoru
- IDE/MCP istemcileri ile stdio JSON-RPC üzerinden entegrasyon

## Yüksek Seviye Mimari
- Client/IDE
  - MCP (Model Context Protocol) istemcileri, stdio JSON-RPC 2.0 üzerinden `packages/mcp-server` adaptörüne bağlanır.
  - HTTP kullanan basit tüketiciler `src/server.ts` (veya `packages/mcp-server/src/server.ts`) üstünden REST uçlarına erişir.
- Orchestrator (TypeScript)
  - `src/orchestrator.ts` ve üretim sürümünde `packages/mcp-server/src/orchestrator.ts`
  - Dosya ve sembol indeksini okur (`data/index.json`)
  - Sorguları Python motoruna iletir; dönen sonuçları hibrit skorlama ile yeniden sıralar
- Indexer (TypeScript)
  - Basit örnek: `src/indexer.ts`
  - Gelişmiş üretim: `packages/mcp-server/src/indexer.ts` (ts-morph + madge + SQLite graph)
  - Çıktılar: `data/index.json`, `data/semantic_entries.json`, `data/edges.json`, `data/graph.db`
- Semantic Engine (Python)
  - `packages/semantic-engine/semantic_engine_fastapi.py` (FastAPI)
  - `semantic_entries.json` içindeki snippet’lardan embedding/vektör benzerliği (ST+Chroma veya TF-IDF fallback)
- Ranking + Graph Sinyali
  - `packages/mcp-server/src/ranker.ts` hibrit skor: semantic + lexical + graph
  - `packages/mcp-server/src/graph_store.ts` SQLite ile import/re-export bağımlılık grafı ve derece hesabı
- MCP Adapter (stdio)
  - `packages/mcp-server/src/mcp_adapter.ts` ve minimal `packages/mcp-server/src/mcp.ts`
  - tools, resources, prompts uçlarını sağlar; IDE’lerle köprü kurar

## Teknoloji Yığını
- Dil/Çatı: TypeScript (Node.js), Python (FastAPI)
- Analiz/İndeksleme: ts-morph, madge
- Veri Deposu: JSON dosyaları (`data/*.json`), SQLite (`data/graph.db`)
- Vektör/Arama: Sentence-Transformers + Chroma (varsa), fallback TF-IDF (sklearn)
- Protokoller: HTTP (REST), JSON-RPC 2.0 (stdio, MCP)

## Paket ve Dizin Yapısı (Özet)
- `src/`
  - `server.ts` — HTTP API (demo)
  - `orchestrator.ts` — indeks + motor koordinasyonu (demo)
  - `indexer.ts` — basit indeksleyici (demo)
  - `types.ts` — paylaşılan tipler (demo)
- `packages/mcp-server/`
  - `src/server.ts` — HTTP sunucu (üretim)
  - `src/orchestrator.ts` — orkestratör (üretim, hibrit sıralama)
  - `src/indexer.ts` — gelişmiş indeksleyici (graph, ts-morph, madge, SQLite)
  - `src/ranker.ts` — hibrit sıralayıcı (semantic/lexical/graph)
  - `src/graph_store.ts` — grafik depolama/okuma (SQLite)
  - `src/mcp_adapter.ts` — MCP stdio adaptörü (tools/resources/prompts)
  - `src/mcp.ts` — minimal MCP json-rpc sunucusu
  - `src/weights.ts` — geri bildirimle dinamik ağırlık ayarı
- `src/policy.ts` — dosya erişim politikası
- `src/telemetry.ts` — basit telemetry yazımı (`logs/telemetry.log` JSONL, git dışı)
  - `src/launch_*.ts` — hızlı başlatma ve motor başlatma yardımcıları
- `packages/shared/` — paylaşılan TS tipleri (NPM workspace)
- `packages/semantic-engine/` — Python FastAPI semantik motoru
- `data/` — indeks ve grafik verileri (JSON+SQLite)
- `scripts/` — başlatma/test yardımcıları (PowerShell/Node)

## Bileşenler ve Sorumluluklar
- HTTP API (`/get_file`, `/search_code`) — basit tüketici entegrasyonu için
- Orchestrator — indeks okuma, motor çağırma, hibrit sıralama, hata yönetimi
- Indexer — kod yürüyüşü, sembol çıkarımı, snippet üretimi, bağımlılık grafı üretimi (edges), SQLite yazma
- Semantic Engine — vektör tabanlı semantik arama (ST+Chroma veya TF-IDF fallback)
- MCP Adapter — tools/resources/prompts uçlarını MCP formatında sunma, ide köprüsü

## Veri Modeli (Özet)
- `FileMeta { path, content, symbols[] }`
- `SymbolMeta { name, kind, file, startLine, endLine }`
- `SemanticEntry { id, file, symbol, startLine, endLine, text }`
- `SearchResult { file, symbol, startLine, endLine, score, snippet }`

## Akışın Özeti
1) İndeksleme
 - TS kaynakları taranır → semboller çıkarılır → `index.json` yazılır
 - snippet’lar `semantic_entries.json`’a yazılır
 - import/re-export ilişkileri `edges.json` ve `graph.db`’ye yazılır
  - chokidar tabanlı watcher (`launch_mcp.ts`) değişiklikleri izleyip indekslemeyi tetikler
2) Motor
   - `semantic_entries.json` yüklenir → embedding veya TF-IDF matris kurulur
3) Sorgu
   - Orchestrator, motoru `/search` ile çağırır → sonuçları lexical+graph sinyali ile yeniden sıralar
   - HTTP veya MCP üzerinden sonuç döner

## Hibrit Sıralama
- Ana kaynak: `packages/mcp-server/src/ranker.ts`
- Sinyaller: semantic (motor skoru), lexical (token vuruş oranı), graph (dosya derece normalizasyonu)
- Ağırlıklar: varsayılan { semantic: 0.6, lexical: 0.25, graph: 0.15 }, `WeightManager` ile geribildirimle normalize edilir

## Güvenlik ve Politika
- Erişim: MCP resources/read/list çağrılarında kök dizin kısıtları (ROOTS) ve `allowPath` filtreleri uygulanır
- Büyük dosya/secret uzantıları engeli: `.env/.key/.pem`, 50MB üzeri dosyalar reddedilir

## Gözlemlenebilirlik
- Basit zamanlama metrikleri `logs/telemetry.log` (JSON Lines) içine yazılır (`startTimer`)

## Konfigürasyon (Örnek Değişkenler)
- `DATA_DIR`, `ENGINE_URL`, `SQLITE_DB`, `INDEX_ROOT`, `MCP_INDEX_ROOT`, `MCP_FAST_START`

## Genişletme Noktaları
- Ranker: ek sinyaller (ör. değişiklik sıklığı, test kapsamı) kolayca eklenebilir
- GraphStore: farklı ilişki türleri (çağrı grafı vb.)
- Semantic Engine: alternatif embedding modelleri / vektör depoları
- MCP Tools: ek araçlar (refactor, test, perf vb.) zaten altyapı ile uyumlu

## Sınıf ve Modül İlişkileri (Kısa)
- Orchestrator → GraphStore (opsiyonel), Ranker → Python Engine
- Indexer → ts-morph, madge → JSON+SQLite çıktı
- MCP Adapter → Orchestrator + GraphStore + Policy + Weights + Tools
