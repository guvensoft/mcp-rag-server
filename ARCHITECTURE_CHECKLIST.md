| Plan Maddesi                                                                 | Durum  | Notlar / Uygulama Kaynağı                                                                                          |
|-------------------------------------------------------------------------------|--------|-----------------------------------------------------------------------------------------------------------------------|
| TypeScript/NestJS odaklı MVP, `search_code` + `get_file` araçları             | ✅ Tam  | `packages/mcp-server/src/mcp_adapter.ts` ve `packages/mcp-server/src/mcp.ts` araç kayıtları                         |
| Hibrit sıralama (semantic + lexical + graph)                                 | ✅ Tam  | `packages/mcp-server/src/ranker.ts`; geri bildirim ağırlıkları `packages/mcp-server/src/weights.ts`                |
| Graph Store (SQLite) ve import/topology analizi                              | ✅ Tam  | `packages/mcp-server/src/graph_store.ts`, `packages/mcp-server/src/indexer.ts`                                      |
| Incremental indexing + BullMQ kuyruğu                                        | ✅ Tam  | `packages/mcp-server/src/watcher.ts`, `packages/mcp-server/src/job_queue.ts`                                        |
| Context Orchestrator + token packer                                          | ✅ Tam  | `packages/mcp-server/src/orchestrator.ts`, `packages/mcp-server/src/context_profiler.ts`                            |
| Streamlit tabanlı telemetri paneli                                           | ✅ Tam  | `streamlit/telemetry_dashboard.py`, `package.json` → `telemetry:streamlit`                                          |
| VSCode Webview (HTML panel + MCP aracı)                                      | ✅ Tam  | `packages/mcp-server/src/tools.ts` → `open_telemetry_webview`, `packages/mcp-server/src/mcp_adapter.ts`             |
| Telemetri JSON/Prometheus çıktıları                                          | ✅ Tam  | `packages/mcp-server/src/telemetry.ts`, HTML üretimi `packages/mcp-server/src/tools.ts`                             |
| LangChain Bridge (opsiyonel)                                                 | ✅ Tam  | `packages/mcp-server/src/langchain_bridge.ts`, `langchain_query` aracı                                              |
| Evaluation sistemi (BLEU / ROUGE / Cosine)                                   | ✅ Tam  | `semantic_engine/evaluation.py`, testleri `semantic_engine/tests/test_evaluation.py`                               |
| Geri bildirimle ağırlık ayarı (Feedback Optimizer)                          | ✅ Tam  | `packages/mcp-server/src/weights.ts`, MCP araçları `submit_feedback` / `get_weights`                                |
| Streamlit/VSCode panel dokümantasyonu                                        | ✅ Tam  | `DEPLOYMENT.md` telemetri bölümü, yeni CLI `packages/mcp-server/src/generate_telemetry.ts`                          |
| CLI ile telemetri üretimi                                                    | ✅ Tam  | `packages/mcp-server/package.json` → `generate-telemetry`, `packages/mcp-server/src/generate_telemetry.ts`          |
| Test kapsamı (Node + Python + entegrasyon)                                   | ✅ Tam  | `packages/mcp-server/tests/tools.test.ts`, `semantic_engine/tests`, `tests/run_tests.cjs`                           |
| Dokümantasyon ve kullanım kılavuzları                                        | ✅ Tam  | Güncellenmiş `DEPLOYMENT.md`, mevcut `ARCHITECTURE.md`, `SYSTEM_FLOW.md`                                            |

> Not: Plan maddeleri `karma_mcp_final_architecture.md` içeriğine göre gruplanmış, eksik/kapsam dışı başlık bırakılmamıştır.
