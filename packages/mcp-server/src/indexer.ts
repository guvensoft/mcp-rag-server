import fs from 'fs';
import path from 'path';
import { Project, SyntaxKind } from 'ts-morph';
import madge from 'madge';
import { FileMeta, SymbolMeta, SemanticEntry } from '@mcp/shared';
import Database from 'better-sqlite3';
import { loadConfig } from './config';

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

function chunkByTokens(
  lines: string[],
  startLine: number,
  maxTokens: number,
  overlapTokens: number,
  charsPerToken: number,
): Array<{ text: string; start: number; end: number }> {
  const estimate = (s: string) => Math.max(1, Math.ceil(s.length / charsPerToken));
  const out: Array<{ text: string; start: number; end: number }> = [];
  let idx = 0;
  while (idx < lines.length) {
    let tokenSum = 0;
    let end = idx;
    while (end < lines.length && tokenSum + estimate(lines[end]) <= maxTokens) {
      tokenSum += estimate(lines[end]);
      end++;
    }
    if (end === idx) end = idx + 1; // ensure progress
    const chunkLines = lines.slice(idx, end);
    out.push({
      text: chunkLines.join('\n'),
      start: startLine + idx,
      end: startLine + end - 1,
    });
    if (overlapTokens > 0) {
      let overlap = 0;
      let back = end;
      while (back > idx && overlap < overlapTokens) {
        back--;
        overlap += estimate(lines[back]);
      }
      const nextIdx = back <= idx ? end : back;
      idx = nextIdx;
    } else {
      idx = end;
    }
  }
  return out;
}

export async function runIndexer(rootDir: string, outDir: string, sqlitePath?: string) {
  const cfg = loadConfig();
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
    const fm: FileMeta = { path: relativePath, content, symbols };
    fileMetas.push(fm);
    const lines = content.split(/\r?\n/);
    for (const s of symbols) {
      const snippetLines = lines.slice(s.startLine - 1, s.endLine);
      const chunks = chunkByTokens(
        snippetLines,
        s.startLine,
        cfg.chunking.chunkTokenLimit,
        cfg.chunking.overlapTokens,
        cfg.chunking.charsPerToken,
      );
      chunks.forEach((chunk, idx) => {
        semanticEntries.push({
          id: `${s.file}:${s.name}:chunk${idx + 1}`,
          file: relativePath,
          symbol: s.name,
          startLine: chunk.start,
          endLine: chunk.end,
          text: chunk.text,
        });
      });
    }
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
      tsConfig: (tsConfigPath && fs.existsSync(tsConfigPath))
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
}

if (require.main === module) {
  const rootDir = path.join(process.cwd(), 'src');
  const outDir = path.join(process.cwd(), 'data');
  const sqlite = path.join(outDir, 'graph.db');
  runIndexer(rootDir, outDir, sqlite).then(() => console.log('Indexing (monorepo) complete.'));
}
