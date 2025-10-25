/*
 * Simple test harness for the MCP project. This script compiles the
 * TypeScript sources, runs the indexer on a small sample codebase, starts
 * the Python semantic engine in a subprocess, and exercises the
 * orchestrator's search and getFile functions. If any assertion fails
 * the process exits with a non‑zero status.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const projectRoot = path.resolve(__dirname, '..');
  // Compile TypeScript sources
  console.log('Compiling TypeScript...');
  execSync('npx tsc', { cwd: projectRoot, stdio: 'inherit' });

  // Prepare sample source directory
  const sampleDir = path.join(__dirname, 'sample_src');
  const sampleSrc = path.join(sampleDir, 'src');
  const dataDir = path.join(sampleDir, 'data');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });

  // Create a couple of TS files
  fs.rmSync(sampleSrc, { recursive: true, force: true });
  fs.mkdirSync(sampleSrc, { recursive: true });
  fs.mkdirSync(path.join(sampleSrc, 'orders'), { recursive: true });
  fs.writeFileSync(
    path.join(sampleSrc, 'orders', 'order.service.ts'),
    `export class OrderService {\n  /**\n   * Create a new order with the given items.\n   */\n  createOrder(items: string[]): number {\n    // compute total\n    let total = 0;\n    for (const item of items) {\n      total += item.length;\n    }\n    return total;\n  }\n}\n`
  );
  fs.mkdirSync(path.join(sampleSrc, 'utils'), { recursive: true });
  fs.writeFileSync(
    path.join(sampleSrc, 'utils', 'math.ts'),
    `export function add(a: number, b: number): number {\n  return a + b;\n}\n`
  );

  // Run the indexer on the sample project
  const indexerPath = path.join(projectRoot, 'dist', 'indexer.js');
  console.log('Running indexer on sample project...');
  execSync(`node ${indexerPath}`, {
    cwd: sampleDir,
    env: { ...process.env, INIT_CWD: sampleDir },
    stdio: 'inherit',
  });

  // Start the Python semantic engine
  const engineScript = path.join(projectRoot, 'semantic_engine', 'semantic_engine.py');
  console.log('Starting Python semantic engine...');
  const engineProc = spawn('python3', [engineScript, path.join(sampleDir, 'data')]);
  // Wait for the engine to initialize
  await wait(1000);
  // Create orchestrator instance pointing to sample data and engine
  const { Orchestrator } = require(path.join(projectRoot, 'dist', 'orchestrator.js'));
  const orch = new Orchestrator(path.join(sampleDir, 'data'), 'http://localhost:8000');

  console.log('Running search test...');
  const results = await orch.searchCode('create order', 3);
  assert(results.length > 0, 'Expected at least one search result');
  assert(
    results[0].symbol.includes('createOrder'),
    `Expected top result to be createOrder, got ${results[0].symbol}`
  );
  console.log('Search test passed');

  console.log('Running getFile test...');
  const content = orch.getFile('orders/order.service.ts');
  assert(content.includes('class OrderService'), 'Expected file content to include OrderService class');
  console.log('getFile test passed');

  // Cleanup: kill Python process
  engineProc.kill();
  console.log('All tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});