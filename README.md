# MCP Kod Bağlamı Sunucusu - Kullanım Kılavuzu

Bu depo, ChatGPT tabanlı geliştirme ajanlarına yerel projeleri güçlü bir bağlamla açıklayabilen **MCP (Model Context Protocol) sunucusunu** içerir. Aşağıda adım adım kurulum, çalıştırma ve tüm araçların nasıl kullanılacağı anlatılmaktadır.

---

## 1. Ortam Gereksinimleri

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Python** ≥ 3.9 (TF‑IDF fallback motoru için ek paket gerekmez)
- (Opsiyonel) Gelişmiş semantik arama için `sentence-transformers`, `chromadb`, `fastapi`, `uvicorn`
- Streamlit telemetri paneli için `streamlit`

> Python paketlerini kurmak için:
> ```bash
> pip install streamlit sentence-transformers chromadb fastapi uvicorn
> ```

---

## 2. Kurulum ctx7sk-96ef815b-02db-4760-9d73-f6194510b3a2

1. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```
2. TypeScript paketlerini derleyin (monorepo):
   ```bash
   npm run build
   ```

---

## 3. Temel Çalıştırma Senaryoları

### 3.1 MCP (stdio) Sunucusu
```bash
npm run mcp
```
- Kod indekslenir (`data/` klasörü oluşturulur).
- Python semantik motoru veya Node.js fallback motoru başlatılır.
- MCP araçları (`search_code`, `get_file`, vb.) stdio üzerinden kullanılabilir.

### 3.2 HTTP Sunucusu
```bash
npm run mcp:http
```
- `/search_code` ve `/get_file` uçlarını HTTP REST olarak sunar.

### 3.3 Yalnızca İndeks Oluşturmak
```bash
npm run mcp:index
```
- `index.json`, `semantic_entries.json`, `edges.json`, `graph.db` dosyaları yeniden üretilir.

### 3.4 MCP Watcher
```bash
npm run mcp:watch
```
- Chokidar dosya izlemesi ve isteğe bağlı BullMQ kuyrukları ile indeks güncel tutulur.

---

## 4. MCP Araçları ve Kullanım Senaryoları

Sunucu çalışırken araçlara MCP istemcisinden veya `packages/mcp-server/src/mcp.ts` stdio arayüzünden erişilebilir. Öne çıkan araçlar:

| Araç                       | Açıklama                                                                      |
|---------------------------|-------------------------------------------------------------------------------|
| `search_code`             | Hibrit sıralama (semantic + lexical + graph) ile kod arama                  |
| `get_file`                | İndeksten dosya içeriği alma                                                  |
| `plan_refactor`           | Dosya/simge hedefli refaktör planı üretir                                     |
| `gen_patch` / `apply_patch` | Find-replace tabanlı patch taslağı ve uygulaması                           |
| `analyze_performance`     | Statik performans kokusu analizi                                              |
| `compare_versions`        | İki dosyanın satır bazında kıyaslanması                                       |
| `auto_docs`               | Dosya için özet + sembol listesi + bağımlılıklar                              |
| `run_tests` / `run_task`  | Test komutu veya npm script çalıştırma                                        |
| `langchain_query`         | LangChain köprüsü (mevcut değilse lexical fallback)                           |
| `generate_telemetry_panel`| HTML telemetri paneli üretir                                                   |
| `open_telemetry_webview`  | HTML panel içeriklerini webview için döndürür                                 |

> MCP istemcisinde araçların tam listesi: `tools/list`

---

## 5. Telemetri İzleme

### 5.1 HTML Paneli (Statik)
```bash
npm run telemetry:generate
```
- `logs/telemetry_panel.html` dosyasını günceller.
- MCP `open_telemetry_webview` aracı veya VSCode Webview ile açılabilir.

### 5.2 Streamlit Canlı Paneli
```bash
pip install streamlit   # yalnızca bir kez gerekli
npm run telemetry:streamlit
```
- Varsayılan olarak `logs/telemetry_latest.json` dosyasını izler.
- Farklı bir yol için `TELEMETRY_SNAPSHOT=/path/to/json` ortam değişkeni ayarlanabilir.

### 5.3 Prometheus / JSON Çıktıları
`packages/mcp-server/src/telemetry.ts` dosyası:
- `logs/telemetry.log`: JSON Lines
- `logs/telemetry_latest.json`: özet snapshot
- `logs/telemetry.prom`: Prometheus uyumlu metrikler

---

## 6. Testler

| Komut                               | İçerik                                                              |
|-------------------------------------|---------------------------------------------------------------------|
| `npm -w packages/mcp-server run test` | Vitest ile TypeScript ünite testleri                                |
| `python -m pytest semantic_engine/tests` | Python semantik motoru ve evaluation testleri                       |
| `npm run test:integration`          | Derleme + örnek proje üzerinde arama/getFile entegrasyon testi      |
| `npm test`                          | Build + tüm testlerin zincir halinde çalışması                      |

---

## 7. Gelişmiş Özellikler

- **LangChain Köprüsü:** `langchain` paketi bulunursa entegrasyon yapılır; aksi halde lexical fallback çalışır.
- **İndeksleyici:** `ts-morph` + `madge` ile AST ve import grafı çıkarılır, sonuçlar SQLite (`graph.db`) içine yazılır.
- **Geri Bildirim / Ağırlıklar:** `submit_feedback` aracı ile hibrit sıralayıcı ağırlıkları dinamik ayarlanır (`weights.json`).
- **Telemetry HTML Output:** MCP `resources/read` çağrısı `.html` dosyalarına `mimeType: text/html` olarak erişebilir.

---

## 8. Önemli Dizinler

| Dizin / Dosya                    | Açıklama                                                                 |
|----------------------------------|--------------------------------------------------------------------------|
| `packages/mcp-server/src`        | MCP sunucusunun TypeScript kaynakları                                    |
| `packages/mcp-server/data`       | İndeks ve graph çıktıları                                                |
| `semantic_engine/`               | Python semantik motoru + evaluation modülleri                            |
| `streamlit/telemetry_dashboard.py` | Streamlit telemetri paneli                                             |
| `logs/`                          | Telemetri logları, Prometheus dosyası, HTML paneli                       |
| `ARCHITECTURE_CHECKLIST.md`      | Mimari plan maddelerinin uygulanma durumu                                |

---

## 9. Hızlı Başlangıç Özet

1. `npm install`
2. `npm run build`
3. `npm run mcp` veya `npm run mcp:http`
4. MCP istemcisinden `tools/list` ile araçları görüntüleyin
5. Telemetri için `npm run telemetry:generate` veya `npm run telemetry:streamlit`
6. Testler: `npm test`

> Yardıma ihtiyaç duyarsanız `ARCHITECTURE.md`, `SYSTEM_FLOW.md`, `DEPLOYMENT.md` ve bu README dokümanlarını referans alabilirsiniz.

