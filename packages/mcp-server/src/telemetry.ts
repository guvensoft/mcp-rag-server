import fs from 'fs';
import path from 'path';

type MetricPayload = Record<string, unknown> & {
  name: string;
  duration_ms: number;
  ts: string;
};

type AggregateKey = string;

const LOG_DIR = path.join(process.cwd(), 'logs');
const JSON_LOG_FILE = path.join(LOG_DIR, 'telemetry.log');
let promFile = process.env.TELEMETRY_PROM_FILE
  ? path.resolve(process.cwd(), process.env.TELEMETRY_PROM_FILE)
  : path.join(LOG_DIR, 'telemetry.prom');
let jsonSnapshotFile = process.env.TELEMETRY_JSON_SNAPSHOT
  ? path.resolve(process.cwd(), process.env.TELEMETRY_JSON_SNAPSHOT)
  : path.join(LOG_DIR, 'telemetry_latest.json');

const aggregates = new Map<AggregateKey, { count: number; total: number; max: number; min: number }>();
let promEnabled = true;
let jsonSnapshotEnabled = true;

export function configureTelemetry(options: { promFile?: string; jsonSnapshotFile?: string; disableProm?: boolean; disableSnapshot?: boolean } = {}) {
  if (options.promFile) {
    promFile = path.resolve(process.cwd(), options.promFile);
  }
  if (options.jsonSnapshotFile) {
    jsonSnapshotFile = path.resolve(process.cwd(), options.jsonSnapshotFile);
  }
  if (typeof options.disableProm === 'boolean') promEnabled = !options.disableProm;
  if (typeof options.disableSnapshot === 'boolean') jsonSnapshotEnabled = !options.disableSnapshot;
}

export function startTimer(name: string, attributes: Record<string, unknown> = {}) {
  const start = Date.now();
  return (extra: Record<string, unknown> = {}) => {
    const dur = Date.now() - start;
    const payload: MetricPayload = {
      name,
      duration_ms: dur,
      ts: new Date().toISOString(),
      ...attributes,
      ...extra,
    };
    writeMetric(payload);
  };
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeMetric(m: MetricPayload) {
  try {
    ensureDir(JSON_LOG_FILE);
    fs.appendFileSync(JSON_LOG_FILE, JSON.stringify(m) + '\n', 'utf8');
  } catch (err) {
    if (process.env.DEBUG_TELEMETRY) {
      // eslint-disable-next-line no-console
      console.warn('[telemetry] failed to write JSON log', err);
    }
  }
  updateAggregates(m);
  if (promEnabled) emitPrometheus();
  if (jsonSnapshotEnabled) emitJsonSnapshot();
}

function aggregateKey(m: MetricPayload): AggregateKey {
  return `${m.name}:${m.source ?? 'unknown'}`;
}

function updateAggregates(m: MetricPayload) {
  const key = aggregateKey(m);
  const entry = aggregates.get(key) ?? { count: 0, total: 0, max: Number.MIN_SAFE_INTEGER, min: Number.MAX_SAFE_INTEGER };
  entry.count += 1;
  entry.total += m.duration_ms;
  entry.max = Math.max(entry.max, m.duration_ms);
  entry.min = Math.min(entry.min, m.duration_ms);
  aggregates.set(key, entry);
}

function emitPrometheus() {
  try {
    ensureDir(promFile);
    const lines: string[] = [
      '# HELP mcp_request_duration_ms MCP request durations in milliseconds.',
      '# TYPE mcp_request_duration_ms summary',
    ];
    for (const [key, stats] of aggregates.entries()) {
      const [name, source] = key.split(':');
      const avg = stats.count ? stats.total / stats.count : 0;
      lines.push(`mcp_request_duration_ms_count{name="${name}",source="${source}"} ${stats.count}`);
      lines.push(`mcp_request_duration_ms_sum{name="${name}",source="${source}"} ${stats.total}`);
      lines.push(`mcp_request_duration_ms_avg{name="${name}",source="${source}"} ${avg.toFixed(2)}`);
      lines.push(`mcp_request_duration_ms_max{name="${name}",source="${source}"} ${stats.max}`);
      lines.push(`mcp_request_duration_ms_min{name="${name}",source="${source}"} ${stats.min}`);
    }
    fs.writeFileSync(promFile, lines.join('\n') + '\n', 'utf8');
  } catch (err) {
    if (process.env.DEBUG_TELEMETRY) {
      // eslint-disable-next-line no-console
      console.warn('[telemetry] failed to write Prometheus output', err);
    }
  }
}

function emitJsonSnapshot() {
  try {
    ensureDir(jsonSnapshotFile);
    const snapshot = Array.from(aggregates.entries()).map(([key, stats]) => {
      const [name, source] = key.split(':');
      const avg = stats.count ? stats.total / stats.count : 0;
      return { name, source, count: stats.count, total: stats.total, avg, max: stats.max, min: stats.min };
    });
    fs.writeFileSync(jsonSnapshotFile, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch (err) {
    if (process.env.DEBUG_TELEMETRY) {
      // eslint-disable-next-line no-console
      console.warn('[telemetry] failed to write JSON snapshot', err);
    }
  }
}
