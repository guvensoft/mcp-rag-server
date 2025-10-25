import chokidar from 'chokidar';
import path from 'path';
import { runIndexer } from './indexer';
import { createQueue, enqueueReindex } from './job_queue';

export function startWatcher(rootDir: string, outDir: string, sqlitePath: string) {
  const watcher = chokidar.watch([path.join(rootDir, '**/*.ts'), path.join(rootDir, '**/*.tsx')], {
    ignored: [/node_modules/, /dist/, /(^|[/\\])\../],
    ignoreInitial: true,
  });
  const redisUrl = process.env.REDIS_URL;
  const queue = redisUrl ? createQueue('mcp-jobs', redisUrl) : undefined;
  const schedule = debounce(async () => {
    if (queue) {
      await enqueueReindex(queue, { rootDir, outDir, sqlite: sqlitePath });
    } else {
      await runIndexer(rootDir, outDir, sqlitePath);
    }
    console.log('Incremental index scheduled');
  }, 500);
  watcher.on('add', schedule).on('change', schedule).on('unlink', schedule);
  return watcher;
}

function debounce(fn: () => void | Promise<void>, ms: number) {
  let t: any;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

if (require.main === module) {
  const envRoot = process.env.INDEX_ROOT || process.env.MCP_INDEX_ROOT || process.env.WORKSPACE_ROOT;
  const envData = process.env.DATA_DIR || process.env.MCP_DATA_DIR;
  const rootDir = envRoot ? path.resolve(envRoot) : path.join(process.cwd(), 'src');
  const outDir = envData ? path.resolve(envData) : path.join(process.cwd(), 'data');
  const sqlite = path.join(outDir, 'graph.db');
  console.log(`[mcp-watch] rootDir=${rootDir}`);
  console.log(`[mcp-watch] outDir=${outDir}`);
  startWatcher(rootDir, outDir, sqlite);
}
