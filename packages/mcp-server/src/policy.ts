import fs from 'fs';
import path from 'path';

export function allowPath(p: string): boolean {
  const basename = path.basename(p).toLowerCase();
  if (basename.endsWith('.env') || basename.endsWith('.key') || basename.endsWith('.pem')) return false;
  try {
    const stat = fs.statSync(p);
    if (stat.size > 50 * 1024 * 1024) return false;
  } catch {
    // ignore
  }
  return true;
}

export function filterPaths(paths: string[]): string[] {
  return paths.filter(allowPath);
}

