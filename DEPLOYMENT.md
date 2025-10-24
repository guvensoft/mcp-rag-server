# MCP Projesi Dağıtım Kılavuzu

Bu belge, kodlama asistanı ajanının kullanacağı MCP sunucusunu üretim ortamına hazır bir şekilde ayağa kaldırmak için izlenmesi gereken adımları özetler.

## 1. Önkoşullar
- Node.js 18.x veya üzeri
- npm 9.x veya üzeri
- Python 3.9+ (varsayılan TF-IDF motoru için ek paket gerekmez)
- (Opsiyonel) Sentence-Transformers ve Chroma ile GPU hızlandırması yapmak isterseniz `pip install sentence-transformers chromadb fastapi uvicorn` komutlarını çalıştırın.

## 2. Kurulum
1. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```
2. Tüm TypeScript paketlerini üretime derleyin:
   ```bash
   npm run build
   ```

## 3. Çalıştırma Senaryoları

### 3.1 MCP (stdio) Sunucusu
```bash
npm run mcp
```
Bu komut `packages/mcp-server/dist/launch_mcp.js` dosyasını çalıştırır.
- İlk çalıştırmada TypeScript kodu indekslenir (`data/` dizini oluşturulur) ve Python tabanlı semantik motor başlatılır.
- Python ortamı hazır değilse, otomatik olarak Node.js tabanlı yerel motor devreye girer.
- Chokidar temelli dosya izleyicisi indeks verisini güncel tutar.
- Telemetri kayıtları `logs/telemetry.log` dosyasına JSON satırları olarak yazılır.

### 3.2 HTTP Sunucusu
```bash
npm run mcp:http
```
Bu mod, `/search_code` ve `/get_file` uçlarını HTTP üzerinden sunar. Aynı veri ve motor altyapısını kullanır.

### 3.3 Yalnızca indeks oluşturmak
```bash
npm run mcp:index
```
Belirlenen kaynak dizini tarar ve `data/` altında `index.json`, `semantic_entries.json`, `edges.json` ve `graph.db` dosyalarını üretir.

## 4. Çevresel Değişkenler
- `INDEX_ROOT` / `MCP_INDEX_ROOT`: İndekslenecek kaynak dizini (varsayılan `packages/mcp-server/src`).
- `DATA_DIR` / `MCP_DATA_DIR`: İndeks ve graph verilerinin yazılacağı dizin (varsayılan `packages/mcp-server/data`).
- `ENGINE_URL`: Harici bir semantik motoru işaret etmek için.
- `PYTHON`: Python yorumlayıcısını manuel seçmek için (`tests/run_tests.cjs` bu değeri kullanır).
- `MCP_FAST_START=1`: Python motoru hazır olmasa bile anında yerel motorla başlamayı zorlar.
- `DEBUG_WATCHER=1`: Dosya izleme hatalarını konsola yazar.
- `DEBUG_TELEMETRY=1`: Telemetri yazma hatalarını konsola yazar.

## 5. Testler
- Entegrasyon testi:
  ```bash
  npm test
  ```
  Bu komut örnek proje üzerinde indeks oluşturur, Python motorunu başlatır, arama ve dosya alma uçlarını doğrular.
- Test çalıştırırken Python yorumlayıcısını sabitlemek için:
  ```bash
  PYTHON=python npm test
  ```

## 6. Günlük ve Durum Dosyaları
- `logs/telemetry.log`: JSON Lines formatında uçlar ve araç kullanımları için süre/istatistik kayıtları.
- `weights.json`: Hibrit sıralayıcı geribildirime göre güncellenen ağırlıklar. Git tarafından yok sayılır.
- `data/` ve `packages/mcp-server/data/`: İndeks çıktıları, graph verisi ve semantik kayıtlar.

## 7. Yayınlama İçin Öneriler
- Üretim ortamında `npm run build` komutunu CI pipeline’ına ekleyin.
- Eğer Python tabanlı motor kullanılacaksa gerekli pip paketlerini Docker imajına veya sunucuya önceden kurun.
- MCP sunucusunu systemd veya PM2 ile servis olarak koşturabilir, `logs/` dizinini log rotasyonu ile yönetebilirsiniz.
- `logs/` ve `data/` dizinlerini kalıcı depolama alanına (ör. volume, network share) yönlendirmek uzun süreli kullanım için tavsiye edilir.
