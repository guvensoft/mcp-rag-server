// Probe stdio MCP server by spawning launch_mcp.js and performing initialize + tools/list
// Usage: node scripts/mcp_probe_stdio.cjs <launch_path> [root_dir] [data_dir]

const { spawn } = require('child_process');

async function probe(launchPath, rootDir, dataDir) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, MCP_FAST_START: '1' };
    if (rootDir) env.MCP_INDEX_ROOT = rootDir;
    if (dataDir) env.MCP_DATA_DIR = dataDir;
    const child = spawn(process.execPath, [launchPath], { stdio: ['pipe', 'pipe', 'inherit'], env });
    let buf = '';
    let gotInit = false;
    const timeout = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error('timeout waiting for initialize'));
    }, 8000);
    child.stdout.on('data', d => {
      buf += d.toString('utf8');
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (obj.id === 1 && obj.result && obj.result.serverInfo) {
          gotInit = true;
          // request tools/list
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
        } else if (obj.id === 2 && obj.result && obj.result.tools) {
          clearTimeout(timeout);
          try { child.kill(); } catch {}
          return resolve(true);
        }
      }
    });
    // send initialize
    setTimeout(() => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'probe', version: '0.0.0' } } }) + '\n');
    }, 150);
    child.on('exit', (code) => {
      if (!gotInit) reject(new Error('process exited before initialize'));
    });
  });
}

const launch = process.argv[2];
if (!launch) {
  console.error('usage: node scripts/mcp_probe_stdio.cjs <launch_path> [root_dir] [data_dir]');
  process.exit(2);
}
const rootDir = process.argv[3];
const dataDir = process.argv[4];
probe(launch, rootDir, dataDir)
  .then(() => { console.log('[stdio probe] OK'); })
  .catch(e => { console.error('[stdio probe] FAILED', e.message); process.exit(1); });

