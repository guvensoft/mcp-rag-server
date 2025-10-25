const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

const nodeExe = 'C:\\Users\\Vipac\\AppData\\Roaming\\nvm\\v20.19.5\\node.exe';
const script = 'C:\\Users\\Vipac\\.context7\\mcp\\bin\\mcp.js';

console.log('Starting MCP process:', nodeExe, script);
const child = spawn(nodeExe, [script], { stdio: ['pipe', 'pipe', 'pipe'] });

child.on('error', (err) => {
  console.error('Child process error:', err);
  process.exit(1);
});
child.on('exit', (code, sig) => {
  console.log('Child exited', code, sig);
});

const rl = readline.createInterface({ input: child.stdout });
rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;
  try {
    const obj = JSON.parse(line);
    console.log('MCP ->', JSON.stringify(obj));
  } catch (e) {
    console.log('STDOUT:', line);
  }
});

const erl = readline.createInterface({ input: child.stderr });
erl.on('line', (line) => console.error('MCP ERR:', line));

function send(msg) {
  const s = JSON.stringify(msg) + '\n';
  process.stdout.write('-> ' + s);
  child.stdin.write(s);
}

async function run() {
  // send initialize
  send({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: {} });
  await new Promise(r => setTimeout(r, 500));
  // send tools/list
  send({ jsonrpc: '2.0', id: 'list', method: 'tools/list' });
  // wait for responses up to 5s
  const timeout = 5000;
  await new Promise((resolve) => setTimeout(resolve, timeout));
  console.log('Done waiting; killing child.');
  try { child.kill(); } catch (e) {}
}

run().catch(err => { console.error(err); process.exit(1); });
