import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { GraphStore } from './graph_store';
import { Orchestrator } from './orchestrator';
import { SearchResult } from '@mcp/shared';
import { LangChainBridge } from './langchain_bridge';

export interface RefactorPlanInput {
  file?: string;
  symbol?: string;
  goal?: string;
}

export interface RefactorPlan {
  intent: string;
  summary: string;
  steps: string[];
  risks: string[];
  impact: {
    imports: string[];
    dependents: string[];
  };
}

export interface PatchOperation {
  find: string;
  replace: string;
  occurrences?: number;
}

export interface GeneratedPatch {
  path: string;
  operations: PatchOperation[];
  preview: {
    before: string[];
    after: string[];
  };
}

export interface PatchResult {
  path: string;
  applied: number;
  total: number;
}

export interface PerformanceInsight {
  file: string;
  issues: string[];
  suggestions: string[];
}

export interface VersionComparison {
  fileA: string;
  fileB: string;
  added: string[];
  removed: string[];
  changed: string[];
}

export interface AutoDoc {
  file: string;
  summary: string;
  exports: Array<{ name: string; kind: string; range: string }>;
  deps: {
    imports: string[];
    dependents: string[];
  };
}

export interface TestRunResult {
  command: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface LangChainHit {
  id: string;
  file: string;
  symbol: string;
  score: number;
  snippet: string;
}

export interface LangChainQueryResult {
  available: boolean;
  provider: 'langchain' | 'fallback';
  reason?: string;
  results: LangChainHit[];
}

export interface TelemetryPanelResult {
  output: string;
  entries: number;
}

export interface TelemetryWebview {
  path: string;
  html: string;
}
const MAX_PREVIEW_LINES = 12;

function safeRelative(root: string, target: string) {
  return path.relative(root, target).replace(/\\/g, '/');
}

function slicePreview(lines: string[], startLine: number, endLine: number): string[] {
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, endLine);
  return lines.slice(start, Math.min(end, start + MAX_PREVIEW_LINES));
}

function applyOperations(content: string, operations: PatchOperation[]): { updated: string; applied: number } {
  let current = content;
  let applied = 0;
  for (const op of operations) {
    const occurrences = typeof op.occurrences === 'number' && op.occurrences > 0 ? op.occurrences : 1;
    let count = 0;
    let idx = current.indexOf(op.find);
    while (idx !== -1 && count < occurrences) {
      current = current.slice(0, idx) + op.replace + current.slice(idx + op.find.length);
      applied += 1;
      count += 1;
      idx = current.indexOf(op.find, idx + op.replace.length);
    }
  }
  return { updated: current, applied };
}

