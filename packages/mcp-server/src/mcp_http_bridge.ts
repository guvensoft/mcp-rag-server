import http from 'http';
import { spawn, ChildProcessByStdio } from 'child_process';
import { Readable, Writable } from 'stream';
import path from 'path';
import readline from 'readline';

type Json = any;
interface RpcRequest { jsonrpc: '2.0'; id: string | number | null; method: string; params?: Json }

export function startMcpHttpBridge(port: number) {
  const adapterPath = path.join(__dirname, 'mcp_adapter.js');
  const child: ChildProcessByStdio<Writable, Readable, Readable> = spawn(process.execPath, [adapterPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  const rl = readline.createInterface({ input: child.stdout });
  const pending = new Map<string, (resp: any) => void>();

  rl.on('line', line => {
    try {
      const obj = JSON.parse(line);
      const id = String(obj.id);
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(obj);
      }
    } catch { /* ignore non-JSON lines */ }
  });

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || !req.url) { res.writeHead(405); return res.end(); }
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname !== '/mcp') { res.writeHead(404); return res.end(); }
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          const handleOne = (p: RpcRequest) => new Promise<any>((resolveOne, rejectOne) => {
            if (p.id === null || typeof p.id === 'undefined') {
              // notification: just forward and return 204 later
              child.stdin.write(JSON.stringify(p) + '\n');
              resolveOne(undefined);
              return;
            }
            const key = String(p.id);
            pending.set(key, resp => resolveOne(resp));
            child.stdin.write(JSON.stringify(p) + '\n');
            // Optionally add a timeout
            setTimeout(() => {
              if (pending.has(key)) { pending.delete(key); rejectOne(new Error('timeout')); }
            }, 30000);
          });

          if (Array.isArray(payload)) {
            const responses = await Promise.all(payload.map(p => handleOne(p)));
            const filtered = responses.filter(r => r !== undefined);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(filtered));
          } else {
            const response = await handleOne(payload);
            if (response === undefined) { res.writeHead(204); res.end(); }
            else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(response)); }
          }
        } catch (e: any) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: e?.message || 'bad request' }));
        }
      });
    } catch {
      res.writeHead(500); res.end();
    }
  });

  server.listen(port, '127.0.0.1');
  return { server, child };
}
