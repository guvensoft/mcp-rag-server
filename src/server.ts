/**
 * HTTP server exposing the MCP functionality. This server offers two
 * endpoints: `/search_code` for semantic search and `/get_file` for
 * retrieving file contents. It delegates heavy lifting to the
 * orchestrator, which interacts with the Python semantic engine.
 */

import http from 'http';
import { Orchestrator } from './orchestrator';

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const ENGINE_URL = process.env.ENGINE_URL || 'http://localhost:8000';

// Create the orchestrator. Loading the index is synchronous.
const orchestrator = new Orchestrator(DATA_DIR, ENGINE_URL);

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/get_file') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Missing "path" parameter' }));
      return;
    }
    try {
      const content = orchestrator.getFile(filePath);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ path: filePath, content }));
    } catch (err: any) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (req.method === 'GET' && url.pathname === '/search_code') {
    const query = url.searchParams.get('q') || '';
    const topKStr = url.searchParams.get('top_k') || '5';
    const topK = parseInt(topKStr, 10);
    orchestrator
      .searchCode(query, topK)
      .then(results => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ query, results }));
      })
      .catch(err => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      });
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`MCP server listening on port ${PORT}`);
});