export function plan_refactor(orchestrator: Orchestrator, graph: GraphStore, repoRoot: string, input: RefactorPlanInput): RefactorPlan {
  const targetFile = input.file ?? '';
  let summary = 'High level refactor plan for the repository';
  const steps: string[] = [];
  const risks: string[] = [];
  let imports: string[] = [];
  let dependents: string[] = [];

  if (targetFile) {
    try {
      const content = orchestrator.getFile(targetFile);
      const lines = content.split(/\r?\n/);
      const symbols = graph.listSymbols(targetFile) as Array<{ name: string; kind: string; startLine: number; endLine: number }> | [];

      if (input.symbol) {
        const sym = symbols.find(s => s.name === input.symbol);
        if (sym) {
          summary = `Targeted refactor plan for ${input.symbol}`;
          const preview = slicePreview(lines, sym.startLine, sym.endLine);
          steps.push(`Review ${input.symbol} (${sym.kind}) lines ${sym.startLine}-${sym.endLine}`);
          steps.push(`Update dependent tests and call sites for ${input.symbol}`);
          if (input.goal) steps.push(`Apply requested goal: ${input.goal}`);
          risks.push('Run existing tests to catch regressions');
          risks.push('Update documentation if the public API changes');
          if (preview.length) {
            steps.push(`Current snippet:\n${preview.join('\n')}`);
          }
        } else {
          summary = `${input.symbol} symbol not found in GraphStore`;
          steps.push(`Inspect ${targetFile} and verify symbol naming`);
        }
      } else {
        summary = `High level refactor plan for ${targetFile}`;
        const topSymbols = symbols.slice(0, 5).map(s => `${s.name} (${s.kind})`);
        if (topSymbols.length) steps.push(`Review structure: ${topSymbols.join(', ')}`);
        if (input.goal) steps.push(`Focus goal: ${input.goal}`);
        steps.push('Simplify dependencies and deduplicate logic');
      }

      imports = graph.listImports(targetFile);
      dependents = graph.listDependents(targetFile);

      if (!imports.length && !dependents.length) {
        risks.push('File is isolated in the dependency graph; check downstream impact manually');
      } else {
        if (imports.length) risks.push(`${imports.length} imports must remain coherent`);
        if (dependents.length) risks.push(`${dependents.length} files depend on this module; plan regression tests`);
      }
    } catch (err: any) {
      summary = `Failed to produce refactor plan for ${targetFile} (${err?.message ?? 'unknown error'})`;
      steps.push('Verify that the file is indexed (run build and index tasks)');
    }
  } else {
    steps.push('No target file or symbol supplied; outline global refactor goals');
    steps.push('Use GraphStore metadata to pick high-impact modules');
  }

  if (!steps.length) steps.push('Additional context required to craft actionable steps');
  if (!risks.length) risks.push('Follow standard code review and regression testing workflow');

  return {
    intent: input.goal ?? (input.symbol ? 'targeted-refactor' : 'structural-refactor'),
    summary,
    steps,
    risks,
    impact: {
      imports,
      dependents,
    },
  };
}

export function generate_patch(repoRoot: string, filePath: string, operations: PatchOperation[]): GeneratedPatch {
  const abs = path.resolve(repoRoot, filePath);
  const content = fs.readFileSync(abs, 'utf8');
  const { updated } = applyOperations(content, operations);
  const originalPreview = slicePreview(content.split(/\r?\n/), 1, MAX_PREVIEW_LINES);
  const updatedPreview = slicePreview(updated.split(/\r?\n/), 1, MAX_PREVIEW_LINES);
  return {
    path: safeRelative(repoRoot, abs),
    operations,
    preview: {
      before: originalPreview,
      after: updatedPreview,
    },
  };
}

export function apply_patch(repoRoot: string, filePath: string, operations: PatchOperation[]): PatchResult {
  const abs = path.resolve(repoRoot, filePath);
  const content = fs.readFileSync(abs, 'utf8');
  const { updated, applied } = applyOperations(content, operations);
  fs.writeFileSync(abs, updated, 'utf8');
  return {
    path: safeRelative(repoRoot, abs),
    applied,
    total: operations.length,
  };
}

export function analyze_performance(repoRoot: string, filePath: string): PerformanceInsight {
  const abs = path.resolve(repoRoot, filePath);
  const content = fs.readFileSync(abs, 'utf8');
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (/for\s*\([^)]*\)[\s\S]*for\s*\(/.test(content) || /for\s*\([^)]*\)[\s\S]*while\s*\(/.test(content)) {
    issues.push('Nested loops detected');
    suggestions.push('Flatten or refactor nested loops to reduce complexity');
  }
  if (/JSON\.stringify\(.{400,}\)/.test(content)) {
    issues.push('Large JSON.stringify usage may impact performance');
    suggestions.push('Stream or chunk large JSON payloads');
  }
  if (/fs\.(readFileSync|writeFileSync|readdirSync)/.test(content)) {
    issues.push('Synchronous fs calls detected');
    suggestions.push('Prefer async fs APIs to avoid blocking the event loop');
  }
  if (/await\s+.*\.map\(/.test(content) && !/await\s+Promise\.all\([^)]*map\(/.test(content)) {
    issues.push('Await inside Array.map without Promise.all');
    suggestions.push('Wrap async map calls with Promise.all for parallel execution');
  }
  if (!issues.length) {
    suggestions.push('No obvious performance smells detected; capture runtime metrics to confirm');
  }
  return { file: safeRelative(repoRoot, abs), issues, suggestions };
}

function diffLines(a: string[], b: string[]) {
  const removed: string[] = [];
  const added: string[] = [];
  const changed: string[] = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) {
      added.push(`${i + 1}: ${right}`);
    } else if (right === undefined) {
      removed.push(`${i + 1}: ${left}`);
    } else if (left !== right) {
      changed.push(`${i + 1}: ${left} -> ${right}`);
    }
  }
  return { added, removed, changed };
}

