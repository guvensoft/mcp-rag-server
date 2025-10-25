import http from 'http';
import { Orchestrator } from './orchestrator';

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const ENGINE_URL = process.env.ENGINE_URL || 'http://localhost:8000';

const orchestrator = new Orchestrator(DATA_DIR, ENGINE_URL);
const server = http.createServer((req, res) => {
  if (!req.url) { res.statusCode = 400; return res.end('Bad request'); }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/get_file') {
    const filePath = url.searchParams.get('path');
    if (!filePath) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Missing path' })); }
    try {
      const content = orchestrator.getFile(filePath);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ path: filePath, content }));
    } catch (e: any) {
      res.statusCode = 404; res.end(JSON.stringify({ error: e.message }));
    }
  } else if (req.method === 'GET' && url.pathname === '/search_code') {
    const q = url.searchParams.get('q') || '';
    const topK = parseInt(url.searchParams.get('top_k') || '5', 10);
    orchestrator.searchCode(q, topK).then(results => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ query: q, results }));
    }).catch(err => { res.statusCode = 500; res.end(JSON.stringify({ error: err.message })); });
  } else { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found' })); }
});

server.listen(PORT, () => console.log(`MCP HTTP debug server on ${PORT}`));

