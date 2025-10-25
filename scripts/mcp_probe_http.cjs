// Simple MCP HTTP probe for Codex-style clients
// Usage: node scripts/mcp_probe_http.cjs [url]
// Default URL: http://127.0.0.1:7450/mcp

const http = require('http');

function post(url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = http.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + (u.search || ''),
        headers: {
          'content-type': 'application/json',
          'content-length': data.length,
        },
        timeout: 5000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${text}`));
          }
          try {
            resolve(JSON.parse(text || '{}'));
          } catch (e) {
            reject(new Error(`Invalid JSON: ${e.message}: ${text}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const url = process.argv[2] || 'http://127.0.0.1:7450/mcp';
  // initialize
  const init = await post(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { clientInfo: { name: 'probe', version: '0.0.0' } },
  });
  if (!init.result || !init.result.capabilities) throw new Error('initialize failed');
  // tools/list
  const list = await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  if (!list.result || !Array.isArray(list.result.tools)) throw new Error('tools/list failed');
  // one tool call: roots-list
  const roots = await post(url, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'roots-list', arguments: {} },
  });
  if (!roots.result) throw new Error('tools/call roots-list failed');
  console.log('[probe] OK');
}

main().catch((e) => {
  console.error('[probe] FAILED:', e.message);
  process.exit(1);
});