export function compare_versions(repoRoot: string, fileA: string, fileB: string): VersionComparison {
  const absA = path.resolve(repoRoot, fileA);
  const absB = path.resolve(repoRoot, fileB);
  const contentA = fs.readFileSync(absA, 'utf8').split(/\r?\n/);
  const contentB = fs.readFileSync(absB, 'utf8').split(/\r?\n/);
  const diff = diffLines(contentA, contentB);
  return {
    fileA: safeRelative(repoRoot, absA),
    fileB: safeRelative(repoRoot, absB),
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
  };
}

export function auto_docs(orchestrator: Orchestrator, graph: GraphStore, repoRoot: string, filePath: string): AutoDoc {
  const abs = path.resolve(repoRoot, filePath);
  const rel = safeRelative(repoRoot, abs);
  const content = orchestrator.getFile(rel);
  const lines = content.split(/\r?\n/);
  const symbols = graph.listSymbols(rel) as Array<{ name: string; kind: string; startLine: number; endLine: number }>;
  const exports = symbols.map(s => ({
    name: s.name,
    kind: s.kind,
    range: `${s.startLine}-${s.endLine}`,
  }));
  const summary = `${rel} contains ${symbols.length} symbols across ${lines.length} lines.`;
  return {
    file: rel,
    summary,
    exports,
    deps: {
      imports: graph.listImports(rel),
      dependents: graph.listDependents(rel),
    },
  };
}

