// Probe the locally built RAG MCP server in C:\Users\Vipac\rag_mcp_server
// Usage: node scripts/mcp_probe_rag.cjs

const { spawn } = require('child_process');

const cmd = process.execPath;
const args = ["C:/Users/Vipac/rag_mcp_server/launch_mcp.js"];
const env = {
  ...process.env,
  MCP_FAST_START: '1',
  MCP_INDEX_ROOT: 'C:/Users/Vipac/Desktop/final_project',
  MCP_DATA_DIR: 'C:/Users/Vipac/rag_mcp_server/data',
};

const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'], env });

let buf = '';
let gotInit = false;
child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  const lines = buf.split(/\r?\n/);
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      console.log('<<', JSON.stringify(obj));
      if (obj.id === 'init') {
        gotInit = true;
        // list tools next
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list' }) + '\n');
      } else if (obj.id === 'list') {
        console.log('\n[probe] tools/list responded. OK');
        child.kill();
      }
    } catch {}
  }
});

// Send initialize
setTimeout(() => {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { clientInfo: { name: 'probe', version: '0.0.0' } } }) + '\n');
}, 200);

setTimeout(() => {
  if (!gotInit) {
    console.error('[probe] No initialize response; failing.');
    try { child.kill(); } catch {}
    process.exit(1);
  }
}, 8000);

