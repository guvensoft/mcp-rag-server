/**
 * Minimal MCP adapter implementing a subset of the Model Context Protocol
 * over stdio using JSON-RPC 2.0. Exposes tools via tools/list and tools/call.
 */
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { Orchestrator } from './orchestrator';
import { GraphStore } from './graph_store';
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
import { allowPath } from './policy';
import { set_weights } from './ranker';
import { WeightManager } from './weights';

const DATA_DIR = process.env.DATA_DIR || process.cwd() + '/data';
const ENGINE_URL = process.env.ENGINE_URL || 'http://localhost:8000';
const SQLITE_DB = process.env.SQLITE_DB || (process.cwd() + '/data/graph.db');

let orchestrator: Orchestrator | null = null;
let graph: GraphStore | null = null;
const wm = new WeightManager();
set_weights(wm.get());

function getOrchestrator(): Orchestrator {
  if (!orchestrator) {
    const dir = process.env.DATA_DIR || DATA_DIR;
    const url = process.env.ENGINE_URL || ENGINE_URL;
    orchestrator = new Orchestrator(dir, url);
  }
  return orchestrator;
}

function getGraph(): GraphStore {
  if (!graph) {
    const db = process.env.SQLITE_DB || SQLITE_DB;
    graph = new GraphStore(db);
  }
  return graph;
}

type Json = any;
interface RpcRequest { 
  jsonrpc: '2.0'; 
  id: string | number | null; 
  method: string; 
  params?: Json;
  msg?: {
    type: string;
    kind: string;
    message: string;
  };
}

function write(obj: any) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function ok(id: RpcRequest['id'], result: any) { write({ jsonrpc: '2.0', id, result }); }
function err(id: RpcRequest['id'], code: number, message: string, data?: any) {
  const e: any = { code, message };
  if (data) e.data = data;
  write({ jsonrpc: '2.0', id, error: e });
}

const INDEX_ROOT = process.env.INDEX_ROOT || process.env.MCP_INDEX_ROOT;
const ROOTS: string[] = Array.from(new Set([
  process.cwd(),
  path.resolve(DATA_DIR),
  ...(INDEX_ROOT ? [path.resolve(INDEX_ROOT)] as string[] : [])
]));

function toFileUri(p: string): string {
  const abs = path.resolve(p);
  const withSlashes = abs.replace(/\\/g, '/');
  // Ensure file:/// prefix with Windows drive support
  if (/^[A-Za-z]:\//.test(withSlashes)) {
    return `file:///${withSlashes}`;
  }
  return `file://${withSlashes.startsWith('/') ? '' : '/'}${withSlashes}`;
}

function fromFileUri(u: string): string {
  try {
    if (!u.startsWith('file://')) return u;
    const url = new URL(u);
    let p = decodeURIComponent(url.pathname);
    // Windows path like /C:/...
    if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(p)) {
      p = p.slice(1);
    }
    return path.normalize(p);
  } catch {
    return u;
  }
}

function safeJoin(root: string, rel: string): string | null {
  const p = path.resolve(root, rel);
  if (!p.startsWith(path.resolve(root))) return null;
  return p;
}

function listFiles(root: string, max = 200): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length && out.length < max) {
    const cur = stack.pop()!;
    try {
      const st = fs.statSync(cur);
      if (st.isDirectory()) {
        for (const name of fs.readdirSync(cur)) {
          const full = path.join(cur, name);
          try {
            const s2 = fs.statSync(full);
            if (s2.isDirectory()) stack.push(full);
            else if (s2.isFile() && allowPath(full)) out.push(full);
          } catch { }
          if (out.length >= max) break;
        }
      } else if (st.isFile() && allowPath(cur)) out.push(cur);
    } catch { }
  }
  return out;
}

const MAX_PROMPT_SNIPPET_LINES = 40;

function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function uniqueList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeRepoPath(value);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function filePreview(file: string, maxLines = MAX_PROMPT_SNIPPET_LINES): string {
  try {
    const content = getOrchestrator().getFile(file);
    const lines = content.split(/\r?\n/).slice(0, maxLines);
    return lines.join('\n').trimEnd();
  } catch {
    return '';
  }
}

