# 📘 Project Best Practices

## 1. Projenin Amacı
Bu depo; Node.js/TypeScript tabanlı bir **MCP (Model Context Protocol) sunucusu**, bir **Orchestrator** ve Python ile yazılmış bir **Semantik Arama Motoru** içerir. Amaç, TypeScript kaynak kodlarından sembol/metaveri çıkarmak (indexer), Python motoru ile semantik arama yapmak, sonuçları hibrit sıralama (semantik + leksikal + graf sinyalleri) ile birleştirmek ve bunları HTTP ile veya MCP arayüzü üzerinden sunmaktır.

- Ana kullanım alanı: Kod arama, dosya içeriği getirme ve LLM tabanlı araç zincirleriyle entegrasyon.
- Dizinlerdeki “data” dosyaları (index.json, semantic_entries.json) hem Node tarafındaki Orchestrator hem de Python motoru için ortak veri kaynağıdır.

---

## 2. Proje Yapısı
- Kök düzeyinde önemli dizinler:
  - `src/` (TypeScript): Basit HTTP sunucusu (`server.ts`), basit orchestrator (`orchestrator.ts`), indexer (`indexer.ts`), tipler (`types.ts`). Kökteki bu sürüm, örnek/temel uygulamadır.
  - `packages/` (Monorepo workspaces):
    - `packages/shared/`: Paylaşılan tipler (TS). `@mcp/shared` olarak kullanılabilir (path alias).
    - `packages/mcp-server/`: Üretim odaklı MCP sunucu bileşenleri (orchestrator, ranker, graph store, watcher vb.). Vitest ile birim testleri içerir.
    - `packages/semantic-engine/`: Alternatif Python motoru (FastAPI tabanlı), ChromaDB ve Sentence-Transformers destekli veya TF-IDF yedekli arama.
  - `semantic_engine/`: Basit Python semantik motoru (HTTPServer). TF vektörü/kosünüs benzerlik tabanlıdır.
  - `mcp-server/`: @modelcontextprotocol/sdk ile MCP stdio sunucusu (Codex entegrasyonu için minimal örnek).
  - `tests/`: Entegrasyon testi görevlerini yapan Node betikleri ve örnek TypeScript kaynakları.
  - `data/`: Örnek/üretilmiş indeks verileri (index.json, semantic_entries.json). Çalışan senaryolarda bu klasör dinamik olarak oluşturulur.

- Ana giriş noktaları ve komutlar:
  - Kök `package.json` script’leri:
    - `build`: Kök TS derlemesi + `packages/shared` ve `packages/mcp-server` derlemeleri.
    - `start`: `dist/server.js` (kök sunucu) çalıştırır.
    - `index`: `dist/indexer.js` çalıştırır (kodu tarar ve `data` üretir).
    - `test`: Derleme sonrası `tests/run_tests.cjs` entegrasyon testini çalıştırır.
    - `mcp:*`: `packages/mcp-server` altındaki farklı modları başlatır.
  - `packages/mcp-server` script’leri:
    - `build`: TS derlemesi.
    - `start:mcp`: MCP stdio server.
    - `start:http`: HTTP debug server.
    - `start:mcp:http`: MCP + HTTP köprü başlatıcı.
    - `index`: indexer çalıştırıcı (paket bağlamında).

- Konfigürasyon dosyaları:
  - Kök `tsconfig.json`: strict, CJS, `rootDir: src`, `outDir: dist`.
  - `packages/mcp-server/tsconfig.json`: strict + declaration + path alias (`@mcp/shared`).
  - `packages/mcp-server/vitest.config.ts`: Vitest test koşulları.

- Önemli runtime ortam değişkenleri:
  - Node tarafı: `PORT`, `DATA_DIR`, `ENGINE_URL`.
  - Python motoru: `DATA_DIR`, `ENGINE_HOST`, `ENGINE_PORT`, (FastAPI sürümünde opsiyonel `EMBEDDING_MODEL`, `ENGINE_FALLBACK`, Chroma için çevresel gereksinimler).

---

## 3. Test Stratejisi
- Çerçeveler:
  - Birim test: `packages/mcp-server` içinde **Vitest**. Örn. `ranker.test.ts` hibrit sıralayıcıyı test eder.
  - Entegrasyon testi: Kök `tests/run_tests.cjs` ve `tests/run_tests.js` script’leri.
    - Akış: TS derle → örnek TS kaynakları oluştur → indexer ile `data/` üret → Python motorunu alt süreçte başlat → Orchestrator üzerinden `/search` ve `getFile` işlevlerini doğrula → motoru kapat.

- Dizin & isimlendirme:
  - Vitest: `packages/mcp-server/tests/**/*.test.ts` deseni.
  - Entegrasyon: `tests/` altında script tabanlı.

- Mocking kılavuzu:
  - Sinyal/algoritma birimleri (ör. `ranker.ts`) için mock gerekmeden saf fonksiyon testi yapın.
  - HTTP veya dosya sistemi etkileşimlerinde, birim testlerde bağımlılıkları soyutlayın (örn. dosya okuma fonksiyonlarını sarmalayın). Entegrasyon seviyesinde gerçek I/O tercih edilir.

