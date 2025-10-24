Connecting Codex to the local MCP HTTP server

Overview
- This project ships an MCP server with an HTTP bridge at `/mcp`.
- Default listen URL: `http://127.0.0.1:7450/mcp` (set `MCP_HTTP_PORT` to change).
- You can run it via: `npm run mcp:http:bridge` (or see Windows background example below).

Run the MCP HTTP bridge
- Foreground: `npm run build && npm run mcp:http:bridge`
- Windows background example:
  - PowerShell:
    - `$env:MCP_HTTP_PORT='7450'`
    - `Start-Process -FilePath node -ArgumentList 'dist/launch_mcp_http.js' -WorkingDirectory 'packages/mcp-server'`

Codex MCP client configuration (Windows)
- Create or edit `%APPDATA%\codex\mcp.json` and add an entry like:

  {
    "clients": {
      "rag_mcp_http": {
        "transport": {
          "type": "http",
          "url": "http://127.0.0.1:7450/mcp"
        }
      }
    }
  }

- If you already have entries, merge the `rag_mcp_http` block into your existing JSON.

Automated setup (Windows)
- One-time configure Codex MCP client via script in this repo:
  - `npm run codex:configure`
- Script path: `scripts/setup_codex_mcp.ps1`
  - Writes/merges `%APPDATA%\codex\mcp.json` with:
    - client id: `rag_mcp_http`
    - url: `http://127.0.0.1:7450/mcp`

Quick diagnostics
- Initialize: `Invoke-RestMethod -Uri http://127.0.0.1:7450/mcp -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"codex","version":"dev"}}}'`
- List tools: `Invoke-RestMethod -Uri http://127.0.0.1:7450/mcp -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'`

Notes
- The bridge forwards JSON-RPC 2.0 over HTTP to the internal stdio MCP adapter.
- The server ignores notifications like `initialized` and `sessionConfigured` (per JSON-RPC rules).
- If Python FastAPI dependencies are missing, the semantic engine will be skipped; core tools still work.