function formatList(label: string, items: string[]): string {
  const list = uniqueList(items).slice(0, 8);
  if (!list.length) return '';
  return `${label}:\n${list.map(item => `- ${item}`).join('\n')}`;
}

function buildPromptContext(args: { file?: string; symbol?: string; extraNote?: string }): string {
  const segments: string[] = [];
  const graph = getGraph();
  const file = args.file ? normalizeRepoPath(String(args.file)) : undefined;
  const symbol = args.symbol ? String(args.symbol) : undefined;

  if (file) {
    segments.push(`File Scope: ${file}`);
    const symbols = graph.listSymbols(file).slice(0, 8).map((s: any) => `${s.kind}:${s.name} (L${s.startLine}-${s.endLine})`);
    const imports = graph.listImports(file);
    const dependents = graph.listDependents(file);
    const preview = filePreview(file);
    if (symbols.length) segments.push(formatList('Local symbols', symbols));
    const importBlock = formatList('Imports', imports);
    if (importBlock) segments.push(importBlock);
    const dependentsBlock = formatList('Referenced by', dependents);
    if (dependentsBlock) segments.push(dependentsBlock);
    if (preview) {
      const previewLines = preview.split(/\r?\n/).length;
      segments.push(`File preview (first ${Math.min(previewLines, MAX_PROMPT_SNIPPET_LINES)} lines):\n${preview}`);
    }
  }

  if (symbol) {
    segments.push(`Focus symbol: ${symbol}`);
    const refs = (graph.findRefs(symbol) as Array<{ file?: string }> | undefined) ?? [];
    const refList = uniqueList(refs.map(r => r.file || '').filter(Boolean));
    if (refList.length) segments.push(formatList('Referenced in', refList));
  }

  if (args.extraNote) {
    segments.push(`Additional notes: ${args.extraNote}`);
  }

  return segments.filter(Boolean).join('\n\n');
}

function buildPromptText(name: string, args: Record<string, unknown>): string | null {
  const fileArg = typeof args.file === 'string' ? args.file : undefined;
  const symbolArg = typeof args.symbol === 'string' ? args.symbol : undefined;
  const userContext = typeof args.context === 'string' ? args.context : undefined;
  const extra = typeof args.notes === 'string' ? args.notes : undefined;
  const baseContext = buildPromptContext({ file: fileArg, symbol: symbolArg, extraNote: extra });

  const sections: string[] = [];
  switch (name) {
    case 'refactor': {
      sections.push('Goal: Refactor the target code to improve readability and maintainability without altering behaviour.');
      if (baseContext) sections.push(`Context:\n${baseContext}`);
      if (userContext) sections.push(`Caller notes:\n${userContext}`);
      sections.push('Guidelines:\n- Preserve public contracts and side-effects.\n- Identify technical debt hotspots and propose concise fixes.\n- Provide updated code excerpts with rationale for each change.');
      break;
    }
    case 'test': {
      const subject = symbolArg || fileArg || 'the specified module';
      sections.push(`Goal: Design a focused test strategy for ${subject}.`);
      if (baseContext) sections.push(`Context:\n${baseContext}`);
      if (userContext) sections.push(`Caller notes:\n${userContext}`);
      sections.push('Checklist:\n- Enumerate critical behaviours and edge cases.\n- Recommend unit/integration test boundaries.\n- Suggest fixtures or mocks and expected assertions.');
      break;
    }
    case 'perf': {
      const scope = fileArg || symbolArg || 'the target codebase';
      sections.push(`Goal: Investigate potential performance issues in ${scope}.`);
      if (baseContext) sections.push(`Context:\n${baseContext}`);
      if (userContext) sections.push(`Caller notes:\n${userContext}`);
      sections.push('Focus:\n- Highlight expensive code paths or dependency hot spots.\n- Suggest measurement approaches (profilers, metrics).\n- Recommend optimisation tactics while keeping clarity.');
      break;
    }
    default:
      return null;
  }
  return sections.filter(Boolean).join('\n\n');
}

