import path from 'path';
import fs from 'fs';
import { runIndexer } from './indexer';

async function main() {
  const envRoot = process.env.INDEX_ROOT || process.env.MCP_INDEX_ROOT || process.env.WORKSPACE_ROOT;
  const envData = process.env.DATA_DIR || process.env.MCP_DATA_DIR;
  const rootDir = envRoot ? path.resolve(envRoot) : process.cwd();
  const outDir = envData ? path.resolve(envData) : path.join(process.cwd(), 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const sqlite = path.join(outDir, 'graph.db');
  await runIndexer(rootDir, outDir, sqlite);
  // Also set env so any subsequent child tools could reuse
  process.env.DATA_DIR = outDir;
  process.env.SQLITE_DB = sqlite;
}

main().then(() => console.log('Indexing complete.'), err => { console.error(err?.message || String(err)); process.exit(1); });

