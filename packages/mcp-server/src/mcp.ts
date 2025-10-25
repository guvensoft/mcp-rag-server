/**
 * Minimal MCP JSON-RPC (stdio) server exposing core tools.
 * Methods:
 *  - search_code(q: string, top_k?: number)
 *  - get_file(path: string)
 *  - list_symbols(file?: string)
 */
import readline from 'readline';
import path from 'path';
import { Orchestrator } from './orchestrator';
import { GraphStore } from './graph_store';
import { startTimer } from './telemetry';
import {
  summarize_architecture,
  detect_smells,
  suggest_tests,
  plan_refactor,
  generate_patch,
  apply_patch as applyPatchOperations,
  analyze_performance,
  compare_versions,
  auto_docs,
  run_tests,
  run_task,
  generate_telemetry_panel,
  langchain_query,
  open_telemetry_webview,
} from './tools';
import { set_weights } from './ranker';
import { WeightManager } from './weights';

const DATA_DIR = process.env.DATA_DIR || process.cwd() + '/data';
const ENGINE_URL = process.env.ENGINE_URL || 'http://localhost:8000';
const orchestrator = new Orchestrator(DATA_DIR, ENGINE_URL);
const graph = new GraphStore(process.env.SQLITE_DB || (process.cwd() + '/data/graph.db'));
const wm = new WeightManager();
set_weights(wm.get());

type Json = any;

interface RpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Json;
}

function respond(id: RpcRequest['id'], result?: Json, error?: { code: number; message: string }) {
  const payload: any = { jsonrpc: '2.0', id };
  if (error) payload.error = error; else payload.result = result ?? null;
  process.stdout.write(JSON.stringify(payload) + '\n');
}

async function handle(req: RpcRequest) {
  try {
    switch (req.method) {
      case 'search_code': {
        const stop = startTimer('search_code', { source: 'mcp:tools' });
        const q = String(req.params?.q ?? '');
        const topK = Number(req.params?.top_k ?? 5);
        const results = await orchestrator.searchCode(q, topK);
        const profile = orchestrator.getLastProfile();
        respond(req.id, { query: q, profile, results });
        stop({ query_length: q.length, result_count: results.length, top_k: topK, intent: profile?.intent });
        return;
      }
      case 'get_file': {
        const stop = startTimer('get_file', { source: 'mcp:tools' });
        const filePath = String(req.params?.path ?? '');
        const content = orchestrator.getFile(filePath);
        respond(req.id, { path: filePath, content });
        stop({ path: filePath, content_length: content.length });
        return;
      }
      case 'list_symbols': {
        const file = req.params?.file ? String(req.params.file) : undefined;
        const symbols = graph.listSymbols(file);
        respond(req.id, symbols);
        return;
      }
      case 'find_refs': {
        const symbol = String(req.params?.symbol ?? '');
        const refs = graph.findRefs(symbol);
        respond(req.id, refs);
        return;
      }
      case 'plan_refactor': {
        const file = req.params?.file ? String(req.params.file) : undefined;
        const symbol = req.params?.symbol ? String(req.params.symbol) : undefined;
        const goal = req.params?.goal ? String(req.params.goal) : undefined;
        const plan = plan_refactor(orchestrator, graph, process.cwd(), { file, symbol, goal });
        respond(req.id, plan);
        return;
      }
      case 'gen_patch': {
        const file = String(req.params?.path ?? '');
        const operations = Array.isArray(req.params?.operations) ? (req.params.operations as any[]) : [];
        const patch = generate_patch(process.cwd(), file, operations);
        respond(req.id, patch);
        return;
      }
      case 'apply_patch': {
        const file = String(req.params?.path ?? '');
        const operations = Array.isArray(req.params?.operations) ? (req.params.operations as any[]) : [];
        const result = applyPatchOperations(process.cwd(), file, operations);
        respond(req.id, result);
        return;
      }
      case 'analyze_performance': {
        const file = String(req.params?.path ?? '');
        const insight = analyze_performance(process.cwd(), file);
        respond(req.id, insight);
        return;
      }
      case 'compare_versions': {
        const pathA = String(req.params?.pathA ?? '');
        const pathB = String(req.params?.pathB ?? '');
        const diff = compare_versions(process.cwd(), pathA, pathB);
        respond(req.id, diff);
        return;
      }
      case 'auto_docs': {
        const file = String(req.params?.path ?? '');
        const docs = auto_docs(orchestrator, graph, process.cwd(), file);
        respond(req.id, docs);
        return;
      }
      case 'run_tests': {
        const command = req.params?.command ? String(req.params.command) : 'npm test';
        const outcome = run_tests(process.cwd(), command);
        respond(req.id, outcome);
        return;
      }
      case 'run_task': {
        const script = String(req.params?.script ?? '');
        const outcome = run_task(process.cwd(), script);
        respond(req.id, outcome);
        return;
      }
      case 'generate_telemetry_panel': {
        const output = req.params?.output ? String(req.params.output) : undefined;
        const panel = generate_telemetry_panel(process.cwd(), output);
        respond(req.id, panel);
        return;
      }
      case 'open_telemetry_webview': {
        const regenerate = req.params?.regenerate === true;
        const output = req.params?.output ? String(req.params.output) : undefined;
        const webview = open_telemetry_webview(process.cwd(), { regenerate, output });
        respond(req.id, webview);
        return;
      }
      case 'langchain_query': {
        const query = String(req.params?.q ?? '');
        const topK = Number(req.params?.top_k ?? 5);
        const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
        langchain_query(dataDir, query, topK)
          .then(result => respond(req.id, result))
          .catch(err => respond(req.id, undefined, { code: -32000, message: err?.message || 'LangChain query failed' }));
        return;
      }
      case 'summarize_architecture': {
        const summary = summarize_architecture(graph);
        respond(req.id, summary);
        return;
      }
      case 'detect_smells': {
        const repo = String(req.params?.root ?? process.cwd());
        const res = detect_smells(repo);
        respond(req.id, res);
        return;
      }
      case 'suggest_tests': {
        const symbols = (req.params?.symbols ?? []) as Array<{ file: string; name: string }>;
        const suggestions = suggest_tests(symbols);
        respond(req.id, suggestions);
        return;
      }
      case 'submit_feedback': {
        const kind = String(req.params?.kind ?? 'up');
        wm.feedback(kind === 'down' ? 'down' : 'up');
        set_weights(wm.get());
        respond(req.id, { ok: true, weights: wm.get() });
        return;
      }
      case 'get_weights': {
        respond(req.id, wm.get());
        return;
      }
      default:
        respond(req.id, undefined, { code: -32601, message: 'Method not found' });
    }
  } catch (e: any) {
    respond(req.id, undefined, { code: -32000, message: e?.message || 'Internal error' });
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
rl.on('line', line => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line) as RpcRequest;
    if (req && req.jsonrpc === '2.0' && req.method) {
      handle(req);
    }
  } catch {
    // ignore
  }
});

process.on('SIGINT', () => process.exit(0));
