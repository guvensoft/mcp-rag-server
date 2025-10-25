#!/usr/bin/env node
// Simple MCP spawn wrapper for diagnostics.
// Usage:
//  node mcp_spawn_wrapper.cjs --log-only --out c:\path\to\mcp_wrapper.log -- target_mcp_command arg1 arg2 ...

const fs = require('fs');
const child_process = require('child_process');

function usage() {
  console.error('Usage: node mcp_spawn_wrapper.cjs [--log-only] [--out <logfile>] -- <command> [args...]');
  process.exit(2);
}

const argv = process.argv.slice(2);
let logOnly = false;
let outPath = null;
let dashIndex = argv.indexOf('--');
if (dashIndex === -1) dashIndex = argv.length;

let i = 0;
while (i < dashIndex) {
  const a = argv[i];
  if (a === '--log-only') { logOnly = true; i++; }
  else if (a === '--out') { outPath = argv[i+1]; i += 2; }
  else { usage(); }
}

const target = argv.slice(dashIndex + 1);
if (!target || target.length === 0) usage();

function writeLog(line) {
  const ts = new Date().toISOString();
  const out = `[${ts}] ${line}\n`;
  if (outPath) fs.appendFileSync(outPath, out);
  else fs.writeFileSync('/dev/stdout', out, { flag: 'a' });
}

// Log args & env
writeLog('mcp_spawn_wrapper invoked');
writeLog('process.argv=' + JSON.stringify(process.argv));
writeLog('cwd=' + process.cwd());
writeLog('env keys=' + JSON.stringify(Object.keys(process.env)));
if (process.env.PATH) writeLog('PATH=' + process.env.PATH);
writeLog('target=' + JSON.stringify(target));

if (logOnly) {
  writeLog('--log-only, exiting without spawning target');
  process.exit(0);
}

// Spawn target and proxy stdio
writeLog('spawning child: ' + JSON.stringify({ command: target[0], args: target.slice(1) }));
const child = child_process.spawn(target[0], target.slice(1), { stdio: 'pipe', env: process.env });

writeLog('child pid=' + (child.pid || 'unknown'));
child.stdout.on('data', (d) => {
  writeLog('child.stdout ' + d.toString().slice(0, 200));
  process.stdout.write(d);
});
child.stderr.on('data', (d) => {
  writeLog('child.stderr ' + d.toString().slice(0, 200));
  process.stderr.write(d);
});
process.stdin.on('data', (d) => child.stdin.write(d));
child.on('exit', (code, sig) => { writeLog('child exit code=' + code + ' sig=' + sig); process.exit(code); });
child.on('error', (err) => {
  writeLog('child error: ' + String(err));
  console.error(err);
  process.exit(1);
});