const tools = [
  {
    name: 'search_code',
    description: 'Semantic code search with hybrid ranking',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' }, top_k: { type: 'number' } },
      required: ['q']
    }
  },
  {
    name: 'get_file',
    description: 'Get file content from index',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  {
    name: 'list_symbols',
    description: 'List symbols, optionally filtered by file',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' } },
      required: []
    }
  },
  {
    name: 'find_refs',
    description: 'Find references via import graph',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string' } },
      required: ['symbol']
    }
  },
  {
    name: 'plan_refactor',
    description: 'Drafts a refactor plan for a target file or symbol',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        symbol: { type: 'string' },
        goal: { type: 'string' }
      },
      required: []
    }
  },
  {
    name: 'gen_patch',
    description: 'Generates a dry-run find/replace patch preview',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
              occurrences: { type: 'number' }
            },
            required: ['find', 'replace']
          }
        }
      },
      required: ['path', 'operations']
    }
  },
  {
    name: 'apply_patch',
    description: 'Applies an approved find/replace patch to disk',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
              occurrences: { type: 'number' }
            },
            required: ['find', 'replace']
          }
        }
      },
      required: ['path', 'operations']
    }
  },
  {
    name: 'analyze_performance',
    description: 'Runs lightweight static heuristics for performance risks',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  {
    name: 'compare_versions',
    description: 'Compares two files line-by-line for quick diffing',
    inputSchema: {
      type: 'object',
      properties: { pathA: { type: 'string' }, pathB: { type: 'string' } },
      required: ['pathA', 'pathB']
    }
  },
  {
    name: 'auto_docs',
    description: 'Produces an automated documentation summary for a file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  {
    name: 'run_tests',
    description: 'Executes a repository-defined test command',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: []
    }
  },
  {
    name: 'run_task',
    description: 'Runs an npm script defined in package.json',
    inputSchema: {
      type: 'object',
      properties: { script: { type: 'string' } },
      required: ['script']
    }
  },
  {
    name: 'generate_telemetry_panel',
    description: 'Generates an HTML telemetry dashboard from logs',
    inputSchema: {
      type: 'object',
      properties: { output: { type: 'string' } },
      required: []
    }
  },
  {
    name: 'open_telemetry_webview',
    description: 'Returns the telemetry dashboard HTML for rendering in a webview',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' } },
      required: ['file']
    }
  },
  {
    name: 'langchain_query',
    description: 'Queries the LangChain bridge (falls back to lexical search)',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' }, top_k: { type: 'number' } },
      required: ['q']
    }
  },
  {
    name: 'summarize_architecture',
    description: 'Summarize codebase topology from graph store',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'detect_smells',
    description: 'Detect simple code smells (TODO/long lines)',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' } },
      required: []
    }
  },
  {
    name: 'suggest_tests',
    description: 'Suggest unit tests for symbols',
    inputSchema: {
      type: 'object',
      properties: { symbols: { type: 'array' } },
      required: ['symbols']
    }
  },
  {
    name: 'submit_feedback',
    description: 'Submit feedback to adapt ranker weights (kind: up|down)',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['up', 'down'] } },
      required: ['kind']
    }
  },
  {
    name: 'get_weights',
    description: 'Get current hybrid ranker weights',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'resources-list',
    description: 'List files under allowed roots (policy filtered)',
    inputSchema: { type: 'object', properties: { root: { type: 'string' }, max: { type: 'number' } }, required: [] }
  },
  {
    name: 'resources-read',
    description: 'Read a single file (policy filtered)',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, maxChars: { type: 'number' } }, required: ['path'] }
  },
  {
    name: 'roots-list',
    description: 'List allowed roots for resources',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'prompts-list',
    description: 'List available prompts',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'prompts-call',
    description: 'Call a prompt template',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, args: { type: 'object' } }, required: ['name'] }
  }
];

