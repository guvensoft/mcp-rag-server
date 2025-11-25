import fs from 'fs';
import path from 'path';
import { Project, SyntaxKind } from 'ts-morph';
import madge from 'madge';
import { FileMeta, SymbolMeta, SemanticEntry } from '@mcp/shared';
import Database from 'better-sqlite3';
import { AnnStoreAdapter, AnnStoreConfig, buildTextEmbedding, loadAnnConfigFromEnv } from './ann_store';

export type IndexingMode = 'incremental' | 'full';

export interface MetadataFilter {
  (entry: { metadata?: Record<string, string | number | boolean | null>; namespace?: string; tenant?: string }): boolean;
}

export interface IndexerOptions {
  mode?: IndexingMode;
  namespace?: string;
  tenant?: string;
  metadataFilter?: MetadataFilter;
  annConfig?: AnnStoreConfig;
}

function writeSQLite(dbPath: string, files: FileMeta[], imports: Array<{ from: string; to: string }>) {
  // Ensure directory and file exist
  try {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(dbPath)) {
      const fd = fs.openSync(dbPath, 'a');
      fs.closeSync(fd);
    }
  } catch {}
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY,
      file_id INTEGER,
      name TEXT,
      kind TEXT,
      start_line INTEGER,
      end_line INTEGER,
      FOREIGN KEY(file_id) REFERENCES files(id)
    );
    CREATE TABLE IF NOT EXISTS edges (
      from_file INTEGER,
      to_file INTEGER,
      kind TEXT,
      UNIQUE(from_file, to_file, kind)
    );
  `);
  db.exec('BEGIN');
  db.exec('DELETE FROM edges; DELETE FROM symbols; DELETE FROM files;');
  const insertFile = db.prepare('INSERT OR IGNORE INTO files(path) VALUES (?)');
  const getFileId = db.prepare('SELECT id FROM files WHERE path=?');
  const insertSym = db.prepare('INSERT INTO symbols(file_id,name,kind,start_line,end_line) VALUES (?,?,?,?,?)');
  for (const f of files) {
    insertFile.run(f.path);
    const row = getFileId.get(f.path) as any;
    for (const s of f.symbols) insertSym.run(row.id, s.name, s.kind, s.startLine, s.endLine);
  }
  const insertEdge = db.prepare('INSERT OR IGNORE INTO edges(from_file,to_file,kind) VALUES (?,?,?)');
  for (const e of imports) {
    const fromRow = getFileId.get(e.from) as any;
    const toRow = getFileId.get(e.to) as any;
    if (fromRow && toRow) insertEdge.run(fromRow.id, toRow.id, 'import');
  }
  db.exec('COMMIT');
  db.close();
}

function buildEdgesWithTsMorph(project: Project, rootDir: string): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  const files = project.getSourceFiles();
  // Debug root info if needed
  try {
    const info = `rootDir=${rootDir}\nfirstFile=${files[0]?.getFilePath()}`;
    const out = path.join(process.cwd(), 'data', 'edges_info.txt');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, info, 'utf8');
  } catch {}
  for (const sf of files) {
    const fromAbs = sf.getFilePath();
    const fromRel = path.relative(rootDir, fromAbs).replace(/\\/g, '/');
    // import declarations
    for (const imp of sf.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (!target) continue;
      const toAbs = target.getFilePath();
      if (!toAbs.startsWith(rootDir)) continue;
      const toRel = path.relative(rootDir, toAbs).replace(/\\/g, '/');
      if (fromRel !== toRel) edges.push({ from: fromRel, to: toRel });
    }
    // export declarations (re-exports)
    for (const exp of sf.getExportDeclarations()) {
      const target = exp.getModuleSpecifierSourceFile();
      if (!target) continue;
      const toAbs = target.getFilePath();
      if (!toAbs.startsWith(rootDir)) continue;
      const toRel = path.relative(rootDir, toAbs).replace(/\\/g, '/');
      if (fromRel !== toRel) edges.push({ from: fromRel, to: toRel });
    }
  }
  // de-duplicate
  const key = (e: { from: string; to: string }) => `${e.from}=>${e.to}`;
  const map = new Map<string, { from: string; to: string }>();
  for (const e of edges) map.set(key(e), e);
  return Array.from(map.values());
}

function resolveTsConfig(): string | undefined {
  const envPath = process.env.TS_CONFIG_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  // Prefer the package-local tsconfig to avoid relying on process.cwd()
  const pkgTs = path.resolve(__dirname, '..', 'tsconfig.json');
  if (fs.existsSync(pkgTs)) return pkgTs;
  // Next, try repository root tsconfig relative to this file
  const repoRootTs = path.resolve(__dirname, '..', '..', '..', 'tsconfig.json');
  if (fs.existsSync(repoRootTs)) return repoRootTs;
  // Finally, try current working directory only if it actually exists
  const cwdTs = path.resolve(process.cwd(), 'tsconfig.json');
  if (fs.existsSync(cwdTs)) return cwdTs;
  return undefined;
}

function buildMetadataFilterFromEnv(): MetadataFilter | undefined {
  const raw = process.env.INDEX_METADATA_FILTER;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, string | number | boolean | null>;
    if (!parsed || typeof parsed !== 'object') return undefined;
    return entry => {
      const metadata = entry.metadata || {};
      return Object.entries(parsed).every(([key, value]) => metadata[key] === value);
    };
  } catch {
    return undefined;
  }
}

function normalizeOptions(options?: IndexerOptions): Required<IndexerOptions> {
  const modeEnv = (process.env.INDEX_MODE || '').toLowerCase();
  const namespace = options?.namespace ?? process.env.INDEX_NAMESPACE ?? undefined;
  const tenant = options?.tenant ?? process.env.INDEX_TENANT ?? undefined;
  return {
    mode: options?.mode ?? (modeEnv === 'incremental' ? 'incremental' : 'full'),
    namespace,
    tenant,
    metadataFilter: options?.metadataFilter ?? buildMetadataFilterFromEnv(),
    annConfig: options?.annConfig ?? loadAnnConfigFromEnv(),
  };
}

function mergeMetadata(base?: Record<string, string | number | boolean | null>, updates?: Record<string, string | number | boolean | null>) {
  return { ...(base || {}), ...(updates || {}) };
}

function updateEntriesFromPrevious(
  previous: SemanticEntry[] | undefined,
  fileMeta: FileMeta,
): SemanticEntry[] {
  if (!previous) return [];
  return previous.map(entry => ({
    ...entry,
    namespace: fileMeta.namespace,
    tenant: fileMeta.tenant,
    metadata: mergeMetadata(entry.metadata, fileMeta.metadata),
  }));
}

function createSemanticEntries(fileMeta: FileMeta): SemanticEntry[] {
  const lines = fileMeta.content.split(/\r?\n/);
  const entries: SemanticEntry[] = [];
  for (const sym of fileMeta.symbols) {
    const snippetLines = lines.slice(sym.startLine - 1, sym.endLine);
    const text = snippetLines.join('\n');
    entries.push({
      id: `${fileMeta.path}:${sym.name}`,
      file: fileMeta.path,
      symbol: sym.name,
      startLine: sym.startLine,
      endLine: sym.endLine,
      text,
      namespace: fileMeta.namespace,
      tenant: fileMeta.tenant,
      metadata: { ...(fileMeta.metadata || {}), symbolKind: sym.kind },
    });
  }
  return entries;
}

export async function runIndexer(rootDir: string, outDir: string, sqlitePath?: string, options?: IndexerOptions) {
  const resolvedOptions = normalizeOptions(options);
  const tsConfigPath = resolveTsConfig();
  let project: Project;
  try {
    project = tsConfigPath
      ? new Project({ tsConfigFilePath: tsConfigPath })
      : new Project({ skipAddingFilesFromTsConfig: true });
  } catch {
    // Fall back to a minimal config that avoids reading any tsconfig
    project = new Project({ skipAddingFilesFromTsConfig: true });
  }

  const tsFiles = project.addSourceFilesAtPaths([path.join(rootDir, '**/*.ts'), '!' + path.join(rootDir, '**/*.d.ts')]);
  const fileMetas: FileMeta[] = [];
  const semanticEntries: SemanticEntry[] = [];

  let previousFiles: FileMeta[] = [];
  let previousEntries: SemanticEntry[] = [];
  if (resolvedOptions.mode === 'incremental') {
    try {
      previousFiles = JSON.parse(fs.readFileSync(path.join(outDir, 'index.json'), 'utf8')) as FileMeta[];
    } catch {
      previousFiles = [];
    }
    try {
      previousEntries = JSON.parse(fs.readFileSync(path.join(outDir, 'semantic_entries.json'), 'utf8')) as SemanticEntry[];
    } catch {
      previousEntries = [];
    }
  }

  const prevFileMap = new Map(previousFiles.map(f => [f.path, f]));
  const prevEntryMap = new Map<string, SemanticEntry[]>();
  for (const entry of previousEntries) {
    const list = prevEntryMap.get(entry.file) || [];
    list.push(entry);
    prevEntryMap.set(entry.file, list);
  }

  for (const sf of tsFiles) {
    const fullPath = sf.getFilePath();
    const content = sf.getFullText();
    const symbols: SymbolMeta[] = [];
    sf.forEachDescendant(node => {
      if (node.getKind() === SyntaxKind.FunctionDeclaration) {
        const fn = node.asKind(SyntaxKind.FunctionDeclaration)!;
        const name = fn.getName();
        if (name) {
          const start = fn.getStartLineNumber();
          const end = fn.getEndLineNumber();
          symbols.push({ name, kind: 'function', file: fullPath, startLine: start, endLine: end });
        }
      } else if (node.getKind() === SyntaxKind.ClassDeclaration) {
        const cls = node.asKind(SyntaxKind.ClassDeclaration)!;
        const name = cls.getName();
        if (name) {
          const start = cls.getStartLineNumber();
          const end = cls.getEndLineNumber();
          symbols.push({ name, kind: 'class', file: fullPath, startLine: start, endLine: end });
          for (const m of cls.getMethods()) {
            symbols.push({ name: `${name}.${m.getName()}`, kind: 'method', file: fullPath, startLine: m.getStartLineNumber(), endLine: m.getEndLineNumber() });
          }
        }
      }
    });

    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    const stat = fs.statSync(fullPath);
    const metadata = mergeMetadata({ language: 'typescript', path: relativePath }, {});
    const fileMeta: FileMeta = {
      path: relativePath,
      content,
      symbols,
      namespace: resolvedOptions.namespace,
      tenant: resolvedOptions.tenant,
      metadata,
      mtimeMs: stat.mtimeMs,
    };

    if (resolvedOptions.metadataFilter && !resolvedOptions.metadataFilter(fileMeta)) continue;

    const previous = prevFileMap.get(relativePath);
    const reusePrevious = resolvedOptions.mode === 'incremental' && previous?.mtimeMs === stat.mtimeMs;
    if (reusePrevious) {
      const inheritedEntries = updateEntriesFromPrevious(prevEntryMap.get(relativePath), fileMeta);
      fileMetas.push({ ...previous, ...fileMeta });
      semanticEntries.push(...inheritedEntries);
      continue;
    }

    fileMetas.push(fileMeta);
    const entries = createSemanticEntries(fileMeta);
    semanticEntries.push(...entries);
  }

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(fileMetas, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'semantic_entries.json'), JSON.stringify(semanticEntries, null, 2), 'utf8');

  // Build edges via madge (best-effort)
  let edges: Array<{ from: string; to: string }> = [];
  try {
    const result = await madge(rootDir, {
      fileExtensions: ['ts', 'tsx', 'js', 'jsx'],
      // Provide a stable tsconfig path that actually exists
      tsConfig: tsConfigPath && fs.existsSync(tsConfigPath)
        ? tsConfigPath
        : path.resolve(__dirname, '..', 'tsconfig.json'),
      detectiveOptions: { ts: { skipTypeImports: true } } as any,
      includeNpm: false,
      baseDir: rootDir,
    } as any);
    const graph = await result.obj();
    for (const [from, tos] of Object.entries(graph)) {
      const fromAbs = path.isAbsolute(from) ? from : path.resolve(rootDir, from);
      const fromRel = path.relative(rootDir, fromAbs).replace(/\\/g, '/');
      for (const to of tos as string[]) {
        const toAbs = path.isAbsolute(to) ? to : path.resolve(rootDir, to);
        const toRel = path.relative(rootDir, toAbs).replace(/\\/g, '/');
        if (fromRel && toRel && fromRel !== toRel) edges.push({ from: fromRel, to: toRel });
      }
    }
  } catch {
    // ignore madge errors; fallback to ts-morph
  }

  // Fallback/union with ts-morph derived edges
  const morphEdges = buildEdgesWithTsMorph(project, rootDir);
  const existing = new Set(edges.map(e => `${e.from}=>${e.to}`));
  for (const e of morphEdges) if (!existing.has(`${e.from}=>${e.to}`)) edges.push(e);
  // Debug: dump edges
  try { fs.writeFileSync(path.join(outDir, 'edges.json'), JSON.stringify(edges, null, 2), 'utf8'); } catch {}
  if (sqlitePath) writeSQLite(sqlitePath, fileMetas, edges);

  if (resolvedOptions.annConfig) {
    try {
      const ann = new AnnStoreAdapter(resolvedOptions.annConfig);
      await ann.upsert(semanticEntries.map(entry => ({ ...entry, vector: buildTextEmbedding(entry.text) })));
    } catch (err) {
      // Do not block indexing if ANN persistence fails
      try { fs.writeFileSync(path.join(outDir, 'ann_store_error.log'), String(err)); } catch {}
    }
  }

  return { files: fileMetas, semanticEntries, edges };
}

if (require.main === module) {
  const rootDir = path.join(process.cwd(), 'src');
  const outDir = path.join(process.cwd(), 'data');
  const sqlite = path.join(outDir, 'graph.db');
  runIndexer(rootDir, outDir, sqlite).then(() => console.log('Indexing (monorepo) complete.'));
}