export function run_tests(repoRoot: string, testCommand = 'npm test'): TestRunResult {
  const [cmd, ...args] = testCommand.split(/\s+/).filter(Boolean);
  const binary = process.platform === 'win32' && cmd === 'npm' ? 'npm.cmd' : cmd;
  const result = spawnSync(binary, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return {
    command: testCommand,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function run_task(repoRoot: string, scriptName: string): TestRunResult {
  const pkgPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found under ${repoRoot}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const scripts = pkg.scripts || {};
  if (!scripts[scriptName]) {
    throw new Error(`Script "${scriptName}" is not defined in package.json`);
  }
  const scriptCommand = String(scripts[scriptName]);
  const bin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(bin, ['run', scriptName], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const status =
    typeof result.status === 'number'
      ? result.status
      : result.error
      ? -1
      : 0;
  let finalStatus = status;
  let stdout = result.stdout ?? '';
  let stderr = result.stderr ?? '';
  if (finalStatus !== 0) {
    const fallback = spawnSync(scriptCommand, {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: true,
    });
    finalStatus =
      typeof fallback.status === 'number'
        ? fallback.status
        : fallback.error
        ? -1
        : 0;
    stdout += fallback.stdout ?? '';
    stderr += fallback.stderr ?? '';
  }
  return {
    command: `npm run ${scriptName}`,
    status: finalStatus,
    stdout,
    stderr,
  };
}

export function summarize_architecture(graph: GraphStore) {
  const files = graph['db'].prepare('SELECT COUNT(*) AS c FROM files').get() as any;
  const symbols = graph['db'].prepare('SELECT COUNT(*) AS c FROM symbols').get() as any;
  const edges = graph['db'].prepare('SELECT COUNT(*) AS c FROM edges').get() as any;
  return { files: files?.c || 0, symbols: symbols?.c || 0, edges: edges?.c || 0 };
}

export function detect_smells(repoRoot: string) {
  const smells: Array<{ file: string; issue: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        const content = fs.readFileSync(full, 'utf8');
        if (/TODO|FIXME/.test(content)) smells.push({ file: safeRelative(repoRoot, full), issue: 'TODO/FIXME marker present' });
        if (content.split(/\r?\n/).some(line => line.length > 200)) {
          smells.push({ file: safeRelative(repoRoot, full), issue: 'Line longer than 200 chars' });
        }
      }
    }
  };
  walk(repoRoot);
  return smells;
}

export function suggest_tests(symbols: Array<{ file: string; name: string }>) {
  return symbols.map(s => ({ symbol: s.name, suggestion: `Add unit test for ${s.name} in ${s.file}` }));
}

export async function langchain_query(dataDir: string, query: string, topK = 5): Promise<LangChainQueryResult> {
  const bridge = new LangChainBridge(dataDir);
  return bridge.query(query, topK);
}

export function generate_telemetry_panel(repoRoot: string, outputPath?: string): TelemetryPanelResult {
  const logsDir = path.join(repoRoot, 'logs');
  const snapshotPath = path.join(logsDir, 'telemetry_latest.json');
  let entries: Array<{ name: string; source: string; count: number; total: number; avg: number; max: number; min: number }> = [];
  if (fs.existsSync(snapshotPath)) {
    try {
      entries = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    } catch {
      entries = [];
    }
  }
  const outFile = outputPath ? path.resolve(repoRoot, outputPath) : path.join(logsDir, 'telemetry_panel.html');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const rows = entries
    .map(
      entry =>
        `<tr><td>${entry.name}</td><td>${entry.source}</td><td>${entry.count}</td><td>${entry.total}</td><td>${entry.avg.toFixed(
          2
        )}</td><td>${entry.max}</td><td>${entry.min}</td></tr>`
    )
    .join('');
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>MCP Telemetry Panel</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; background: #111; color: #eee; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #444; padding: 0.5rem; text-align: left; }
    th { background: #222; }
    tbody tr:nth-child(even) { background: #1a1a1a; }
  </style>
</head>
<body>
  <h1>Telemetry Metrics</h1>
  <p>Generated at ${new Date().toISOString()}</p>
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Source</th>
        <th>Count</th>
        <th>Total (ms)</th>
        <th>Avg (ms)</th>
        <th>Max (ms)</th>
        <th>Min (ms)</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="7">No telemetry entries recorded.</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;
  fs.writeFileSync(outFile, html, 'utf8');
  return { output: safeRelative(repoRoot, outFile), entries: entries.length };
}

export function open_telemetry_webview(repoRoot: string, options: { regenerate?: boolean; output?: string } = {}): TelemetryWebview {
  const shouldRegenerate = options.regenerate ?? false;
  const preferredPath = options.output
    ? path.resolve(repoRoot, options.output)
    : path.join(repoRoot, 'logs', 'telemetry_panel.html');

  let htmlPath = preferredPath;
  if (shouldRegenerate || !fs.existsSync(preferredPath)) {
    const generated = generate_telemetry_panel(repoRoot, options.output);
    htmlPath = path.resolve(repoRoot, generated.output);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  return { path: safeRelative(repoRoot, htmlPath), html };
}

export function select_context(results: SearchResult[], budgetTokens: number) {
  if (!results.length) return results;
  if (budgetTokens <= 0) return results;
  const approxTokens = (snippet: string) => Math.ceil(snippet.length / 4);
  const selected: SearchResult[] = [];
  let used = 0;
  for (const res of results) {
    const cost = approxTokens(res.snippet);
    if (used + cost > budgetTokens) continue;
    selected.push(res);
    used += cost;
  }
  return selected.length ? selected : results.slice(0, Math.max(1, Math.min(results.length, 3)));
}
