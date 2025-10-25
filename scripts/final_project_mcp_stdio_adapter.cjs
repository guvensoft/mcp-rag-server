// Minimal stdio MCP entry: set env + CWD, then run adapter only (no index/watch)
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
try { process.chdir(projectRoot); } catch {}

// Ensure stdout carries ONLY JSON-RPC lines; route logs to stderr
const passThrough = (stream) => (...args) => { try { console.error(`[${stream}]`, ...args); } catch {} };
console.log = passThrough('log');
console.info = passThrough('info');
console.warn = passThrough('warn');

process.env.MCP_FAST_START = '1';
// Do NOT force MCP_STDOUT_LOGS to 1 here; we want clean stdout for JSON
process.env.DATA_DIR = process.env.DATA_DIR || path.join(projectRoot, 'packages', 'mcp-server', 'data');
process.env.SQLITE_DB = process.env.SQLITE_DB || path.join(process.env.DATA_DIR, 'graph.db');
process.env.INDEX_ROOT = process.env.INDEX_ROOT || projectRoot;

// Run the stdio adapter (writes only JSON-RPC to stdout)
require(path.join(projectRoot, 'packages', 'mcp-server', 'dist', 'mcp_adapter.js'));
