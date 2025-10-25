// Starts the MCP stdio server and runs example tool calls:
// 1) tools/list
// 2) tools/call search_code { q: 'RouterModule', top_k: 5 }
// 3) tools/call get_file { path: <top result file> }

const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'dist', 'launch_mcp.js');

const child = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, MCP_FAST_START: process.env.MCP_FAST_START || '1', MCP_STDOUT_LOGS: '1' },
});

let buf = '';
let step = 0;
let pickedFile = null;

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

child.stdout.on('data', d => {
  buf += d.toString('utf8');
  const lines = buf.split(/\r?\n/);
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (!msg || msg.jsonrpc !== '2.0') continue;
    if (msg.id === 'list' && msg.result) {
      console.log('TOOLS:', (msg.result.tools || []).map(t => t.name).join(', '));
      // Next: search_code
      send({ jsonrpc: '2.0', id: 's1', method: 'tools/call', params: { name: 'search_code', arguments: { q: 'RouterModule', top_k: 5 } } });
    } else if (msg.id === 's1' && msg.result) {
      const text = (msg.result.content && msg.result.content[0] && msg.result.content[0].text) || '{}';
      let payload = {};
      try { payload = JSON.parse(text); } catch {}
      const results = payload.results || [];
      console.log('SEARCH RESULTS (top paths):', results.slice(0, 3).map(r => r.file).join(', '));
      pickedFile = results[0] && results[0].file;
      if (!pickedFile) {
        console.error('No results to fetch file.');
        child.kill();
        process.exit(2);
      }
      send({ jsonrpc: '2.0', id: 'f1', method: 'tools/call', params: { name: 'get_file', arguments: { path: pickedFile } } });
    } else if (msg.id === 'f1' && msg.result) {
      const text = (msg.result.content && msg.result.content[0] && msg.result.content[0].text) || '';
      console.log(`FILE PREVIEW (${pickedFile}):\n` + text.split(/\r?\n/).slice(0, 10).join('\n'));
      child.kill();
      process.exit(0);
    }
  }
});

// Kick off with tools/list after small delay
setTimeout(() => {
  send({ jsonrpc: '2.0', id: 'list', method: 'tools/list' });
}, 400);

setTimeout(() => {
  console.error('Timeout waiting MCP responses.');
  try { child.kill(); } catch {}
  process.exit(1);
}, 20000);

