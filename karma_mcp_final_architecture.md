# **Lokal Bağlamlı Kod Ajanı (MCP Server + Semantic Engine) - Nihai Profesyonel Mimari Plan (Genişletilmiş)**

> **Amaç:** ChatGPT (Codex Agent) ajanının VSCode içinde çalışırken **lokaldeki projeleri tam mimari bağlamıyla anlaması**, doğru mimari kararlar verebilmesi, refactor ve optimizasyon için akıl yürütecek kadar "bağlamsal zekâ" geliştirmesi.\
> **Hedef:** ≥ **%95 insan değerlendirmesiyle yararlılık**, ≥ **0.95 topolojik tutarlılık**, ≥ **0.96 semantik yakınlık**.

---

## 1. 🔄 Genel Amaç ve Kapsam

**MVP Tanımı:** İlk sürüm yalnızca TypeScript/NestJS projelerini destekleyecek şekilde tasarlanmalıdır. Bu aşamada temel fonksiyonlar olan `search_code`, `get_file` ve hibrit sıralama (hybrid ranking) özellikleri devreye alınacaktır. Gelişmiş bileşenler (örneğin Context Profiler ve Feedback Optimizer (VSCode içinde 👍/👎 kullanıcı geri bildirim butonlarıyla yarı otomatik eğitim sistemi dahil)) MVP sonrasında eklenecektir.

- VSCode `openai.chatgpt` eklentisiyle tam entegre çalışan **lokal MCP sunucusu**.
- Node.js + TypeScript tarafı **orchestrator** ve **analiz**; Python tarafı **semantic engine**.
- Proje yapısını (AST + graph + semantic + context feedback) ile anlayarak **doğru bağlam seçimi**.
- Incremental indexing, feedback loop ve adaptive retrieval mekanizmasıyla **kendini iyileştiren bir ajan**.

**Ek bilgi:** İlk sürümlerdeki “human evaluation loop” yaklaşımı artık **feedback optimizer** içerisinde yerleşik olarak çalışır. Kod kalite eşiği (code smell analyzer threshold) otomatik kalibrasyonla ayarlanır.

---

## 2. 🔧 Ana Mimarinin Bileşenleri

**Ek bilgi:** SQLite ve Chroma veri tabanları arasındaki tutarlılığı korumak için job queue mekanizması (örneğin BullMQ veya Celery) kullanılmalıdır. Bu yapı, indeksleme ve güncelleme işlemlerini atomik hale getirir; böylece dosya değişiklikleri sırasında veri bütünlüğü korunur.

```text
[VSCode ChatGPT Eklentisi]
       │ (stdio / MCP JSON-RPC)
       ▼
[MCP Server - Node.js + TypeScript]
       │
       ├─ Context Orchestrator
       │    ├─ Structural Analyzer (ts-morph, madge)
       │    ├─ Graph Store (SQLite)
       │    ├─ Hybrid Ranker (semantic + lexical + graph)
       │    ├─ Token Packer (MMR + budget aware)
       │    ├─ Context Profiler (refactor, dataflow, test, perf)
       │    └─ Feedback Optimizer (adaptive weighting + human eval feedback)
       │
       ├─ Indexer
       │    ├─ Full Scan (initial)
       │    ├─ Incremental (FileWatcher + Git hooks)
       │    └─ AST + Import Graph Builder
       │
       ├─ Tools (MCP)
       │    ├─ search_code, list_symbols, get_file, find_refs
       │    ├─ plan_refactor, gen_patch, apply_patch (onaylı)
       │    ├─ detect_smells, analyze_performance, suggest_tests
       │    ├─ summarize_architecture, compare_versions, auto_docs
       │    └─ run_tests / run_task (opsiyonel)
       │
       ├─ Telemetry & Policy Layer
       │    ├─ policy.ts (context safety, dosya boyut/loop kontrolü)
       │    └─ telemetry.ts (query latency, cache hits, token metrics, json export)
       │
       └─ Semantic Bridge (HTTP / UDS)
               ▼
     [Semantic Engine - Python]
         ├─ Embedding Engine (sentence-transformers / codebert)
         ├─ Vector DB (Chroma / Qdrant)
         ├─ Hybrid Retrieval (semantic + lexical)
         ├─ Summarizer (auto symbol/file summaries)
         ├─ Feedback Evaluator (context quality metrics)
         ├─ LangChain Bridge (opsiyonel retriever interface)
         └─ API: FastAPI + UNIX socket (düşük gecikme)
```

