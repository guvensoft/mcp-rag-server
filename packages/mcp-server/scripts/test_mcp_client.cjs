// Simple MCP stdio test client to validate the server works.
// Usage (PowerShell):
//  $env:MCP_INDEX_ROOT="C:\\Users\\Vipac\\Desktop\\QuicklyProject\\quickly-desktop-master";
//  $env:MCP_DATA_DIR="C:\\Users\\Vipac\\Desktop\\final_project\\packages\\mcp-server\\data-angular";
//  node packages/mcp-server/scripts/test_mcp_client.cjs

const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'dist', 'launch_mcp.js');

const env = {
  ...process.env,
  MCP_FAST_START: process.env.MCP_FAST_START || '1',
  MCP_STDOUT_LOGS: process.env.MCP_STDOUT_LOGS || '1',
};

const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'inherit'], env });

let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  const lines = buf.split(/\r?\n/);
  buf = lines.pop() ?? '';
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      console.log('<<', JSON.stringify(obj));
      if (obj.id === 'list') {
        console.log('\nTools listed successfully.');
        // Try a basic call: summarize_architecture
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'summ', method: 'tools/call', params: { name: 'summarize_architecture' } }) + '\n');
      } else if (obj.id === 'summ') {
        console.log('\nSummarize_architecture responded. Test OK.');
        child.kill();
      }
    } catch {
      // ignore non-JSON
    }
  }
});

// After a short delay, ask the server to list tools
setTimeout(() => {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list' }) + '\n');
}, 500);

setTimeout(() => {
  console.error('Timed out waiting for MCP responses.');
  try { child.kill(); } catch {}
  process.exit(1);
}, 15000);

