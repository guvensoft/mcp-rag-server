import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  plan_refactor,
  generate_patch,
  apply_patch,
  analyze_performance,
  compare_versions,
  auto_docs,
  run_tests,
  run_task,
  generate_telemetry_panel,
  open_telemetry_webview,
  langchain_query,
} from '../src/tools';
import type { Orchestrator } from '../src/orchestrator';
import type { GraphStore } from '../src/graph_store';

const sampleCode = `export class Sample {
  items: number[] = [];

  addItem(value: number) {
    for (let i = 0; i < this.items.length; i++) {
      for (let j = 0; j < this.items.length; j++) {
        this.items[j] += value;
      }
    }
    return this.items.length;
  }
}
`;

const fakeOrchestrator = {
  getFile: () => sampleCode,
} as unknown as Orchestrator;

const fakeGraph = {
  listSymbols: () => [
    { name: 'Sample', kind: 'class', startLine: 1, endLine: 11 },
    { name: 'Sample.addItem', kind: 'method', startLine: 4, endLine: 10 },
  ],
  listImports: () => ['utils/logger.ts'],
  listDependents: () => ['services/consumer.ts'],
} as unknown as GraphStore;

describe('tools helpers', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tools-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('plans refactor with symbol focus', () => {
    const plan = plan_refactor(fakeOrchestrator, fakeGraph, tempDir, { file: 'sample.ts', symbol: 'Sample.addItem', goal: 'reduce loop count' });
    expect(plan.summary).toContain('Sample.addItem');
    expect(plan.steps.some(step => step.includes('Sample.addItem'))).toBe(true);
    expect(plan.impact.imports).toEqual(['utils/logger.ts']);
  });

  it('generates and applies patches', () => {
    const filePath = path.join(tempDir, 'demo.ts');
    fs.writeFileSync(filePath, 'const value = 1;\n', 'utf8');
    const patch = generate_patch(tempDir, 'demo.ts', [{ find: '1', replace: '2' }]);
    expect(patch.preview.after.join('\n')).toContain('2');
    const result = apply_patch(tempDir, 'demo.ts', [{ find: '1', replace: '2' }]);
    expect(result.applied).toBe(1);
    const updated = fs.readFileSync(filePath, 'utf8');
    expect(updated).toContain('2');
  });

  it('detects basic performance smells', () => {
    const filePath = path.join(tempDir, 'perf.ts');
    fs.writeFileSync(filePath, sampleCode, 'utf8');
    const insight = analyze_performance(tempDir, 'perf.ts');
    expect(insight.issues.some(issue => issue.includes('Nested'))).toBe(true);
  });

  it('compares versions line by line', () => {
    const a = path.join(tempDir, 'a.ts');
    const b = path.join(tempDir, 'b.ts');
    fs.writeFileSync(a, 'const a = 1;\n', 'utf8');
    fs.writeFileSync(b, 'const a = 2;\n', 'utf8');
    const diff = compare_versions(tempDir, 'a.ts', 'b.ts');
    expect(diff.changed.length).toBeGreaterThan(0);
  });

  it('produces auto docs summary', () => {
    const docs = auto_docs(fakeOrchestrator, fakeGraph, tempDir, 'sample.ts');
    expect(docs.summary).toContain('sample.ts');
    expect(docs.exports.length).toBe(2);
  });

  it('runs provided test command', () => {
    const result = run_tests(tempDir, 'node -e process.exit(0)');
    expect(result.status).toBe(0);
  });

  it('runs an npm script via run_task', () => {
    const pkg = {
      name: 'fixture',
      version: '1.0.0',
      scripts: {
        exit0: 'node -e "process.exit(0)"',
      },
    };
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
    const result = run_task(tempDir, 'exit0');
    expect(result.status).toBe(0);
    expect(result.command).toBe('npm run exit0');
  });

  it('generates telemetry panel html', () => {
    const logsDir = path.join(tempDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const snapshot = [
      { name: 'search_code', source: 'mcp:tools', count: 2, total: 40, avg: 20, max: 30, min: 10 },
    ];
    fs.writeFileSync(path.join(logsDir, 'telemetry_latest.json'), JSON.stringify(snapshot), 'utf8');
    const result = generate_telemetry_panel(tempDir);
    const htmlPath = path.join(tempDir, result.output);
    const html = fs.readFileSync(htmlPath, 'utf8');
    expect(html).toContain('Telemetry Metrics');
    expect(html).toContain('search_code');
  });

  it('opens telemetry webview html', () => {
    const logsDir = path.join(tempDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const snapshot = [
      { name: 'search_code', source: 'mcp:tools', count: 1, total: 10, avg: 10, max: 10, min: 10 },
    ];
    fs.writeFileSync(path.join(logsDir, 'telemetry_latest.json'), JSON.stringify(snapshot), 'utf8');
    generate_telemetry_panel(tempDir);
    const webview = open_telemetry_webview(tempDir);
    expect(webview.html).toContain('<html');
    expect(webview.path.endsWith('.html')).toBe(true);
  });

  it('provides langchain bridge fallback results', async () => {
    const dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const entries = [
      {
        id: 'demo:add',
        file: 'demo.ts',
        symbol: 'add',
        text: 'export function add(a: number, b: number) { return a + b; }',
      },
      {
        id: 'demo:sub',
        file: 'demo.ts',
        symbol: 'sub',
        text: 'export function sub(a: number, b: number) { return a - b; }',
      },
    ];
    fs.writeFileSync(path.join(dataDir, 'semantic_entries.json'), JSON.stringify(entries), 'utf8');
    const result = await langchain_query(dataDir, 'add numbers', 2);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].symbol.toLowerCase()).toContain('add');
  });
});