**Ek bilgi:** Telemetry verileri ayrıca JSON veya Prometheus formatında dışa aktarılabilir.

---

## 3. 🔍 Katmanlar

### 3.1 Structural Layer

- AST + import/call graph ile yapısal ilişkiler belirlenir.
- Symbol-level metadata (`kind`, `signature`, `relations`, `range`) kaydedilir.

### 3.2 Semantic Layer

- Kod blokları vektörleştirilir.
- Python motoru topK benzerlik sorguları yapar.
- Fonksiyon/class için summary, param/return, dependants bilgiler eklenir.

### 3.3 Cognitive Layer

- Soru türünü tanır (refactor, test, performance vb.) ve uygun context preset seçer.
- Token limitine göre snippet + özet + gerekçe paketlenir.
- Adaptive feedback loop ile öğrenir (weight tuning).

---

## 4. 🔄 Veri Modeli

**SQLite:** files, symbols, edges, git\_meta tabloları.\
**Chroma/Qdrant:** `collection: code_chunks` (embedding, summary, range, lang).

**Example:**

```json
{
  "file_path": "src/orders/order.service.ts",
  "symbol": "OrderService.create",
  "summary": "Sipariş ve ödeme işlemini yönetir",
  "embedding": [ ... ]
}
```

**Ek bilgi:** Model ayrıca `telemetry_metrics` tablosu içerir; sorgu gecikme, cache hit oranı gibi veriler burada tutulur.

---

## 5. 🔹 Bağlam İnşa Algoritması

1. **Sinyal Toplama** (aktif dosya, imleç, VSCode komutu).
2. **Aday Havuzu** (graph + semantic + lexical).
3. **Skorlama:** 0.5 semantic + 0.3 lexical + 0.2 graph.
4. **MMR + Çeşitlilik** (aynı dosyadan benzer snippet elenir).
5. **Token Paketleme:** özet + kod + meta.
6. **Profil Modları:** Refactor / DataFlow / Performance / Test.
7. **Feedback Loop:** Gerçek yanıt kalitesi geri bildirim olarak kaydedilir.\
   **Ek bilgi:** Token optimizasyonu sırasında, “context saturation detector” modülü token yoğunluğunu dengeler.

---

## 6. 🌐 Dil & Framework Farkındalığı

| Dil / Framework  | Analiz                            | Ek Faydalar                |
| ---------------- | --------------------------------- | -------------------------- |
| **Angular/Nx**   | Modül sınırları, schematic, alias | test ve modül farkındalığı |
| **NestJS**       | Module-Provider-Controller        | decorator route grafiği    |
| **React/NextJS** | Component tree, hooks/props       | server/client ayrımı       |
| **Python**       | route → ORM → response akışı      | middleware analizi         |
| **Go**           | go.mod dependency graph           | goroutine flow             |
| **Java Spring**  | Bean-Service-Repo grafı           | annotation bazlı injection |
| **Laravel**      | Controller-Service-Model          | route + blade analizi      |

---

## 7. 📊 Kalite ve Performans Göstergeleri

| Metrik                  | Tanım                              | Hedef  |
| ----------------------- | ---------------------------------- | ------ |
| Bağlamsal Doğruluk      | Yanıttaki kod ile bağlam eşleşmesi | ≥ 95%  |
| Semantik Yakınlık       | Embedding cosine ortalaması        | ≥ 0.96 |
| Topolojik Tutarlılık    | Import/Graph yapısı                | ≥ 0.95 |
| İnsan Yararlılık Değeri | Uzman panel skor ortalaması        | ≥ 95%  |
| Token Verimliliği       | Bilgi yoğunluğu / token            | ≥ 0.85 |
| Ortalama Sorgu Süresi   | 1000+ dosya repo                   | < 2s   |

**Ek bilgi:** Değerlendirme çıktıları `evaluation.py` modülü ile BLEU/ROUGE/cosine benzerlik analizleriyle doğrulanır.

---

## 8. ⚙️ Ek Modüller

### 8.1 LangChainBridge

LangChain retriever arayüzü (opsiyonel):

