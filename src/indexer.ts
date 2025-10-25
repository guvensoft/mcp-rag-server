/**
 * Indexer module responsible for scanning TypeScript projects and producing
 * structured metadata about files and symbols. The indexer traverses
 * directories recursively, parses TypeScript source files using the
 * TypeScript compiler API and extracts high‑level symbols such as
 * functions, classes and methods. The resulting metadata is persisted to
 * JSON files so that both the orchestrator and the Python semantic engine
 * have a consistent view of the codebase.
 */

import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import { FileMeta, SymbolMeta, SemanticEntry } from './types';

/**
 * Walk a directory recursively and return a list of absolute paths to
 * TypeScript files. Files under node_modules or hidden directories are
 * ignored. Only files ending in `.ts` or `.tsx` are considered.
 */
function walkDir(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // skip hidden
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      if (/\.tsx?$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

/**
 * Extract symbol metadata from a TypeScript source file. This helper
 * traverses the AST and identifies top‑level function declarations,
 * classes and class methods. For each relevant node it records the
 * symbol name, kind and line range.
 */
function extractSymbols(sourceFile: ts.SourceFile): SymbolMeta[] {
  const symbols: SymbolMeta[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      // Include leading JSDoc comments when computing the start position so
      // that documentation is part of the snippet. Without setting
      // includeJsDocComment=true the comment lines are excluded from the
      // node's start position.
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, true));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      symbols.push({
        name: node.name.getText(),
        kind: 'function',
        file: sourceFile.fileName,
        startLine: start.line + 1,
        endLine: end.line + 1,
      });
    } else if (ts.isClassDeclaration(node) && node.name) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, true));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      symbols.push({
        name: node.name.getText(),
        kind: 'class',
        file: sourceFile.fileName,
        startLine: start.line + 1,
        endLine: end.line + 1,
      });
      // Extract methods within the class
      node.members.forEach(member => {
        if (
          ts.isMethodDeclaration(member) &&
          member.name &&
          ts.isIdentifier(member.name)
        ) {
          const mStart = sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile, true));
          const mEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd());
          symbols.push({
            name: `${node.name!.getText()}.${member.name.getText()}`,
            kind: 'method',
            file: sourceFile.fileName,
            startLine: mStart.line + 1,
            endLine: mEnd.line + 1,
          });
        }
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return symbols;
}

/**
 * Given a file path and its content, extract code snippets for each symbol
 * meta entry. The snippet is composed of lines from startLine to
 * endLine inclusive. The resulting SemanticEntry can then be used by
 * the semantic engine to compute embeddings.
 */
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
    });
  }
  return entries;
}

/**
 * Run the indexing process for a given root directory. It writes two JSON
 * files into the output folder: `index.json` containing file and symbol
 * metadata, and `semantic_entries.json` containing snippet‑level data.
 */
export function runIndexer(rootDir: string, outDir: string): void {
  const tsFiles = walkDir(rootDir);
  const fileMetas: FileMeta[] = [];
  const semanticEntries: SemanticEntry[] = [];
  for (const file of tsFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const symbols = extractSymbols(sourceFile);
    const relativePath = path.relative(rootDir, file).replace(/\\/g, '/');
    const fileMeta: FileMeta = {
      path: relativePath,
      content,
      symbols,
    };
    fileMetas.push(fileMeta);
    const entries = createSemanticEntries(fileMeta);
    semanticEntries.push(...entries);
  }
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(fileMetas, null, 2), 'utf8');
  fs.writeFileSync(
    path.join(outDir, 'semantic_entries.json'),
    JSON.stringify(semanticEntries, null, 2),
    'utf8'
  );
}

// If this script is executed directly (e.g. `npm run index`), run the
// indexer on the repository root (one directory up from this file) and
// output to the `data` directory under the project root.
if (require.main === module) {
  const projectRoot = process.cwd();
  const outDir = path.join(projectRoot, 'data');
  runIndexer(path.join(projectRoot, 'src'), outDir);
  console.log('Indexing complete.');
}