const PROMPT_DESCRIPTORS = [
  {
    name: 'refactor',
    description: 'Refactor guidance with repository context',
    arguments: [
      { name: 'file', description: 'Relative file path to focus on', required: false },
      { name: 'symbol', description: 'Specific symbol or class to prioritise', required: false },
      { name: 'context', description: 'Additional human-provided notes', required: false },
      { name: 'notes', description: 'Inline hints or concerns to surface', required: false },
    ],
  },
  {
    name: 'test',
    description: 'Unit/integration test planning for a module or symbol',
    arguments: [
      { name: 'file', description: 'Relative file path for test scope', required: false },
      { name: 'symbol', description: 'Specific function/class to cover', required: false },
      { name: 'context', description: 'Known behaviours or regressions to consider', required: false },
    ],
  },
  {
    name: 'perf',
    description: 'Performance review with dependency awareness',
    arguments: [
      { name: 'file', description: 'File/module suspected to be a bottleneck', required: false },
      { name: 'symbol', description: 'Critical symbol or method to profile', required: false },
      { name: 'target', description: 'Custom target description (default derived from file/symbol)', required: false },
      { name: 'context', description: 'Observed latency or memory symptoms', required: false },
    ],
  },
];

async function handle(req: RpcRequest) {
  try {
    // Ignore notifications (JSON-RPC without id). MCP may send sessionConfigured, etc.
    if (req.id === null || typeof req.id === 'undefined') {
      // Known MCP notifications we can safely ignore
      if (req.method === 'sessionConfigured' || req.method === 'ping' || req.method === 'initialized') {
        return; // no response for notifications
      }
      return; // silently ignore unknown notifications per JSON-RPC
    }
    if (req.method === 'initialize') {
      return ok(req.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'mcp-local', version: '1.0.0' }
      });
    }
    if (req.method === 'ping') {
      return ok(req.id, { ok: true });
    }
    if (req.method === 'shutdown') {
      ok(req.id, { ok: true });
      process.exit(0);
      return;
    }
    if (req.method === 'tools/list') {
      return ok(req.id, { tools });
    }
    if (req.method === 'tools/call') {
      const name = String(req.params?.name || '');
      const args = (req.params?.arguments as any) || {};
      switch (name) {
        case 'search_code': {
          const orchestrator = getOrchestrator();
          const q = String(args.q || '');
          const topK = Number.isFinite(args.top_k) ? Number(args.top_k) : 5;
          const results = await orchestrator.searchCode(q, topK);
          const profile = orchestrator.getLastProfile();
          return ok(req.id, {
            content: [{
              type: 'text',
              text: JSON.stringify({ query: q, profile, results }),
            }],
          });
        }
        case 'get_file': {
          const p = String(args.path || '');
          const content = getOrchestrator().getFile(p);
          return ok(req.id, { content: [{ type: 'text', text: content }] });
        }
        case 'list_symbols': {
          const file = args.file ? String(args.file) : undefined;
          const syms = getGraph().listSymbols(file);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(syms) }] });
        }
        case 'find_refs': {
          const sym = String(args.symbol || '');
          const refs = getGraph().findRefs(sym);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(refs) }] });
        }
        case 'plan_refactor': {
          const file = args.file ? String(args.file) : undefined;
          const symbol = args.symbol ? String(args.symbol) : undefined;
          const goal = args.goal ? String(args.goal) : undefined;
          const plan = plan_refactor(getOrchestrator(), getGraph(), process.cwd(), { file, symbol, goal });
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(plan) }] });
        }
        case 'gen_patch': {
          const file = String(args.path || '');
          const operations = Array.isArray(args.operations) ? args.operations as any[] : [];
          const patch = generate_patch(process.cwd(), file, operations);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(patch) }] });
        }
        case 'apply_patch': {
          const file = String(args.path || '');
          const operations = Array.isArray(args.operations) ? args.operations as any[] : [];
          const res = applyPatchOperations(process.cwd(), file, operations);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(res) }] });
        }
        case 'analyze_performance': {
          const file = String(args.path || '');
          const insight = analyze_performance(process.cwd(), file);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(insight) }] });
        }
        case 'compare_versions': {
          const pathA = String(args.pathA || '');
          const pathB = String(args.pathB || '');
          const cmp = compare_versions(process.cwd(), pathA, pathB);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(cmp) }] });
        }
        case 'auto_docs': {
          const file = String(args.path || '');
          const docs = auto_docs(getOrchestrator(), getGraph(), process.cwd(), file);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(docs) }] });
        }
        case 'run_tests': {
          const command = args.command ? String(args.command) : 'npm test';
          const outcome = run_tests(process.cwd(), command);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(outcome) }] });
        }
        case 'run_task': {
          const script = String(args.script || '');
          const outcome = run_task(process.cwd(), script);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(outcome) }] });
        }
        case 'generate_telemetry_panel': {
          const output = args.output ? String(args.output) : undefined;
          const panel = generate_telemetry_panel(process.cwd(), output);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(panel) }] });
        }
        case 'open_telemetry_webview': {
          const regenerate = args.regenerate === true;
          const output = args.output ? String(args.output) : undefined;
          const webview = open_telemetry_webview(process.cwd(), { regenerate, output });
          return ok(req.id, {
            content: [{
              type: 'text',
              text: webview.html,
              mimeType: 'text/html',
              metadata: { path: webview.path },
            }],
          });
        }
        case 'langchain_query': {
          const q = String(args.q || '');
          const topK = Number.isFinite(args.top_k) ? Number(args.top_k) : 5;
          const dataDir = process.env.DATA_DIR || DATA_DIR;
          const result = await langchain_query(dataDir, q, topK);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
        }
        case 'summarize_architecture': {
          const s = summarize_architecture(getGraph());
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(s) }] });
        }
        case 'detect_smells': {
          const root = String(args.root || process.cwd());
          const res = detect_smells(root);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(res) }] });
        }
        case 'suggest_tests': {
          const symbols = (args.symbols as Array<{ file: string; name: string }>) || [];
          const sugg = suggest_tests(symbols);
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(sugg) }] });
        }
        case 'submit_feedback': {
          const kind = String(args.kind || 'up');
          wm.feedback(kind === 'down' ? 'down' : 'up');
          set_weights(wm.get());
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify({ ok: true, weights: wm.get() }) }] });
        }
        case 'get_weights': {
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(wm.get()) }] });
        }
        case 'resources-list': {
          const root = args.root ? String(args.root) : ROOTS[0];
          const max = Number.isFinite(args.max) ? Number(args.max) : 200;
          if (!ROOTS.some(r => path.resolve(root).startsWith(path.resolve(r)))) {
            return err(req.id, -32001, 'Root not allowed', { root, allowed: ROOTS });
          }
          const files = listFiles(root, max).map(f => path.normalize(f));
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(files) }] });
        }
        case 'resources-read': {
          const p = String(args.path || '');
          const maxChars = Number.isFinite(args.maxChars) ? Number(args.maxChars) : 200_000;
          if (!ROOTS.some(r => path.resolve(p).startsWith(path.resolve(r)))) {
            return err(req.id, -32001, 'Path not under allowed roots', { path: p, allowed: ROOTS });
          }
          if (!allowPath(p)) return err(req.id, -32002, 'Path not allowed by policy', { path: p });
          try {
            const buf = fs.readFileSync(p, 'utf8');
            const text = buf.slice(0, maxChars);
            return ok(req.id, { content: [{ type: 'text', text }] });
          } catch (e: any) {
            return err(req.id, -32003, 'Failed to read file', { path: p, error: e?.message });
          }
        }
        case 'roots-list': {
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(ROOTS) }] });
        }
        case 'prompts-list': {
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(PROMPT_DESCRIPTORS) }] });
        }
        case 'prompts-call': {
          const pname = String(args.name || '');
          const a = (args.args || {}) as Record<string, unknown>;
          const text = buildPromptText(pname, a);
          if (!text) return err(req.id, -32601, 'Prompt not found', { name: pname });
          return ok(req.id, { content: [{ type: 'text', text }] });
        }
        default:
          return err(req.id, -32601, 'Tool not found');
      }
    }
    // Expose top-level MCP resource/prompt methods for IDE panels
    if (req.method === 'resources/list') {
      const args = (req.params as any) || {};
      const rootArg = String(args.root || args.uri || ROOTS[0]);
      const root = rootArg.startsWith('file://') ? fromFileUri(rootArg) : rootArg;
      const max = Number.isFinite(args.max) ? Number(args.max) : 200;
      if (!ROOTS.some(r => path.resolve(root).startsWith(path.resolve(r)))) {
        return err(req.id, -32001, 'Root not allowed', { root, allowed: ROOTS });
      }
      const files = listFiles(root, max).map(f => path.normalize(f));
      return ok(req.id, { resources: files.map(f => ({ uri: toFileUri(f), name: path.basename(f) })) });
    }
    if (req.method === 'resources/read') {
      const args = (req.params as any) || {};
      const raw = String(args.path || args.uri || '');
      const p = raw.startsWith('file://') ? fromFileUri(raw) : raw;
      const maxChars = Number.isFinite(args.maxChars) ? Number(args.maxChars) : 200_000;
      if (!ROOTS.some(r => path.resolve(p).startsWith(path.resolve(r)))) {
        return err(req.id, -32001, 'Path not under allowed roots', { path: p, allowed: ROOTS });
      }
      if (!allowPath(p)) return err(req.id, -32002, 'Path not allowed by policy', { path: p });
      try {
        const buf = fs.readFileSync(p, 'utf8');
        const text = buf.slice(0, maxChars);
        const mimeType = p.endsWith('.html') ? 'text/html' : 'text/plain';
        return ok(req.id, { contents: [{ uri: toFileUri(p), mimeType, text }] });
      } catch (e: any) {
        return err(req.id, -32003, 'Failed to read file', { path: p, error: e?.message });
      }
    }
    if (req.method === 'roots/list') {
      return ok(req.id, { roots: ROOTS.map(r => ({ uri: toFileUri(r), name: r })) });
    }
    if (req.method === 'prompts/list') {
      return ok(req.id, { prompts: PROMPT_DESCRIPTORS });
    }
    if (req.method === 'prompts/call') {
      const args = (req.params as any) || {};
      const pname = String(args.name || '');
      const a = (args.args || {}) as Record<string, unknown>;
      const text = buildPromptText(pname, a);
      if (!text) return err(req.id, -32601, 'Prompt not found', { name: pname });
      return ok(req.id, { content: [{ type: 'text', text }] });
    }
    return err(req.id, -32601, 'Method not found');
  } catch (e: any) {
    return err(req.id, -32000, e?.message || 'Internal error');
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
rl.on('line', line => {
  const s = line.trim(); if (!s) return;
  try { 
    const req = JSON.parse(s) as RpcRequest; 
    if (req.msg?.type === 'user_message') {
      if (req.msg.kind === 'environment_context') {
        const contextObj = parseEnvironmentContext(req.msg.message);
        process.env.MCP_CWD = contextObj.cwd;
        process.env.MCP_APPROVAL_POLICY = contextObj.approval_policy;
        process.env.MCP_SANDBOX_MODE = contextObj.sandbox_mode;
        write({
          jsonrpc: '2.0',
          id: req.id,
          result: { status: 'ok' }
        });
        return;
      }
    }
    handle(req); 
  } catch (e) { 
    console.error('Error handling message:', e);
  }
});

function parseEnvironmentContext(xmlStr: string): any {
  const matches = {
    cwd: xmlStr.match(/<cwd>(.*?)<\/cwd>/)?.[1] || '',
    approval_policy: xmlStr.match(/<approval_policy>(.*?)<\/approval_policy>/)?.[1] || 'on-request',
    sandbox_mode: xmlStr.match(/<sandbox_mode>(.*?)<\/sandbox_mode>/)?.[1] || 'workspace-write'
  };
  return matches;
}

process.on('SIGINT', () => process.exit(0));
