import Database from 'better-sqlite3';
import path from 'path';

export class GraphStore {
  private db: Database.Database;
  constructor(dbPath: string) {
    const resolved = path.resolve(dbPath);
    this.db = new Database(resolved);
    this.bootstrap();
  }
  private bootstrap() {
    this.db.exec(`
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
  }
  listSymbols(file?: string) {
    if (file) {
      const row = this.db.prepare('SELECT id FROM files WHERE path=?').get(file) as any;
      if (!row) return [] as any[];
      return this.db.prepare('SELECT name, kind, start_line AS startLine, end_line AS endLine FROM symbols WHERE file_id=?').all(row.id) as any[];
    }
    return this.db.prepare('SELECT f.path AS file, s.name, s.kind, s.start_line AS startLine, s.end_line AS endLine FROM symbols s JOIN files f ON s.file_id=f.id').all() as any[];
  }
  listImports(filePath: string): string[] {
    const row = this.db.prepare('SELECT id FROM files WHERE path=?').get(filePath) as any;
    if (!row) return [];
    const rows = this.db
      .prepare('SELECT f.path AS path FROM edges e JOIN files f ON e.to_file=f.id WHERE e.from_file=?')
      .all(row.id) as Array<{ path: string }>;
    return rows.map(r => r.path);
  }
  listDependents(filePath: string): string[] {
    const row = this.db.prepare('SELECT id FROM files WHERE path=?').get(filePath) as any;
    if (!row) return [];
    const rows = this.db
      .prepare('SELECT f.path AS path FROM edges e JOIN files f ON e.from_file=f.id WHERE e.to_file=?')
      .all(row.id) as Array<{ path: string }>;
    return rows.map(r => r.path);
  }
  findRefs(symbol: string) {
    // Simple heuristic: return files that import the file containing the symbol
    const fileRows = this.db.prepare('SELECT f.id, f.path, s.name FROM symbols s JOIN files f ON s.file_id=f.id WHERE s.name LIKE ?').all(`%${symbol}%`);
    if (fileRows.length === 0) return [];
    const fileIds = fileRows.map((r: any) => r.id);
    const placeholders = fileIds.map(() => '?').join(',');
    const refRows = this.db.prepare(`SELECT DISTINCT f2.path AS file FROM edges e JOIN files f1 ON e.to_file=f1.id JOIN files f2 ON e.from_file=f2.id WHERE e.kind='import' AND e.to_file IN (${placeholders})`).all(...fileIds) as any[];
    return refRows as any[];
  }
  degree(filePath: string) {
    const row = this.db.prepare('SELECT id FROM files WHERE path=?').get(filePath) as any;
    if (!row) return 0;
    const out = this.db.prepare('SELECT COUNT(*) AS c FROM edges WHERE from_file=?').get(row.id) as any;
    const inn = this.db.prepare('SELECT COUNT(*) AS c FROM edges WHERE to_file=?').get(row.id) as any;
    return (out?.c || 0) + (inn?.c || 0);
  }
}
