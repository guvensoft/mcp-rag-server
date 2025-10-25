import path from 'path';
import fs from 'fs';
import http from 'http';
import net from 'net';
import type { FSWatcher } from 'chokidar';
import { spawn, execSync } from 'child_process';
import { runIndexer } from './indexer';
import { startWatcher } from './watcher';

async function ensureIndex(rootDir: string, outDir: string, sqlite: string) {
  await runIndexer(rootDir, outDir, sqlite);
}

function tryStartMemurai() {
  try {
    // Start Memurai service if installed; ignore failures.
    if (process.platform === 'win32') {
      execSync('powershell -NoProfile -Command "$s=Get-Service -Name Memurai* -ErrorAction SilentlyContinue | Select-Object -First 1; if ($s -and $s.Status -ne \"Running\") { Start-Service -InputObject $s }"', { stdio: 'ignore' });
    }
  } catch {}
}

function checkPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(() => resolve(true)); });
    srv.listen(port, '127.0.0.1');
  });
}

async function findFreePort(start: number, max: number): Promise<number> {
  for (let p = start; p <= max; p++) {
    // eslint-disable-next-line no-await-in-loop
    if (await checkPortFree(p)) return p;
  }
  return start;
}

function waitForHealth(url: string, attempts = 30, delayMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      tries++;
      const req = http.get(url, res => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          res.resume();
          resolve();
        } else {
          res.resume();
          if (tries < attempts) setTimeout(tick, delayMs); else reject(new Error('health timeout'));
        }
      });
      req.on('error', () => { if (tries < attempts) setTimeout(tick, delayMs); else reject(new Error('health error')); });
    };
    tick();
  });
}

async function startFastApi(dataDir: string, port: number) {
  const script = path.join(process.cwd(), 'packages', 'semantic-engine', 'semantic_engine_fastapi.py');
  const env = { ...process.env, DATA_DIR: dataDir, ENGINE_PORT: String(port) };
  // Quick preflight to ensure python + fastapi are usable; if not, throw and fallback
  try {
    execSync('python -V', { stdio: 'ignore' });
    execSync('python -c "import fastapi,uvicorn"', { stdio: 'ignore' });
  } catch {
    throw new Error('python or fastapi/uvicorn not available');
  }
  const proc = spawn('python', [script], { env, stdio: 'ignore', windowsHide: true });
  await waitForHealth(`http://127.0.0.1:${port}/health`, 40, 500);
  return proc;
}

function startLocalNodeEngine(dataDir: string, port: number) {
  // Minimal in-process engine with /health and /search using naive scoring
  const entriesPath = path.join(dataDir, 'semantic_entries.json');
  let entries: Array<{ id: string; file: string; symbol: string; startLine: number; endLine: number; text: string }> = [];
  try {
    const raw = fs.readFileSync(entriesPath, 'utf8');
    entries = JSON.parse(raw);
  } catch {
    entries = [];
  }
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === '/search') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const topK = Math.max(1, Math.min(50, Number(url.searchParams.get('top_k') || '5')));
        const scored = entries.map(e => {
          const text = (e.text || '').toLowerCase();
          let score = 0;
          if (q) {
            // naive: frequency of query tokens present
            const tokens = q.split(/\s+/).filter(Boolean);
            for (const t of tokens) {
              if (!t) continue;
              const matches = text.split(t).length - 1;
              score += matches;
            }
          }
          return { file: e.file, symbol: e.symbol, startLine: e.startLine, endLine: e.endLine, score, snippet: e.text?.slice(0, 200) || '' };
        }).sort((a, b) => b.score - a.score).slice(0, topK);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ query: q, results: scored }));
        return;
      }
      res.writeHead(404);
      res.end();
    } catch (e) {
      res.writeHead(500);
      res.end();
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

(async () => {
  if (process.env.MCP_STDOUT_LOGS !== '1') {
    const passThrough = (stream: 'log' | 'info' | 'warn') => (...args: unknown[]) =>
      console.error(`[${stream}]`, ...args);
    console.log = passThrough('log');
    console.info = passThrough('info');
    console.warn = passThrough('warn');
  }

  const fastStart = (process.env.MCP_FAST_START === '1' || process.env.FAST_START === '1');
  tryStartMemurai();

  const envRoot = process.env.INDEX_ROOT || process.env.MCP_INDEX_ROOT;
  const envData = process.env.DATA_DIR || process.env.MCP_DATA_DIR;
  const rootDir = envRoot ? path.resolve(envRoot) : path.join(__dirname, '..', 'src');
  const dataDir = envData ? path.resolve(envData) : path.join(__dirname, '..', 'data');
  const sqlitePath = path.join(dataDir, 'graph.db');
  process.env.DATA_DIR = dataDir;
  process.env.SQLITE_DB = sqlitePath;

  const port = await findFreePort(8010, 8020);
  let engineCleanup: (() => void) | null = null;
  const engineUrl = `http://127.0.0.1:${port}`;
  let watcher: FSWatcher | null = null;

  const startIndexWatcher = () => {
    if (!watcher) {
      try {
        watcher = startWatcher(rootDir, dataDir, sqlitePath);
      } catch (err) {
        if (process.env.DEBUG_WATCHER) {
          // eslint-disable-next-line no-console
          console.warn('[mcp] watcher failed to start', err);
        }
      }
    }
  };
  const ensureFreshIndex = async () => {
    await ensureIndex(rootDir, dataDir, sqlitePath);
  };

  if (fastStart) {
    // Start local engine immediately and bind adapter without waiting for index
    const srv = startLocalNodeEngine(dataDir, port);
    engineCleanup = () => { try { srv.close(); } catch {} };
    process.env.ENGINE_URL = engineUrl;

    // Bind stdio adapter ASAP
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('./mcp_adapter');

    startIndexWatcher();

    // Index in background
    setImmediate(async () => { try { await ensureFreshIndex(); } catch {} });
  } else {
    await ensureFreshIndex();
    startIndexWatcher();
    try {
      const engineProc = await startFastApi(dataDir, port);
      engineCleanup = () => { try { engineProc.kill(); } catch {} };
    } catch {
      const srv = startLocalNodeEngine(dataDir, port);
      engineCleanup = () => { try { srv.close(); } catch {} };
    }
    process.env.ENGINE_URL = engineUrl;

    // Bind stdio adapter
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('./mcp_adapter');
  }

  const shutdown = () => {
    try { engineCleanup && engineCleanup(); } catch {}
    try {
      if (watcher) {
        watcher.close().catch(() => undefined);
      }
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
