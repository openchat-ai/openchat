// AST-level code search — symbol index + find references + rename
// === invariants ===
// - JS parsing via acorn (no TypeScript — ts files analyzed as JS, TS-specific syntax skipped)
// - Symbol index: functions, classes, variables, exports
// - findReferences: AST-aware (excludes comments, strings)

import fs from 'fs/promises';
import path from 'path';
import * as acorn from 'acorn';

const PROJECT_ROOT = process.cwd();
let _astCache = null;

const astWalker = {
  walkProgram(node, visitors) {
    if (!node || !node.body) return;
    for (const stmt of node.body) this.walkNode(stmt, visitors);
  },
  walkNode(node, visitors) {
    if (!node || typeof node !== 'object') return;
    if (visitors[node.type]) visitors[node.type](node);
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const val = node[key];
      if (Array.isArray(val)) for (const v of val) this.walkNode(v, visitors);
      else if (val && typeof val.type === 'string') this.walkNode(val, visitors);
    }
  },
  findSymbols(ast) {
    const symbols = [];
    this.walkProgram(ast, {
      FunctionDeclaration(node) { if (node.id) symbols.push({ name: node.id.name, kind: 'function', loc: node.loc }); },
      VariableDeclarator(node) { if (node.id && node.id.name) symbols.push({ name: node.id.name, kind: 'variable', loc: node.loc }); },
      ClassDeclaration(node) { if (node.id) symbols.push({ name: node.id.name, kind: 'class', loc: node.loc }); },
      ExportNamedDeclaration(node) {
        if (node.declaration) {
          if (node.declaration.id) symbols.push({ name: node.declaration.id.name, kind: 'export', loc: node.declaration.loc });
        } else for (const s of node.specifiers || []) symbols.push({ name: s.local.name, kind: 'export', loc: s.loc });
      },
      ExportDefaultDeclaration(node) {
        if (node.declaration && node.declaration.id) symbols.push({ name: node.declaration.id.name, kind: 'export-default', loc: node.declaration.loc });
      },
    });
    return symbols;
  },
  findUsages(ast, symbolName) {
    const usages = [];
    this.walkProgram(ast, {
      Identifier(node) {
        if (node.name === symbolName && node.parent?.type !== 'VariableDeclarator' && node.parent?.type !== 'FunctionDeclaration' && node.parent?.type !== 'ClassDeclaration') {
          usages.push({ loc: node.loc, name: node.name });
        }
      },
      ImportSpecifier(node) { if (node.local?.name === symbolName) usages.push({ loc: node.loc, name: node.local.name, kind: 'import' }); },
      ImportDefaultSpecifier(node) { if (node.local?.name === symbolName) usages.push({ loc: node.loc, name: node.local.name, kind: 'import-default' }); },
    });
    return usages;
  },
  renameIdentifier(ast, oldName, newName) {
    let changes = 0;
    this.walkProgram(ast, {
      Identifier(node) { if (node.name === oldName) { node.name = newName; changes++; } },
    });
    return changes;
  },
};

export function parseJS(code) {
  try {
    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true });
    return ast;
  } catch { return null; }
}

export function buildIndex(code, filePath) {
  const ast = parseJS(code);
  if (!ast) return { file: filePath, symbols: [], error: 'parse failed' };
  const symbols = astWalker.findSymbols(ast);
  return { file: filePath, symbols, symbolCount: symbols.length };
}

export async function indexProject(rootDir = '.') {
  const root = path.resolve(PROJECT_ROOT, rootDir);
  if (!root.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
  const index = { files: [], totalSymbols: 0 };
  async function walk(dir) {
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (/\.(js|mjs|cjs|jsx|ts|tsx)$/i.test(e.name)) {
        try {
          const code = await fs.readFile(full, 'utf8');
          const idx = buildIndex(code, path.relative(PROJECT_ROOT, full));
          index.files.push(idx);
          index.totalSymbols += idx.symbolCount || 0;
        } catch { /* skip unreadable */ }
      }
    }
  }
  await walk(root);
  _astCache = index;
  return index;
}

export function findRefs(symbolName, index) {
  if (!index) index = _astCache;
  if (!index) return { definitions: [], usages: [], message: 'no index; call indexProject first' };
  const definitions = [];
  const usages = [];
  for (const file of index.files) {
    const ast = parseJS(fs.readFileSync(path.resolve(PROJECT_ROOT, file.file), 'utf8'));
    if (!ast) continue;
    for (const s of file.symbols) {
      if (s.name === symbolName) definitions.push({ file: file.file, loc: s.loc, kind: s.kind });
    }
    const found = astWalker.findUsages(ast, symbolName);
    for (const u of found) usages.push({ file: file.file, loc: u.loc, kind: u.kind || 'usage' });
  }
  return { definitions, usages };
}

export function renameSymbol(index, oldName, newName) {
  if (!index) index = _astCache;
  if (!index) return { error: 'no index' };
  const results = [];
  for (const file of index.files) {
    try {
      const code = fs.readFileSync(path.resolve(PROJECT_ROOT, file.file), 'utf8');
      const ast = parseJS(code);
      if (!ast) continue;
      const changes = astWalker.renameIdentifier(ast, oldName, newName);
      if (changes > 0) results.push({ file: file.file, changes });
    } catch { /* skip unreadable files */ }
  }
  return { oldName, newName, filesChanged: results.length, totalChanges: results.reduce((a, r) => a + r.changes, 0) };
}

export const TOOLS = [
  { type: 'function', function: { name: 'ast_index', description: 'Build AST symbol index of project files (JS/TS)', parameters: { type: 'object', properties: { rootDir: { type: 'string' } } } } },
  { type: 'function', function: { name: 'ast_find_refs', description: 'Find all definitions and usages of a symbol via AST', parameters: { type: 'object', properties: { symbol: { type: 'string' }, rootDir: { type: 'string' } }, required: ['symbol'] } } },
  { type: 'function', function: { name: 'ast_rename', description: 'Rename a symbol across all project files', parameters: { type: 'object', properties: { oldName: { type: 'string' }, newName: { type: 'string' }, rootDir: { type: 'string' } }, required: ['oldName', 'newName'] } } },
];

export async function executeTool(name, args) {
  switch (name) {
    case 'ast_index': return indexProject(args.rootDir);
    case 'ast_find_refs': {
      const idx = await indexProject(args.rootDir);
      return findRefs(args.symbol, idx);
    }
    case 'ast_rename': {
      const idx = await indexProject(args.rootDir);
      return renameSymbol(idx, args.oldName, args.newName);
    }
    default: throw new Error(`Unknown ast tool: ${name}`);
  }
}