- Unit vs Integration:
  - Unit: Sıralama, token paketleme, küçük yardımcı fonksiyonlar, path normalizasyonu.
  - Integration: End-to-end arama akışı (index → engine → orchestrator), HTTP endpoint’leri, veri formatı uyumu.

- Kapsam beklentisi:
  - Kritiklik sırasına göre: `ranker`, `orchestrator` (temel akış), `indexer` (AST çıkarımı). En azından bu üçünde temel davranışlar güvence altına alınmalı.

- Çalıştırma örnekleri:
  ```bash
  # Birim testler (packages/mcp-server)
  cd packages/mcp-server && npx vitest run

  # Kök entegrasyon testi
  npm run build && node tests/run_tests.cjs
  ```

---

## 4. Kod Stili
- TypeScript:
  - `strict: true` kullanımı zorunlu. Tüm public API’ler için açık tipler tanımlayın.
  - Paylaşılan tipleri `@mcp/shared` üzerinden içe aktarın; yerel kopya/çift tanımlardan kaçının.
  - Modül formatı CJS; Node yerleşik `http`, `fs`, `path` modülleri tercih ediliyor.

- Adlandırma:
  - Sınıflar: PascalCase (örn. `Orchestrator`, `GraphStore`).
  - Fonksiyon/değişken: camelCase (örn. `rank_hybrid`, `runIndexer`).
  - Dosyalar: kebab-case yerine mevcut düzende `snake_like.ts` nadir; esasen `lowercase_with_words.ts` veya `camelCase` değil, mevcut isimlere uyum sağlayın.

- Dokümantasyon & yorumlar:
  - Önemli public fonksiyonlar için kısa JSDoc açıklaması ekleyin (özellikle indexer ve orchestrator yüzeyleri).
  - Karmaşık algoritma/heuristiklerde (ör. hibrit skor, token paketleme) formül ve ağırlıkları açıklayın.

- Hata yönetimi:
  - HTTP uçları: Anlamlı status code’lar (400/404/500) ve JSON hata gövdeleri.
  - JSON parse/IO gibi kırılabilir noktalarda `try/catch` ve kullanıcıya güvenli mesajlar.
  - Asenkron işlemlerde `Promise` hatalarını zincirleyip 500 döndürün; pürüzsüz loglama yapın.

- Asenkron/Performans:
  - Ağ çağrıları için zaman aşımı ve yeniden deneme (retry) stratejisi düşünün (ör. entegrasyonda zaten basit retry var).
  - Büyük metinler için gereksiz kopyalardan kaçının; dilimleme (`slice`) ve akış (`stream`) kullanımını düşünün.

- Platform & Yol kullanımı:
  - Yol birleştirmede `path.join` ve normalize kullanımına dikkat edin; Windows uyumluluğunu koruyun.
  - Veri dosyalarında göreli yolların tutarlılığına dikkat edin (indexer ve engine aynı formatı paylaşır).

---

## 5. Ortak Kalıplar
- Orchestrator:
  - Python motorundan gelen semantik skorları, snippet bazlı leksikal eşleşme ve (varsa) graf merkeziyeti ile birleştirir.
  - `searchCode(query, topK)` → `SearchResult[]` döner; sıralama hibrit sinyallere göre yapılır.

- Hibrit Sıralayıcı (`ranker.ts`):
  - Sinyaller: `semantic`, `lexical`, `graph` (normalize) → ağırlıklı toplam sonra sıralama.
  - `set_weights` ile ağırlıklar toplamı 1 olacak şekilde yeniden normalize edilir.
  - `pack_tokens` ile çeşitlilik (dosya bazında) ve token bütçesi kısıtı gözetilerek greedy seçim yapılır.

- GraphStore (SQLite):
  - Dosya/simge/kenar şeması; import ilişkilerinden derece hesabı.
  - `degree(filePath)` → iç/dış kenar sayısı toplamı.

- Indexer (TS Compiler API):
  - `walkDir` ile TS dosyaları gezinir; `extractSymbols` ile fonksiyon/sınıf/metod çıkartılır.
  - JSDoc dahil başlangıç pozisyonu; snippet üretimi ve `semantic_entries.json` yazımı.

- HTTP Arabirimleri:
  - `/get_file?path=...` → dosya içeriği; `/search_code?q=...&top_k=5` → arama sonuçları.
  - Python motoru `/search` uç noktası ile hizmet verir.

- Python Motoru:
  - Basit sürüm (HTTPServer): TF tabanlı vektörleştirme, kosünüs benzerlik.
  - Gelişmiş sürüm (FastAPI): Sentence-Transformers + Chroma veya otomatik TF-IDF fallback.

---

