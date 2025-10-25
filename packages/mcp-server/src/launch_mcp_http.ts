import path from 'path';
import { spawn, execSync } from 'child_process';
import http from 'http';
import { runIndexer } from './indexer';
import { startMcpHttpBridge } from './mcp_http_bridge';

async function ensureIndex() {
  const envRoot = process.env.INDEX_ROOT || process.env.MCP_INDEX_ROOT;
  const envData = process.env.DATA_DIR;
  const rootDir = envRoot ? path.resolve(envRoot) : path.join(__dirname, '..', 'src');
  const outDir = envData ? path.resolve(envData) : path.join(__dirname, '..', 'data');
  const sqlite = path.join(outDir, 'graph.db');
  await runIndexer(rootDir, outDir, sqlite);
}

function waitForHealth(url: string, attempts = 30, delayMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      tries++;
      const req = http.get(url, res => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          res.resume(); resolve();
        } else { res.resume(); if (tries < attempts) setTimeout(tick, delayMs); else reject(new Error('health timeout')); }
      });
      req.on('error', () => { if (tries < attempts) setTimeout(tick, delayMs); else reject(new Error('health error')); });
    };
    tick();
  });
}

async function startFastApi(dataDir: string, port: number) {
  const script = path.join(process.cwd(), 'packages', 'semantic-engine', 'semantic_engine_fastapi.py');
  const env = { ...process.env, DATA_DIR: dataDir, ENGINE_PORT: String(port) };
  try { execSync('python -V', { stdio: 'ignore' }); execSync('python -c "import fastapi,uvicorn"', { stdio: 'ignore' }); }
  catch { throw new Error('python or fastapi/uvicorn not available'); }
  const proc = spawn('python', [script], { env, stdio: 'ignore', windowsHide: true });
  await waitForHealth(`http://127.0.0.1:${port}/health`, 40, 500);
  return proc;
}

(async () => {
  await ensureIndex();
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
  // Start engine or proceed (fallback handled by orchestrator if not reachable)
  let engineCleanup: (() => void) | null = null;
  try {
    const engineProc = await startFastApi(dataDir, 8010);
    engineCleanup = () => { try { engineProc.kill(); } catch {} };
    process.env.ENGINE_URL = `http://127.0.0.1:8010`;
  } catch {
    process.env.ENGINE_URL = process.env.ENGINE_URL || 'http://127.0.0.1:8000';
  }
  process.env.DATA_DIR = dataDir;
  process.env.SQLITE_DB = path.join(dataDir, 'graph.db');

  const port = parseInt(process.env.MCP_HTTP_PORT || '7450', 10);
  const { server, child } = startMcpHttpBridge(port);
  // eslint-disable-next-line no-console
  console.log(`MCP HTTP bridge listening at http://127.0.0.1:${port}/mcp`);

  const shutdown = () => {
    try { server.close(); } catch {}
    try { child.kill(); } catch {}
    try { engineCleanup && engineCleanup(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
