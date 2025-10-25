// Ensure correct CWD and env, then start the stdio MCP server
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
try { process.chdir(projectRoot); } catch {}

process.env.MCP_FAST_START = process.env.MCP_FAST_START || '1';
process.env.MCP_STDOUT_LOGS = process.env.MCP_STDOUT_LOGS || '1';
process.env.MCP_INDEX_ROOT = process.env.MCP_INDEX_ROOT || projectRoot;
process.env.MCP_DATA_DIR = process.env.MCP_DATA_DIR || path.join(projectRoot, 'packages', 'mcp-server', 'data');

require(path.join(projectRoot, 'packages', 'mcp-server', 'dist', 'launch_mcp.js'));