## 6. Yapılacaklar ve Kaçınılacaklar
- ✅ Yapılacaklar
  - `@mcp/shared` tiplerini kaynak gerçekliği olarak kullanın.
  - `index.json` ve `semantic_entries.json` formatlarını değiştirmeden önce tüm tüketicileri (orchestrator, motor, testler) gözden geçirin.
  - HTTP uçları için içerik türünü (`application/json`) ve hata mesajlarını standardize edin.
  - Ağırlıkları (`ranker.set_weights`) değiştirirken test ekleyin; skor dağılımlarını izleyin.
  - Windows/Unix yol ayrımlarını `path` modülüyle yönetin.
  - Entegrasyon testlerini düzenli çalıştırın; Python motorunun port/erişilebilirliğini doğrulayın.

- ❌ Kaçınılacaklar
  - Paylaşılan tipleri kopyalamak veya türleri `any`’e indirgemek.
  - Motor cevap şemasını sessizce değiştirmek (ör. `score`, `snippet` alanları zorunlu kabul ediliyor).
  - Uzun bloklayıcı I/O’lar; zaman aşımı/geri kazanım olmadan beklemek.
  - Magic string yol/anahtar kullanımı; sabitleri merkezileştirmeden dağınık kullanmak.

---

## 7. Araçlar ve Bağımlılıklar
- Node/TS:
  - `typescript`, `vitest`, `better-sqlite3`, `bullmq`, `ioredis`, `chokidar`, `piscina`, `ts-morph`, `madge`.
  - Kullanım notları:
    - `better-sqlite3`: Grafik/bağımlılık depolama.
    - `bullmq`/`ioredis`: İş kuyruğu (ileride/isteğe bağlı). Redis erişimi gerektiğinde çevresel ayar yapın.
    - `chokidar`: Dosya izleme (index güncellemeleri için altyapı).
    - `piscina`: Worker pool (CPU yoğun işler için). Kullanırken veri kopyalamaya dikkat edin.

- Python:
  - Basit motor: standard lib (HTTPServer) + `json`.
  - Gelişmiş: `fastapi`, `uvicorn`, `sentence-transformers`, `chromadb` (opsiyonel), fallback için `scikit-learn` TF-IDF.

- Kurulum ve Çalıştırma:
  ```bash
  # Monorepo bağımlılıkları
  npm install

  # Derleme
  npm run build

  # Index üret (kök TS kaynakları için örnek)
  npm run index

  # Kök HTTP sunucu
  npm start

  # Python motoru (basit sürüm)
  python3 semantic_engine/semantic_engine.py

  # Python motoru (FastAPI sürümü)
  cd packages/semantic-engine
  uvicorn semantic_engine_fastapi:app --host 127.0.0.1 --port 8000

  # MCP sunucu (stdio)
  cd mcp-server
  npm start
  ```

- Ortam değişkeni örnekleri:
  ```bash
  # Node
  set PORT=3000
  set DATA_DIR=./data
  set ENGINE_URL=http://localhost:8000

  # Python
  set DATA_DIR=./tests/sample_src/data
  set ENGINE_HOST=127.0.0.1
  set ENGINE_PORT=8005
  set ENGINE_FALLBACK=1
  ```

---

## 8. Diğer Notlar (LLM için Önemli)
- API/Şema kararlılığı:
  - `SearchResult` alanları: `file`, `symbol`, `startLine`, `endLine`, `score`, `snippet` – bunlar tüketen kodlarda beklentidir.
  - Python motoru `/search` çıktısı bu alanları içermelidir; skorun [0,1] aralığına normalize edilmesi sıralama tutarlılığı sağlar.

- Veri formatı:
  - `index.json`: `FileMeta[]` (path, content, symbols).
  - `semantic_entries.json`: Sembol bazlı snippet’ler ve metinler. Bu dosya motorun tek veri kaynağıdır.

- Çapraz paket kullanım:
  - `packages/mcp-server` içinde `@mcp/shared` tip yolu tanımlıdır (tsconfig `paths`). Yeni paketler eklerken benzer alias düzenini koruyun.

- Windows uyumluluğu:
  - Test script’leri ve yol ayrımları Windows’ta sorunsuz çalışacak şekilde yazılmıştır; `path.join` kullanımı zorunludur.

- Güvenlik ve sağlamlık:
  - HTTP uçlarında giriş doğrulaması (query string parametreleri, `top_k` aralığı) ekleyin.
  - Dış süreç başlatma (Python motoru) için zaman aşımı, yeniden deneme ve temiz kapatma mantığını koruyun.

- Performans notları:
  - `ranker.pack_tokens` token bütçesi yaklaşık tahmindir (~4 karakter ≈ 1 token). İçerik üretiminde çeşitliliği artırır.
  - Büyük depo indekslerinde `piscina`/iş kuyrukları (bullmq) değerlendirilebilir.

- Genişletme önerileri:
  - Indexer’a import grafı oluşturma ve `GraphStore` doldurma adımı eklenebilir.
  - `watcher.ts` ile canlı yeniden indeksleme ve sıcak veri güncellemesi.
  - `policy.ts`/`telemetry.ts` içindeki uzantıları etkin test kapsamına dahil edin.
