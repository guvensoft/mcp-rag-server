// Minimal MCP stdio probe for the Context7 server
// Spawns `npx -y context7-mcp` and sends tools/list
// Usage: node scripts/mcp_probe_context7.cjs

const { spawn } = require('child_process');

// Prefer a local Context7 MCP binary under the user's home directory
const path = require('path');
const homedir = process.env.USERPROFILE || process.env.HOME;
const localMcp = path.join(homedir, '.context7', 'mcp', 'bin', 'mcp.js');
const nodeExe = process.env.NODE_PATH || (process.platform === 'win32'
  ? path.join(homedir, 'AppData', 'Roaming', 'nvm', 'v20.19.5', 'node.exe')
  : 'node');

const env = { ...process.env };

let child;
if (require('fs').existsSync(localMcp)) {
  // Spawn node with the local MCP script directly
  child = spawn(nodeExe, [localMcp], { stdio: ['pipe', 'pipe', 'inherit'], env });
} else {
  // Fallback to npx if local binary is not present
  const npxCmd = process.platform === 'win32' ? 'npx' : 'npx';
  const args = ['-y', 'context7-mcp'];
  const cmd = `${npxCmd} ${args.join(' ')}`;
  child = spawn(cmd, { stdio: ['pipe', 'pipe', 'inherit'], env, shell: true });
}

let buf = '';
let gotResponse = false;

child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  const lines = buf.split(/\r?\n/);
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      console.log('<<', JSON.stringify(obj));
      if (obj.id === 'list') {
        gotResponse = true;
        console.log('\n[probe] tools/list responded.');
        // Done; exit a moment later to flush logs
        setTimeout(() => { try { child.kill(); } catch {} }, 250);
      }
    } catch (e) {
      // ignore non-JSON lines
    }
  }
});

child.on('exit', (code) => {
  if (!gotResponse) {
    console.error(`\n[probe] Server exited (code=${code}) before responding.`);
  }
});

// After a short delay, ask the server to list tools
setTimeout(() => {
  try {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list' }) + '\n');
  } catch (e) {
    console.error('[probe] Failed to write to stdin:', e.message);
  }
}, 600);

// Failsafe timeout
setTimeout(() => {
  if (!gotResponse) {
    console.error('\n[probe] Timed out waiting for MCP responses.');
    try { child.kill(); } catch {}
    process.exit(1);
  }
}, 15000);
