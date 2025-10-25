import { Queue, Worker, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { runIndexer } from './indexer';

export function createQueue(name = 'mcp-jobs', connection?: string) {
  const conn = connection ? new IORedis(connection) : undefined;
  const queue = new Queue(name, { connection: conn as any });
  return queue;
}

export function startWorker(name = 'mcp-jobs', connection?: string) {
  const conn = connection ? new IORedis(connection) : undefined;
  const worker = new Worker(name, async job => {
    if (job.name === 'reindex') {
      const { rootDir, outDir, sqlite } = job.data as { rootDir: string; outDir: string; sqlite: string };
      await runIndexer(rootDir, outDir, sqlite);
    }
  }, { connection: conn as any });
  return worker;
}

export async function enqueueReindex(queue: Queue, payload: { rootDir: string; outDir: string; sqlite: string }, opts?: JobsOptions) {
  await queue.add('reindex', payload, opts);
}