```python
from langchain.embeddings import HuggingFaceEmbeddings
from langchain.vectorstores import Chroma
from langchain.chains import RetrievalQA
```

### 8.2 Context Policy & Safety

- `.env`, `*.key`, `*.pem`, >50MB dosyalar hariç tutulur.
- Recursive import veya sonsuz graph loop engellenir.

### 8.3 Telemetry Panel

- Query latency, token cost, cache hit rate görselleşmesi.
- Streamlit veya VSCode Webview paneli.
- **Ek:** Prometheus/Grafana desteği eklenebilir.

### 8.4 Evaluation System

- BLEU, ROUGE, cosine similarity skorları.
- `evaluation.py` modülü: model precision/recall hesaplar.

---

## 9. 🧪 Test & CI Stratejisi

- **Unit:** packer, ranker, MMR, token hesaplama.
- **Integration:** Angular/NestJS demo repo.
- **Human Eval:** 100 sorgu uzman incelemesi.
- **Regression Benchmark:** Altın veri seti.
- **CI:** Node (vitest), Python (pytest), ruff, mypy. **Ek bilgi:** CI pipeline ayrıca otomatik `logs/telemetry.log` oluşturur ve test skorlarını raporlar.

---

## 10. ⚙️ Performans & Cache

**Ek bilgi:** Performans için şu ek öneriler uygulanmalıdır:

- Arka plan indeksleme süreci düşük öncelikli bir görev olarak çalışmalı, kullanıcının akışını kesmemelidir.

- Yapılandırılabilir embedding modelleri (ör. MiniLM-L6-v2 hızlı ama düşük isabetli, CodeBERT yavaş ama yüksek isabetli) seçilebilir olmalıdır.

- Redis cache kullanımına öncelik verilmeli; özellikle büyük projelerde sorgu hızında %30-40 artış sağlar.

- Incremental index: sadece değişen dosyalar.

- Worker thread havuzu (`Piscina`).

- SQLite + Chroma cache senkronizasyonu.

- `pruneDeletedFiles()` ile eski dosyalar otomatik temizlenir.



---

## 11. 🔺 Yol Haritası

| Aşama | İçerik                       | Hedef           |
| ----- | ---------------------------- | --------------- |
| 1     | Monorepo, MCP bootstrap      | Temel altyapı   |
| 2     | AST + Graph + Indexer        | Yapısal analiz  |
| 3     | Python Semantic Engine       | Embedding arama |
| 4     | Hybrid Ranker + Token Packer | %85 doğruluk    |
| 5     | Tools + Context Profilleri   | %90 doğruluk    |
| 6     | Framework adaptörleri        | %93 doğruluk    |
| 7     | Feedback loop + optimization | %95 doğruluk    |
| 8     | E2E test + telemetry         | Kararlı sürüm   |

---

## 12. 🌍 Genişleme Planı

- **Yeni Diller:** Rust, Kotlin, C# (faz 3).
- **Multi-Agent System:** Architect / Debugger / Doc ajanları.
  - **Teknoloji Yığını:** LangGraph, FastAPI, LangChain Agents, Socket.IO event bus.
- **Kurumsal Entegrasyon:** GitHub, Jira, SonarQube API.
  - **Teknoloji Yığını:** REST API, OAuth2, GraphQL Gateway.
- **Behavior Simulation:** Kod yürütmeden etki zinciri tahmini.
  - **Teknoloji Yığını:** AST tracer, static flow analyzer, dependency simulator.
- **Visualization:** Graphviz/vis.js topoloji gösterimi.
  - **Teknoloji Yığını:** D3.js, vis-network, Cytoscape.js, REST streaming API.

---

## 13. ✅ Sonuç

Bu mimari; ChatGPT’nin proje yapısını **yapısal, anlamsal ve bilişsel** olarak anlamasını sağlar.

- **Doğruluk:** ≥ %95
- **Tutarlılık:** ≥ 0.95
- **Bağlam zekâsı:** mimari seviyede analiz & öğrenme
- **Genişletilebilirlik:** yeni diller, çerçeveler, ajanlar

> 🚀 Uzun vadeli vizyon: **Self-Aware Development Agent**  — kendi bağlamını ve hatasını değerlendirebilen geliştirici zekâsı.

