/*
 * Simple test harness for the MCP project. This script compiles the
 * TypeScript sources, runs the indexer on a small sample codebase, starts
 * the Python semantic engine in a subprocess, and exercises the
 * orchestrator's search and getFile functions. If any assertion fails
 * the process exits with a non‑zero status.
 */

const { execSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');

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
  const { command: pythonCmd, extraArgs } = resolvePython();
  // Pick a non-default port to reduce chances of conflict.
  const enginePort = 8005;
  const engineArgs = [...extraArgs, engineScript, path.join(sampleDir, 'data')];
  const engineProc = spawn(pythonCmd, engineArgs, {
    env: { ...process.env, ENGINE_PORT: String(enginePort) },
    stdio: 'inherit',
  });
  await waitForHealth(enginePort);
  // Create orchestrator instance pointing to sample data and engine
  const orchestratorModule = require(path.join(projectRoot, 'dist', 'orchestrator.js'));
  const orch = new orchestratorModule.Orchestrator(path.join(sampleDir, 'data'), `http://localhost:${enginePort}`);

  console.log('Running search test...');
  let results;
  let attempts = 0;
  while (attempts < 5) {
    try {
      results = await orch.searchCode('create order', 3);
      break;
    } catch (err) {
      attempts++;
      console.log('Retrying search...');
      await wait(500);
    }
  }
  if (!results) {
    throw new Error('Semantic engine did not respond in time');
  }
  assert(results.length > 0, 'Expected at least one search result');
  // Ensure that at least one of the returned symbols matches the searched method.
  const found = results.some(r => r.symbol.toLowerCase().includes('createorder'));
  assert(found, 'Expected at least one result containing createOrder');
  console.log('Search test passed');

  console.log('Running getFile test...');
  const content = orch.getFile('orders/order.service.ts');
  assert(content.includes('class OrderService'), 'Expected file content to include OrderService class');
  console.log('getFile test passed');

  // Cleanup: kill Python process
  try { engineProc.kill(); } catch {}
  console.log('All tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

function resolvePython() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push(process.env.PYTHON);
  candidates.push('python3', 'python', 'py -3', 'py');
  for (const candidate of candidates) {
    const parts = candidate.match(/"[^"]+"|[^\s]+/g) || [];
    if (!parts.length) continue;
    const [cmd, ...baseArgs] = parts.map(p => p.replace(/^"|"$/g, ''));
    try {
      const res = spawnSync(cmd, [...baseArgs, '-c', 'import sys'], { stdio: 'ignore' });
      if (res.status === 0) {
        return { command: cmd, extraArgs: baseArgs };
      }
    } catch {
      // ignore candidate failures
    }
  }
  throw new Error('Python executable not found. Set PYTHON env variable to point to a valid interpreter.');
}

async function waitForHealth(port, retries = 10) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const healthy = await checkHealth(port);
    if (healthy) return;
    await wait(500);
  }
  throw new Error('Semantic engine did not respond in time');
}

function checkHealth(port) {
  return new Promise(resolve => {
    const req = http.get({ host: 'localhost', port, path: '/search?q=ping&top_k=1', timeout: 1000 }, res => {
      res.resume();
      resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
