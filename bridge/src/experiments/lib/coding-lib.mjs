// === request-id.mjs ===
import crypto from 'crypto';
const _store = new Map();

export function generate() {
  const id = crypto.randomUUID().slice(0, 8);
  return id;
}

export function createSpan(parentId, name) {
  const id = generate();
  _store.set(id, { parentId, name, start: Date.now() });
  return id;
}

export function endSpan(spanId) {
  const span = _store.get(spanId);
  if (!span) return;
  span.duration = Date.now() - span.start;
}

export function getTrace(spanId) {
  const parts = [];
  let cur = spanId;
  while (cur && _store.has(cur)) {
    const s = _store.get(cur);
    parts.unshift(s);
    cur = s.parentId;
  }
  return parts;
}

export function formatLog(requestId, ...args) {
  return `[${requestId}] ${args.join(' ')}`;
}

// === rescue-utils.mjs ===
const COERCE_MAP = {
  string: { number: v => String(v), boolean: v => String(v) },
  number: { string: v => { const n = Number(v); return isNaN(n) ? null : n; }, boolean: v => v ? 1 : 0 },
  boolean: { string: v => v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : null, number: v => v !== 0 },
};

export function coerce(value, targetType) {
  const actualType = typeof value;
  if (actualType === targetType) return { ok: true, value };
  const coercion = COERCE_MAP[targetType]?.[actualType];
  if (!coercion) return { ok: false, error: `expected ${targetType}, got ${actualType} (${JSON.stringify(value)})` };
  const coerced = coercion(value);
  if (coerced === null) return { ok: false, error: `cannot coerce ${actualType} to ${targetType}: ${JSON.stringify(value)}` };
  return { ok: true, value: coerced };
}

function _getSchema(schemas, name) {
  if (!schemas) return null;
  const arr = Array.isArray(schemas) ? schemas : [schemas];
  for (const s of arr) {
    const fn = s.function || s;
    if (fn.name === name) return fn;
  }
  return null;
}

export function validateToolCall(toolName, args, toolSchema) {
  const schema = _getSchema(toolSchema, toolName);
  if (!schema) return { valid: false, fixed: false, fixedArgs: args, errors: [`tool ${toolName} not found in schema`], guidance: `未找到工具 ${toolName} 的定义，请检查工具名是否正确` };

  const params = schema.parameters || {};
  const props = params.properties || {};
  const required = params.required || [];
  const errors = [];

  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      errors.push(`缺少必要参数 "${key}"`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const prop = props[key];
    if (!prop) { errors.push(`未知参数 "${key}"`); continue; }
    if (prop.type && prop.type !== 'object' && prop.type !== 'array') {
      const check = coerce(value, prop.type);
      if (!check.ok) errors.push(`参数 "${key}": ${check.error}`);
    }
  }
  return { valid: errors.length === 0, fixed: false, fixedArgs: args, errors, guidance: errors.length > 0 ? `工具调用参数有 ${errors.length} 个问题：${errors.join('；')}` : '' };
}

export function rescueToolCall(toolName, rawArgs, toolSchema) {
  const schema = _getSchema(toolSchema, toolName);
  if (!schema) return { valid: false, fixed: false, fixedArgs: rawArgs, errors: [`tool ${toolName} not found`], guidance: `未找到工具 ${toolName} 的定义` };

  const params = schema.parameters || {};
  const props = params.properties || {};
  const required = params.required || [];
  const errors = [];
  const fixedArgs = { ...rawArgs };
  let fixed = false;

  for (const key of required) {
    if (fixedArgs[key] === undefined || fixedArgs[key] === null) {
      const prop = props[key];
      if (prop && prop.type === 'string' && prop.default !== undefined) { fixedArgs[key] = prop.default; fixed = true; }
      else if (prop && prop.type === 'number' && prop.default !== undefined) { fixedArgs[key] = prop.default; fixed = true; }
      else { errors.push(`缺少必要参数 "${key}"，无法自动修复`); }
    }
  }
  for (const [key, value] of Object.entries(fixedArgs)) {
    const prop = props[key];
    if (!prop) continue;
    if (prop.type && prop.type !== 'object' && prop.type !== 'array') {
      const check = coerce(value, prop.type);
      if (!check.ok) { errors.push(`参数 "${key}": ${check.error}`); }
      else if (check.value !== value) { fixedArgs[key] = check.value; fixed = true; }
    }
  }
  return { valid: errors.length === 0, fixed, fixedArgs, errors, guidance: errors.length > 0 ? `工具调用参数有 ${errors.length} 个问题：${errors.join('；')}` : '' };
}

// === quality-gate.mjs ===
// Quality gate: snapshot → verify → rollback pipeline.
// === invariants ===
// - applyWithGuard() saves original, runs edit, verifies, rollbacks on failure
// - snapshot store is in-memory Map<filePath, {content, ts}>
// - runLint() calls npm run lint in project root, returns {pass, output}
// - runTests() calls npm test -- --findRelatedTests, returns {pass, output, failedTests[]}
// - restore() writes original content back
// - applyWithGuard passes through the editFn return value on success

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const _snapshots = new Map();
const PROJECT_ROOT = process.cwd();

export async function snapshot(filePath) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  const content = await fs.readFile(resolved, 'utf8');
  _snapshots.set(filePath, { content, ts: Date.now() });
  return { filePath, bytes: content.length };
}

export async function restore(filePath) {
  const snap = _snapshots.get(filePath);
  if (!snap) throw new Error(`No snapshot for ${filePath}`);
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  await fs.writeFile(resolved, snap.content, 'utf8');
  _snapshots.delete(filePath);
  return { filePath, restoredBytes: snap.content.length };
}

export function hasSnapshot(filePath) {
  return _snapshots.has(filePath);
}

export function runLint(cwd = PROJECT_ROOT) {
  try {
    const out = execSync('npm run lint 2>&1', { cwd, encoding: 'utf8', timeout: 30000, windowsHide: true });
    return { pass: true, output: out.trim() };
  } catch (e) {
    return { pass: false, output: (e.stdout || '').trim() || e.message };
  }
}

export function runTests(testPaths = [], cwd = PROJECT_ROOT) {
  try {
    const opt = testPaths.length ? ` -- ${testPaths.join(' ')}` : '';
    const out = execSync(`npm test${opt} 2>&1`, { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true });
    return { pass: true, output: out.trim(), failedTests: [] };
  } catch (e) {
    const output = (e.stdout || '').trim() || e.message;
    const failedTests = _extractFailedTests(output);
    return { pass: false, output, failedTests };
  }
}

// Apply edit with guard: snapshot → edit → verify → rollback on failure
export async function applyWithGuard(filePath, editFn, options = {}) {
  const { lint = true, test = false, testPaths = [] } = options;
  await snapshot(filePath);
  let editResult;
  try {
    editResult = await editFn();
  } catch (e) {
    await restore(filePath);
    return { pass: false, step: 'edit', error: e.message };
  }
  if (lint) {
    const lintResult = runLint();
    if (!lintResult.pass) {
      await restore(filePath);
      return { pass: false, step: 'lint', output: lintResult.output };
    }
  }
  if (test) {
    const testResult = runTests(testPaths);
    if (!testResult.pass) {
      await restore(filePath);
      return { pass: false, step: 'test', output: testResult.output, failedTests: testResult.failedTests };
    }
  }
  // All passed — keep change, clear snapshot
  _snapshots.delete(filePath);
  return { pass: true, ...editResult };
}

function _extractFailedTests(output) {
  const failed = [];
  const patterns = [
    /FAIL\s+(\S+)/g,
    /✗\s+(\S+)/g,
    /×\s+(\S+)/g,
    /●\s+(.+)/g,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(output)) !== null) failed.push(m[1]);
  }
  return [...new Set(failed)];
}

// === ast-adapters.mjs ===
// Multi-language AST adapters — unified query/replace interface
// === invariants ===
// - Dart: regex-based (no native parser available); covers classes/functions/imports/widget-build
// - JS: acorn-based full AST
// - Py/Rs/Go: regex-based for top-level symbols
// - All adapters return same shape: { language, parsed, symbols[], errors[] }

import { createRequire } from 'module';
const _require = createRequire(import.meta.url);


// ─── Dart adapter (Flutter-focused) ────────────────────────
export function parseDart(code) {
  const symbols = [];
  const errors = [];

  // imports
  for (const m of code.matchAll(/^import\s+['"]([^'"]+)['"]\s*(?:as\s+(\w+))?(?:\s+show\s+(.+?))?(?:\s+hide\s+(.+?))?\s*;/gm)) {
    symbols.push({ kind: 'import', name: m[2] || m[1].split('/').pop().split('.').shift() || m[1], path: m[1], alias: m[2] || null });
  }

  // exports
  for (const m of code.matchAll(/^export\s+['"]([^'"]+)['"]/gm)) {
    symbols.push({ kind: 'export', name: m[1].split('/').pop().split('.').shift(), path: m[1] });
  }

  // classes (with extends/mixin/implements)
  for (const m of code.matchAll(/^class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+with\s+([^{]+?))?(?:\s+implements\s+([^{]+?))?\s*\{/gm)) {
    symbols.push({
      kind: 'class', name: m[1], extends: m[2] || null,
      mixin: m[3]?.trim() || null, implements: m[4]?.trim() || null,
    });
  }

  // mixins
  for (const m of code.matchAll(/^mixin\s+(\w+)(?:\s+on\s+([^{]+?))?\s*\{/gm)) {
    symbols.push({ kind: 'mixin', name: m[1], on: m[2]?.trim() || null });
  }

  // enums
  for (const m of code.matchAll(/^enum\s+(\w+)\s*\{/gm)) {
    symbols.push({ kind: 'enum', name: m[1] });
  }

  // top-level functions and methods
  for (const m of code.matchAll(/^(?:(?:static\s+)?(Future|void|int|String|double|bool|List|Map|Set|dynamic|Widget|Stream|Never|num)\s+)?(\w+)\s*\(([^)]*)\)\s*(?:async\s*)?(?:\{)/gm)) {
    symbols.push({ kind: 'function', name: m[2], returnType: m[1] || 'dynamic', params: m[3] });
  }

  // top-level variables (with types)
  for (const m of code.matchAll(/^(?:(final|const|var|late|static)\s+)?([\w<>[\]]+)\s+(\w+)\s*=\s*/gm)) {
    if (m[3] !== 'required' && m[3] !== 'super') {
      symbols.push({ kind: 'variable', keyword: m[1] || 'var', type: m[2], name: m[3] });
    }
  }

  // Flutter-specific: build() method
  const hasBuild = /\bWidget\s+build\s*\(/.test(code) && /\bbuild\(/.test(code);
  if (hasBuild) symbols.push({ kind: 'flutter-build', name: 'build', recognized: true });

  return { language: 'dart', parsed: true, symbols, symbolCount: symbols.length, errors };
}

// ─── JS adapter (acorn-based) ──────────────────────────────
export function parseJS(code) {
  const symbols = [];
  let ast;
  try {
    const acorn = _require('acorn');
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    return { language: 'javascript', parsed: false, error: e.message };
  }
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    const t = node.type;
    if (t === 'FunctionDeclaration' && node.id) symbols.push({ kind: 'function', name: node.id.name });
    else if (t === 'ClassDeclaration' && node.id) symbols.push({ kind: 'class', name: node.id.name });
    else if (t === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (d.id?.name) symbols.push({ kind: 'variable', name: d.id.name, kind2: node.kind });
      }
    } else if (t === 'ExportNamedDeclaration' && node.declaration?.id) {
      symbols.push({ kind: 'export', name: node.declaration.id.name });
    } else if (t === 'ExportDefaultDeclaration' && node.declaration?.id) {
      symbols.push({ kind: 'export', name: node.declaration.id.name, default: true });
    } else if (t === 'ImportDeclaration') {
      for (const s of node.specifiers) {
        symbols.push({ kind: 'import', name: s.local?.name || s.imported?.name, source: node.source?.value });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const val = node[key];
      if (Array.isArray(val)) for (const v of val) walk(v);
      else if (val && typeof val.type === 'string') walk(val);
    }
  }
  walk(ast);
  return { language: 'javascript', parsed: true, symbols, symbolCount: symbols.length };
}

// ─── Python adapter (regex) ──────────────────────────────
export function parsePython(code) {
  const symbols = [];
  for (const m of code.matchAll(/^class\s+(\w+)\s*(?:\(([^)]*)\))?:/gm)) {
    symbols.push({ kind: 'class', name: m[1], bases: m[2] || null });
  }
  for (const m of code.matchAll(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\S[^:]*?))?\s*:/gm)) {
    symbols.push({ kind: 'function', name: m[1], params: m[2], returnType: m[3]?.trim() || null });
  }
  for (const m of code.matchAll(/^(\w+)\s*=\s*(?!=)/gm)) {
    if (!['if', 'elif', 'else', 'for', 'while', 'with', 'try', 'except', 'def', 'class', 'import', 'from', 'return', 'yield', 'raise', 'assert', 'pass', 'break', 'continue', 'self', 'cls', 'True', 'False', 'None'].includes(m[1])) {
      symbols.push({ kind: 'variable', name: m[1] });
    }
  }
  for (const m of code.matchAll(/^(?:from\s+(\S+)\s+)?import\s+(\S[^#\n]*)/gm)) {
    symbols.push({ kind: 'import', from: m[1] || null, names: m[2].split(',').map(s => s.trim().split(/\s+as\s+/).pop()) });
  }
  return { language: 'python', parsed: true, symbols, symbolCount: symbols.length };
}

// ─── Rust adapter (regex) ────────────────────────────────
export function parseRust(code) {
  const symbols = [];
  for (const m of code.matchAll(/^(?:pub\s+)?(?:unsafe\s+)?(?:async\s+)?fn\s+(\w+)(?:<([^>]*)>)?\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{/gm)) {
    symbols.push({ kind: 'function', name: m[1], generics: m[2] || null, params: m[3], returnType: m[4]?.trim() || null });
  }
  for (const m of code.matchAll(/^(?:pub\s+)?(struct|enum|trait|union)\s+(\w+)\s*(?:<([^>]*)>)?\s*(?:\{|;|\s*where)/gm)) {
    symbols.push({ kind: 'type', name: m[2], typeKind: m[1] });
  }
  for (const m of code.matchAll(/^use\s+(\S+)\s*(?:as\s+(\w+))?;/gm)) {
    symbols.push({ kind: 'use', path: m[1], alias: m[2] || null });
  }
  return { language: 'rust', parsed: true, symbols, symbolCount: symbols.length };
}

// ─── Go adapter (regex) ──────────────────────────────────
export function parseGo(code) {
  const symbols = [];
  for (const m of code.matchAll(/^func\s+(?:(?:\([^)]+\))\s+)?(\w+)\s*\(([^)]*)\)\s*(?:\(([^)]*)\)\s*)?\{/gm)) {
    symbols.push({ kind: 'function', name: m[1], params: m[2], returns: m[3]?.trim() || null });
  }
  for (const m of code.matchAll(/^type\s+(\w+)\s+(struct|interface|map\[\w+\]|\w+)/gm)) {
    symbols.push({ kind: 'type', name: m[1], typeKind: m[2] });
  }
  for (const m of code.matchAll(/^(?:var|const)\s+(\w+)\s+/gm)) {
    symbols.push({ kind: 'variable', name: m[1] });
  }
  for (const m of code.matchAll(/^import\s+\(([\s\S]*?)\)/gm)) {
    const items = m[1].split('\n').map(l => l.trim().replace(/"/g, '')).filter(Boolean);
    for (const item of items) symbols.push({ kind: 'import', path: item });
  }
  return { language: 'go', parsed: true, symbols, symbolCount: symbols.length };
}

// ─── Unified API ──────────────────────────────────────────
export function parse(language, code) {
  switch (language) {
    case 'dart': case 'flutter': return parseDart(code);
    case 'js': case 'javascript': case 'mjs': case 'cjs': return parseJS(code);
    case 'py': case 'python': return parsePython(code);
    case 'rs': case 'rust': return parseRust(code);
    case 'go': return parseGo(code);
    default: return { language, parsed: false, error: `unsupported: ${language}` };
  }
}

export async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const langMap = { '.dart': 'dart', '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'js', '.ts': 'js', '.tsx': 'js', '.py': 'python', '.rs': 'rust', '.go': 'go' };
  const lang = langMap[ext];
  if (!lang) return { file: filePath, error: `unsupported extension: ${ext}` };
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) return { file: filePath, error: 'path traversal' };
  try {
    const code = await fs.readFile(resolved, 'utf8');
    const result = parse(lang, code);
    result.file = filePath;
    return result;
  } catch (e) {
    return { file: filePath, error: e.message };
  }
}

export const TOOLS = [
  { type: 'function', function: { name: 'lang_parse', description: 'Parse source code AST for any supported language: dart, js, python, rust, go', parameters: { type: 'object', properties: { language: { type: 'string' }, code: { type: 'string' } }, required: ['language', 'code'] } } },
  { type: 'function', function: { name: 'lang_parse_file', description: 'Parse a source file by path (extension determines language)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
];

export async function executeTool(name, args) {
  switch (name) {
    case 'lang_parse': return parse(args.language, args.code);
    case 'lang_parse_file': return parseFile(args.path);
    default: throw new Error(`Unknown ast-adapter tool: ${name}`);
  }
}

// === ast-search.mjs ===
// AST-level code search — symbol index + find references + rename
// === invariants ===
// - JS parsing via acorn (no TypeScript — ts files analyzed as JS, TS-specific syntax skipped)
// - Symbol index: functions, classes, variables, exports
// - findReferences: AST-aware (excludes comments, strings)

import * as acorn from 'acorn';

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



// === code-search.mjs ===
// === invariants ===
// - grepSearch uses ripgrep (rg) when available, falls back to Node.js recursive grep
// - findReferences only parses JS/TS import/export syntax via regex (no full AST)
// - All paths are relative to PROJECT_ROOT; path traversal denied

function safeResolve(filePath) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
  return resolved;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function hasRipgrep() {
  try { execSync('rg --version', { stdio: 'ignore' }); return true; } catch { return false; }
}

export async function grepSearch(query, options = {}) {
  const root = options.rootDir ? safeResolve(options.rootDir) : PROJECT_ROOT;
  const include = options.include || '';
  const exclude = options.exclude || '';
  const maxResults = options.maxResults || 200;
  const results = [];

  if (hasRipgrep()) {
    const args = ['--line-number', '--with-filename', '--color', 'never', '-m', '1', '-g', `!node_modules`];
    if (include) args.push('-g', include);
    if (exclude) args.push('-g', `!${exclude}`);
    args.push('--', query, root);
    const stdout = execSync(`rg ${args.join(' ')}`, { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (let i = 0; i < Math.min(lines.length, maxResults); i++) {
      const [file, lineNum, ...rest] = lines[i].split(':');
      results.push({ file: path.relative(PROJECT_ROOT, path.resolve(file)), line: parseInt(lineNum, 10), content: rest.join(':').trim() });
    }
  } else {
    async function walk(dir) {
      if (results.length >= maxResults) return;
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) {
          if (include && !entry.name.match(new RegExp(include.replace(/\*/g, '.*')))) continue;
          try {
            const content = await fs.readFile(full, 'utf8');
            const lines = content.split('\n');
            for (let l = 0; l < lines.length && results.length < maxResults; l++) {
              if (lines[l].includes(query)) results.push({ file: path.relative(PROJECT_ROOT, full), line: l + 1, content: lines[l].trim() });
            }
          } catch { /* skip unreadable */ }
        }
      }
    }
    await walk(root);
  }
  return results;
}

export async function findReferences(symbol, options = {}) {
  const root = options.rootDir ? safeResolve(options.rootDir) : PROJECT_ROOT;
  const maxResults = options.maxResults || 100;
  const definitions = [];
  const usages = [];

  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && /\.(js|mjs|cjs|ts|jsx|tsx)$/i.test(entry.name)) {
        try {
          const content = await fs.readFile(full, 'utf8');
          const lines = content.split('\n');
          for (let l = 0; l < lines.length; l++) {
            const line = lines[l];
            const relPath = path.relative(PROJECT_ROOT, full);

            // Export detection
            if (new RegExp(`(export\\s+(default\\s+)?(function|class|const|let|var|interface|type)\\s+)?${symbol}\\b`).test(line)) {
              definitions.push({ file: relPath, line: l + 1, content: line.trim(), kind: 'definition' });
            }

            // Import detection
            if (new RegExp(`(import|require)\\s*[\\s\\S]*?['"\`]${symbol}['"\`]|from\\s+['"\`].*${symbol}`).test(line)) {
              definitions.push({ file: relPath, line: l + 1, content: line.trim(), kind: 'import' });
            }

            // Usage (not def/import)
            if (line.includes(symbol) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
              const isDef = definitions.some(d => d.file === relPath && d.line === l + 1);
              if (!isDef) usages.push({ file: relPath, line: l + 1, content: line.trim() });
            }

            if (definitions.length + usages.length >= maxResults * 2) return;
          }
        } catch { /* skip */ }
      }
    }
  }

  await walk(root);
  return { definitions: definitions.slice(0, maxResults), usages: usages.slice(0, maxResults) };
}



// === dev-tools.mjs ===
// Dev tools: 依赖图 / Git / 测试 / Lint / 构建 / 语言 / Docker / SQL / API / 安全 / 性能 / 文档 / CI / 环境
// === invariants ===
// - All tools are thin wrappers: parse stdin, call CLI, return structured output
// - Path traversal denied on all file-based ops
// - Tools prefixed by category for clarity

// === Step 2: 依赖图分析 ===
export async function depGraph(rootDir = '.') {
  const root = safeResolve(rootDir);
  const graph = { nodes: new Set(), edges: [] };
  async function walk(dir) {
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (/\.(js|mjs|cjs|ts|jsx|tsx)$/i.test(e.name)) {
        const rel = path.relative(PROJECT_ROOT, full); graph.nodes.add(rel);
        try {
          const content = await fs.readFile(full, 'utf8');
          for (const m of content.matchAll(/(?:from\s+['"])([^'"]+)(?:['"])|(?:require\s*\(\s*['"])([^'"]+)(?:['"]\s*\))/g)) {
            const target = m[1] || m[2];
            if (target && !target.startsWith('.')) graph.edges.push({ from: rel, to: target, type: 'external' });
          }
        } catch (e) { console.error('[C0]', e); }
      }
    }
  }
  await walk(root);
  return { nodes: [...graph.nodes], edges: graph.edges, nodeCount: graph.nodes.size, edgeCount: graph.edges.length };
}

export async function detectCycles(rootDir = '.') {
  const { nodes, edges } = await depGraph(rootDir);
  const adj = {}; for (const e of edges) { if (e.type !== 'external') { (adj[e.from] = adj[e.from] || []).push(e.to); } }
  const visited = new Set(), stack = new Set(), cycles = [];
  function dfs(n, p) {
    visited.add(n); stack.add(n);
    for (const nb of (adj[n] || [])) {
      if (!visited.has(nb)) { if (dfs(nb, [...p, n])) return true; }
      else if (stack.has(nb)) { cycles.push([...p.slice(p.indexOf(nb)), nb]); return true; }
    }
    stack.delete(n); return false;
  }
  for (const n of nodes) if (!visited.has(n)) dfs(n, []);
  return { cycles, cycleCount: cycles.length };
}

// === Step 3: 架构可视化 ===
export function toMermaid(edges) {
  const lines = ['graph TD;'];
  for (const e of edges) lines.push(`  ${e.from.replace(/[^a-zA-Z0-9]/g, '_')} --> ${e.to.replace(/[^a-zA-Z0-9]/g, '_')};`);
  return lines.join('\n');
}

// === Step 4: Git 工作流 ===
export function gitCommit(diffContext) {
  const status = run('git diff --stat');
  if (!status.trim()) return { message: 'No changes to commit' };
  const diff = run('git diff');
  const msg = `auto: ${diffContext || status.split('\n')[0] || 'update'}`;
  run(`git add -A && git commit -m "${msg.replace(/"/g, '\\"')}"`);
  return { message: msg, files: status.trim().split('\n').filter(Boolean) };
}

export function gitLog(count = 10) { return { log: run(`git log --oneline -${count}`).trim().split('\n').filter(Boolean) }; }

// === Step 5: 测试调度 ===
async function findTestFiles(rootDir) {
  const results = [];
  async function walk(dir) {
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (/\.test\.(js|mjs)$/i.test(e.name)) results.push(path.relative(PROJECT_ROOT, full));
    }
  }
  await walk(safeResolve(rootDir));
  return results;
}

export async function testRun(globPattern = 'src') {
  const files = await findTestFiles(globPattern);
  if (files.length === 0) return { passed: 0, failed: 0, files: [] };
  const results = [];
  for (const f of files) {
    try { const out = run(`npx node --test ${f}`, { stdio: ['pipe', 'pipe', 'pipe'] }); results.push({ file: f, passed: !out.includes('fail'), output: out.slice(0, 500) }); } 
    catch (e) { results.push({ file: f, passed: false, output: (e.stdout || e.message).slice(0, 500) }); }
  }
  return { passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, files: results };
}

export async function testDiscover(rootDir = '.') {
  const files = await findTestFiles(rootDir);
  return { testFiles: files, count: files.length };
}

// === Step 6: Lint 集成 ===
export function lintRun(globPattern = 'src/**/*.{js,mjs}') {
  const out = run(`npx eslint ${globPattern} --format json 2>&1 || true`);
  let results; try { results = JSON.parse(out); } catch { return { error: out.slice(0, 500) }; }
  const errors = results.filter(r => r.errorCount > 0);
  return { totalFiles: results.length, filesWithErrors: errors.length, details: errors.map(r => ({ file: r.filePath, errors: r.messages.map(m => ({ line: m.line, message: m.message })) })) };
}

export function lintFix(globPattern = 'src/**/*.{js,mjs}') {
  const out = run(`npx eslint ${globPattern} --fix 2>&1 || true`);
  return { output: out.slice(0, 500) };
}

// === Step 7: 构建管道 ===
export function buildRun(command = 'npm run build') {
  const start = Date.now();
  const out = run(command);
  return { duration: Date.now() - start, output: out.slice(0, 1000), success: !out.includes('ERR!') && !out.includes('FAIL') };
}

// === Step 8: JS/TS 深度支持 ===
export function tsTypeCheck(globPattern = 'src/**/*.ts') {
  const out = run(`npx tsc --noEmit 2>&1 || true`);
  const errors = out.split('\n').filter(l => l.includes('error TS'));
  return { errors: errors.slice(0, 50), errorCount: errors.length };
}

// === Step 9: 多语言适配器 ===
export function langRun(language, command) {
  const runners = { python: 'python3', py: 'python3', go: 'go run', rs: 'cargo run', rust: 'cargo run' };
  const runner = runners[language] || language;
  const out = run(`${runner} ${command} 2>&1 || true`);
  return { output: out.slice(0, 1000) };
}

// === Step 10: Docker/K8s ===
export function dockerBuild(tag = 'latest', dockerfile = '.') {
  return { output: run(`docker build -t ${tag} ${dockerfile} 2>&1 || true`).slice(0, 500) };
}

// === Step 11: SQL 工具 ===
export function sqlParseCreate(sql) {
  const tables = [];
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(\w+)\s*\(([\s\S]*?)\)\s*;/gi)) {
    const cols = m[2].split(',').map(c => c.trim()).filter(Boolean).map(c => { const p = c.trim().split(/\s+/); return { name: p[0], type: p[1] }; });
    tables.push({ name: m[1], columns: cols });
  }
  return { tables, tableCount: tables.length };
}

// === Step 12: API 调试 ===
export async function curlRun(method = 'GET', url, body) {
  try { const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); return { output: text.slice(0, 1000), status: r.status }; }
  catch (e) { return { error: e.message, output: '' }; }
}

// === Step 13: 安全审计 ===
export function secNpmAudit() {
  const out = run('npm audit --json 2>&1 || true');
  try { const j = JSON.parse(out); return { vulnerabilities: j.vulnerabilities || {}, total: Object.keys(j.vulnerabilities || {}).length }; } 
  catch { return { error: out.slice(0, 500) }; }
}

// === Step 14: 性能分析 ===
export function perfMeasure(fn) {
  const start = performance.now();
  fn();
  const elapsed = performance.now() - start;
  return { elapsedMs: elapsed };
}

// === Step 15: 文档同步 ===
export function docsFindChanged() {
  const diff = run('git diff --name-only').trim().split('\n').filter(Boolean);
  const docs = diff.filter(f => /\.(md|rst|txt)$/i.test(f) || f.includes('docs/') || f.includes('README'));
  const code = diff.filter(f => /\.(js|mjs|ts|py|rs|go)$/i.test(f));
  return { diffFiles: diff, docsChanged: docs.length > 0, suggestUpdate: code.filter(f => !docs.includes(f)).map(f => ({ file: f, reason: 'code changed but no docs updated' })) };
}

// === Step 16: CI 配置生成 ===
export function ciDetect() {
  const has = { node: true };
  const eslintExists = fs.access(path.join(PROJECT_ROOT, '.eslintrc.json')).then(() => true).catch(() => false);
  const prettierExists = fs.access(path.join(PROJECT_ROOT, '.prettierrc')).then(() => true).catch(() => false);
  const workflows = [];
  if (has.node) workflows.push({ name: 'Node.js CI', steps: ['checkout', 'setup-node', 'npm ci', 'npm test'] });
  return { detected: has, suggestedWorkflows: workflows };
}

// === Step 17: 环境管理 ===
export function envDiff(envA = {}, envB = {}) {
  const keys = new Set([...Object.keys(envA), ...Object.keys(envB)]);
  const diff = [];
  for (const k of keys) {
    if (envA[k] !== envB[k]) diff.push({ key: k, from: envA[k], to: envB[k] || '(missing)', type: envB[k] === undefined ? 'removed' : envA[k] === undefined ? 'added' : 'changed' });
  }
  return { diff, hasChanges: diff.length > 0 };
}



// === diff-review.mjs ===
// Diff review — shows a diff and asks for user approval before finalizing changes.
// === invariants ===
// - diffReview() computes git diff for staged/unstaged changes
// - confirmDiff() asks user via stdin for y/n — interactive only
// - For non-interactive (chat), returns diff text for LLM to present

export function getGitDiff(cwd = process.cwd()) {
  try {
    const diff = execSync('git diff 2>&1', { cwd, encoding: 'utf8', timeout: 5000, windowsHide: true });
    const staged = execSync('git diff --cached 2>&1', { cwd, encoding: 'utf8', timeout: 5000, windowsHide: true });
    const output = [];
    if (staged.trim()) output.push('=== Staged ===\n' + staged);
    if (diff.trim()) output.push('=== Unstaged ===\n' + diff);
    return output.join('\n') || '(no changes)';
  } catch {
    return '(not a git repo or git unavailable)';
  }
}


export async function confirmDiff(diffText, promptText = 'Apply these changes? (Y/n): ') {
  if (!diffText || diffText === '(no changes)' || diffText.startsWith('(not a git repo')) {
    return true;
  }
  const rl = await import('readline').then(m => m.createInterface({ input: process.stdin, output: process.stdout }));
  return new Promise(resolve => {
    rl.question(`\n${diffText}\n\n${promptText}`, answer => {
      rl.close();
      resolve(answer.toLowerCase() !== 'n');
    });
  });
}

export function revertChanges(cwd = process.cwd()) {
  try {
    execSync('git checkout -- . 2>&1', { cwd, encoding: 'utf8', timeout: 10000, windowsHide: true });
    return { reverted: true };
  } catch (e) {
    return { reverted: false, error: e.message };
  }
}

// === edit-quality-gate.mjs ===
// === edit-quality-gate.mjs ===
// dev-repl 改文件后自动跑 lint (opencode quality-gate 风格, 失败不阻塞但告警)
//
// 触发: dev-repl 检测到工具调用是 edit_file/write_file/multi_edit/ast_edit 后
//   异步调 checkEditedFile(filePath), 失败结果写入 history 让 LLM 下轮看到
//
// 故意不阻塞: opencode 行为是"提示 + 让 agent 自己修", dev-repl 同
//   - 优点: REPL 响应快, agent 看到 lint 错可主动修
//   - 缺点: 可能漏掉, 但 history 兜底
//
// I/O (compose 契约, 供实验 10 dev-aux 测试):
//   { op: 'check', filePath } → { ok, errors, warnings, summary }
//   { op: 'isEditTool', toolName } → boolean
//
// === invariants ===
// - 永不抛 — 错误降级为 { ok:false, errors:[], summary:'lint runner unavailable' }
// - 只对 .js/.mjs/.ts/.jsx/.tsx 跑 lint, 其他扩展名直接 ok:true
// - 默认 8s 超时, 不阻塞 REPL 主循环
// - 不写盘, 不修改文件 (lintRun 只读)


const EDIT_TOOLS = new Set(['edit_file', 'write_file', 'multi_edit', 'ast_edit', 'editFile', 'writeFile', 'hashEdit']);
const LINT_EXTS = /\.(js|mjs|cjs|ts|jsx|tsx)$/i;
const LINT_TIMEOUT = 8000;

export function isEditTool(toolName) {
  return EDIT_TOOLS.has(toolName);
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

export async function checkEditedFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, errors: [], warnings: [], summary: 'invalid filePath' };
  }
  if (!LINT_EXTS.test(filePath)) {
    return { ok: true, errors: [], warnings: [], summary: 'skip (非 JS/TS 扩展名)' };
  }
  try {
    const result = await withTimeout(
      Promise.resolve(lintRun(filePath)),
      LINT_TIMEOUT
    );
    if (!result || typeof result !== 'object') {
      return { ok: true, errors: [], warnings: [], summary: 'lint 空结果' };
    }
    const errors = Array.isArray(result.errors) ? result.errors : [];
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const ok = errors.length === 0;
    const summary = ok
      ? `✓ ${filePath} lint 通过`
      : `✗ ${filePath} lint 失败 (${errors.length} errors${warnings.length ? `, ${warnings.length} warnings` : ''})`;
    return { ok, errors, warnings, summary, totalFiles: result.totalFiles };
  } catch (e) {
    return { ok: false, errors: [], warnings: [], summary: `lint 异常: ${e.message?.slice(0, 80)}` };
  }
}

export async function run({ inputs = {} } = {}) {
  const { op, filePath, toolName } = inputs;
  if (!op) throw new Error('edit-quality-gate.run: op required');
  if (op === 'check') return { outputs: await checkEditedFile(filePath) };
  if (op === 'isEditTool') return { outputs: { isEdit: isEditTool(toolName) } };
  throw new Error(`edit-quality-gate.run: unknown op "${op}"`);
}

export const META = { id: 'edit-quality-gate' };

// === multi-edit.mjs ===
// Multi-file edit — apply the same search/replace across multiple files matched by glob.
// === invariants ===
// - Uses built-in fs + minimatch-style pattern matching (no external deps)
// - Each file is edited via coding-tools' editFile with quality gate
// - Skips files where search string is not found (reports as skipped)
// - All results returned in a single batch



// Simple glob matching: * matches anything except /, ** matches everything
function matchGlob(filePath, pattern) {
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '☯')
    .replace(/\*/g, '[^/]*')
    .replace(/☯/g, '.*');
  return new RegExp('^' + regexStr + '$').test(filePath.replace(/\\/g, '/'));
}

async function findFiles(dir, pattern, results = [], rootDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isDirectory()) {
      await findFiles(fullPath, pattern, results, rootDir);
    } else if (entry.isFile() && matchGlob(relPath, pattern)) {
      results.push(relPath);
    }
  }
  return results;
}

export async function multiEdit(globPattern, search, newStr, options = {}) {
  const { force = false } = options;

  const files = await findFiles(PROJECT_ROOT, globPattern);
  if (files.length === 0) {
    return { edited: 0, skipped: 0, errors: 0, files: [], message: `No files matched "${globPattern}"` };
  }

  const { editFile, readFile } = await import('./coding-tools.mjs');
  const results = [];
  let editedCount = 0, skippedCount = 0, errorCount = 0;

  for (const f of files) {
    try {
      const content = await readFile(f);
      if (!content.includes(search)) {
        results.push({ file: f, status: 'skipped', reason: 'search not found' });
        skippedCount++;
        continue;
      }
      const r = await editFile(f, search, newStr, { force, lint: !force });
      results.push({ file: f, status: 'edited', oldBytes: r.oldBytes, newBytes: r.newBytes });
      editedCount++;
    } catch (e) {
      results.push({ file: f, status: 'error', error: e.message });
      errorCount++;
    }
  }

  return {
    edited: editedCount,
    skipped: skippedCount,
    errors: errorCount,
    files: results,
  };
}

// Unified dispatch for dev.mjs tool loop

// === project-context.mjs ===
// Project context: dependency & structure analysis for LLM.
// === invariants ===
// - findRelatedFiles(filePath) scans imports/exports and finds connected files
// - findDependencies(filePath) lists direct imports + their resolution
// - getProjectStructure(root) returns directory tree up to 3 levels
// - Only reads files, never modifies

import { existsSync } from 'fs';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt']);

export async function findRelatedFiles(filePath) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  const dir = path.dirname(resolved);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  // Find files with same base name but different extensions
  const related = [];
  try {
    const entries = await fs.readdir(dir);
    for (const e of entries) {
      const fullPath = path.join(dir, e);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      const eBase = path.basename(e, path.extname(e));
      if (eBase === base && e !== path.basename(filePath)) related.push(e);
      // spec/test files for this module
      if ((eBase === `${base}.spec` || eBase === `${base}.test`) && !related.includes(e)) related.push(e);
    }
  } catch (e) { console.error('[C0]', e); }
  return related.map(f => path.join(path.dirname(filePath), f).replace(/\\/g, '/'));
}

export async function findDependencies(filePath) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  let content;
  try { content = await fs.readFile(resolved, 'utf8'); }
  catch { return []; }

  const imports = [];
  const importRegex = /import\s+(?:\{[^}]*\}\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRegex.exec(content)) !== null) {
    imports.push({ specifier: m[1], resolved: _resolveImport(m[1], filePath) });
  }
  // Also scan dynamic import()
  const dynamicRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynamicRegex.exec(content)) !== null) {
    if (!imports.find(i => i.specifier === m[1])) {
      imports.push({ specifier: m[1], resolved: _resolveImport(m[1], filePath) });
    }
  }
  // CommonJS require (ESM-compatible)
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRegex.exec(content)) !== null) {
    if (!imports.find(i => i.specifier === m[1])) {
      imports.push({ specifier: m[1], resolved: _resolveImport(m[1], filePath, true) });
    }
  }
  return imports;
}

export async function getProjectStructure(root = PROJECT_ROOT, maxDepth = 3) {
  const result = [];
  await _walkDir(root, root, 0, maxDepth, result);
  return result;
}

function _resolveImport(specifier, fromFile, isRequire = false) {
  if (specifier.startsWith('.')) {
    const dir = path.dirname(path.resolve(PROJECT_ROOT, fromFile));
    const resolved = path.resolve(dir, specifier);
    // Try common extensions
    for (const ext of ['.mjs', '.js', '.cjs', '.ts', '.mts', '']) {
      const p = resolved + ext;
      if (existsSync(p)) return path.relative(PROJECT_ROOT, p).replace(/\\/g, '/');
    }
    // Try index files
    for (const ext of ['/index.mjs', '/index.js', '/index.cjs', '/index.ts']) {
      const p = resolved + ext;
      if (existsSync(p)) return path.relative(PROJECT_ROOT, p).replace(/\\/g, '/');
    }
    return null; // unresolved
  }
  // Package import (node_modules or workspace)
  return `node_modules/${specifier}`;
}

async function _walkDir(root, dir, depth, maxDepth, result) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }

  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (e.isDirectory()) {
      result.push({ type: 'dir', path: rel });
      await _walkDir(root, full, depth + 1, maxDepth, result);
    } else if (e.isFile() && /\.(mjs|js|cjs|ts|mts|dart)$/i.test(e.name)) {
      result.push({ type: 'file', path: rel });
    }
  }
}

// === tools-deep.mjs ===
// v2 deep tools: Git / Test / Multi-language AST
// === invariants ===
// - Git tools parse diff/conflict markers, don't run interactive commands
// - Test tools run files in parallel with Promise.all
// - Multi-language adapters: JS via acorn, others via regex fallback

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
// === Step 19: Git 深度集成 ===
export function gitBranch() {
  const current = run('git branch --show-current');
  const all = run('git branch').split('\n').map(b => b.trim());
  return { current, branches: all };
}

export function gitMerge(targetBranch, sourceBranch = 'HEAD') {
  const dryRun = run(`git merge --no-commit --no-ff ${sourceBranch} 2>&1 || true`);
  const hasConflict = dryRun.includes('CONFLICT') || dryRun.includes('Merge conflict');
  let conflict = null;
  if (hasConflict) {
    const files = run('git diff --name-only --diff-filter=U').split('\n').filter(Boolean);
      conflict = { files: files.slice(0, 20), markers: files.map(f => { try { const c = readFileSync(path.resolve(PROJECT_ROOT, f), 'utf8'); return { file: f, conflictCount: (c.match(/<<<<<<< /g) || []).length }; } catch { return { file: f, conflictCount: 0 }; } }) };
    run('git merge --abort');
  }
  return { dryRun: !hasConflict, hasConflict, conflict, target: targetBranch, source: sourceBranch };
}

export function gitRebase(onto) {
  const out = run(`git rebase --onto ${onto} 2>&1 || true`);
  return { success: !out.includes('CONFLICT'), output: out.slice(0, 500) };
}

export function gitApplyPatch(patchContent) {
  writeFileSync(path.join(PROJECT_ROOT, '_tmp.patch'), patchContent);
  const out = run('git apply --check _tmp.patch 2>&1 || true');
  unlinkSync(path.join(PROJECT_ROOT, '_tmp.patch'));
  const ok = !out.includes('error');
  if (ok) run('git apply _tmp.patch');
  return { applies: ok, error: ok ? null : out.slice(0, 300) };
}

// === Step 20: 测试深度 ===
export async function testParallel(pattern = 'src/**/*.test.{js,mjs}') {
  const { globSync } = await import('glob');
  const files = globSync(pattern, { ignore: 'node_modules/**' });
  if (files.length === 0) return { passed: 0, failed: 0, total: 0 };
  const results = await Promise.all(files.map(async (f) => {
    try { const out = execSync(`npx node --test ${f} 2>&1 || true`, { encoding: 'utf8', maxBuffer: 1024 * 1024 }); return { file: f, passed: !out.includes('fail'), output: out.slice(0, 300) }; }
    catch { return { file: f, passed: false, output: 'error' }; }
  }));
  return { passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, total: results.length, results };
}

export async function testCoverage(pattern = 'src/**/*.test.{js,mjs}') {
  const out = run(`npx c8 --reporter=text node --test ${pattern} 2>&1 || true`);
  return { output: out.slice(0, 2000) };
}

export async function testFlakyDetect(pattern, runs = 3) {
  const files = (await import('glob')).globSync(pattern || 'src/**/*.test.{js,mjs}', { ignore: 'node_modules/**' });
  const results = [];
  for (const f of files) {
    const outcomes = [];
    for (let i = 0; i < runs; i++) {
      const out = execSync(`npx node --test ${f} 2>&1 || true`, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      outcomes.push(!out.includes('fail'));
    }
    const passCount = outcomes.filter(Boolean).length;
    if (passCount < runs && passCount > 0) results.push({ file: f, flaky: true, passRate: `${passCount}/${runs}` });
  }
  return { flakyTests: results, totalFlaky: results.length, runs };
}

// === Step 21: 多语言 AST 适配器 ===
export function langASTParse(language, code) {
  switch (language) {
    case 'js': case 'javascript': case 'mjs': {
      try {
        const acorn = _require('acorn');
        const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
        return { parsed: true, nodeCount: countNodes(ast), topLevel: ast.body.map(n => ({ type: n.type, name: (n.declaration?.id?.name || n.id?.name || null) })) };
      } catch (e) { return { parsed: false, error: e.message }; }
    }
    case 'py': case 'python': {
      const imports = [...code.matchAll(/^(?:from\s+(\S+)\s+)?import\s+(\S+)/gm)].map(m => ({ from: m[1] || null, name: m[2] }));
      const funcs = [...code.matchAll(/^def\s+(\w+)\s*\(/gm)].map(m => ({ name: m[1] }));
      const classes = [...code.matchAll(/^class\s+(\w+)/gm)].map(m => ({ name: m[1] }));
      return { parsed: true, language: 'python', imports, functions: funcs, classes };
    }
    case 'rs': case 'rust': {
      const funcs = [...code.matchAll(/^fn\s+(\w+)/gm)].map(m => ({ name: m[1] }));
      const structs = [...code.matchAll(/^struct\s+(\w+)/gm)].map(m => ({ name: m[1] }));
      const uses = [...code.matchAll(/^use\s+(\S+)/gm)].map(m => ({ path: m[1] }));
      return { parsed: true, language: 'rust', functions: funcs, structs, uses };
    }
    case 'go': {
      const funcs = [...code.matchAll(/^func\s+(\w+)/gm)].map(m => ({ name: m[1] }));
      const imports = [...code.matchAll(/^import\s+"(\S+)"|import\s+\(([\s\S]*?)\)/gm)].flatMap(m => {
        if (m[2]) return m[2].split('\n').map(l => l.trim().replace(/"/g, '')).filter(Boolean).map(f => ({ name: f }));
        return [{ name: m[1] }];
      });
      return { parsed: true, language: 'go', functions: funcs, imports };
    }
    default: return { parsed: false, error: `unsupported language: ${language}` };
  }
}

function countNodes(node) {
  if (!node || typeof node !== 'object') return 0;
  let count = 1;
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const val = node[key];
    if (Array.isArray(val)) for (const v of val) count += countNodes(v);
    else if (val && typeof val.type === 'string') count += countNodes(val);
  }
  return count;
}



// === output-compressor.mjs ===
// CLI output compressor — rtk-inspired token saving.
// === invariants ===
// - compressOutput(cmd, stdout, stderr) returns { stdout, stderr, meta }
// - MAX_DEFAULT_LINES: 50 lines, beyond that → truncate with head/tail
// - Known commands get specialized compression (git, ls, test runners, linters)
// - Error output is never compressed (except dedup)
// - Meta includes original/originalBytes/compressedBytes/ratio
// - Line dedup removes consecutive duplicate lines only

const MAX_DEFAULT_LINES = 50;
const MAX_LINE_LENGTH = 500;
const TAIL_LINES = 10;

export function compressOutput(cmd, stdout, stderr) {
  const origBytes = (stdout + stderr).length;
  const meta = { origBytes, compressedBytes: 0, ratio: 1, strategy: 'none' };

  // Error output: never truncate, just dedup
  const stderrClean = _dedupLines(stderr);

  const cmdBase = (cmd || '').trim().split(/\s+/)[0]?.toLowerCase();
  const strategy = _getStrategy(cmdBase, stdout);

  let stdoutClean = stdout;
  switch (strategy) {
    case 'git_status':
      stdoutClean = _compressGitStatus(stdout);
      break;
    case 'git_diff':
      stdoutClean = _compressGitDiff(stdout);
      break;
    case 'ls':
      stdoutClean = _compressLs(stdout);
      break;
    case 'test':
      stdoutClean = _compressTestOutput(stdout);
      break;
    case 'linter':
      stdoutClean = _compressLinter(stdout);
      break;
    case 'truncate':
      stdoutClean = _truncateOutput(stdout);
      break;
    default:
      stdoutClean = _dedupLines(stdout);
  }

  // Cap line length
  stdoutClean = _capLineLength(stdoutClean);
  const compressed = (stdoutClean + stderrClean).length;
  meta.compressedBytes = compressed;
  meta.ratio = origBytes > 0 ? +(compressed / origBytes).toFixed(3) : 1;
  meta.strategy = strategy;

  return { stdout: stdoutClean, stderr: stderrClean, meta };
}

function _getStrategy(cmd, stdout) {
  if (!stdout || stdout.length < 100) return 'none';
  if (cmd === 'git' && stdout.includes('diff --git')) return 'git_diff';
  if (cmd === 'git' && (stdout.includes('On branch') || stdout.includes('nothing to commit'))) return 'git_status';
  if (cmd === 'ls' || cmd === 'dir') return 'ls';
  if (/^(pytest|jest|vitest|mocha|ava)$/.test(cmd)) return 'test';
  if (/^(eslint|ruff|golangci-lint|tsc)$/.test(cmd)) return 'linter';
  const lines = stdout.split('\n');
  if (lines.length > MAX_DEFAULT_LINES) return 'truncate';
  return 'none';
}

function _compressGitStatus(out) {
  // Compact: remove "Changes not staged for commit:" style headers, keep file list
  const lines = out.split('\n').filter(l => {
    const t = l.trim();
    if (!t) return false;
    if (t.endsWith(':') && !t.startsWith('\t')) return false;
    return true;
  });
  return lines.join('\n');
}

function _compressGitDiff(out) {
  // Keep: diff --git, ---/+++ headers, @@ hunks, actual changes
  // Drop: index lines, new file mode, etc.
  const lines = out.split('\n').filter(l => {
    if (l.startsWith('index ')) return false;
    if (l.startsWith('new file mode')) return false;
    if (l.startsWith('deleted file mode')) return false;
    if (l.startsWith('similarity index')) return false;
    if (l.startsWith('rename from')) return false;
    if (l.startsWith('rename to')) return false;
    return true;
  });
  return lines.join('\n');
}

function _compressLs(out) {
  // Keep only filenames, one per line; drop permissions/size/date
  const lines = out.split('\n').filter(l => {
    const t = l.trim();
    if (!t) return false;
    // Mode line like "total 123"
    if (/^total\s+\d+$/.test(t)) return false;
    // Detailed listing (permissions start with - or d)
    if (/^[-dlpsbc][-rwxstL]{9}/.test(t)) return true; // keep
    return true;
  });
  return lines.join('\n');
}

function _compressTestOutput(out) {
  // Keep: FAIL/ERROR lines, summary line, drop PASS lines
  const lines = out.split('\n');
  const important = lines.filter(l => {
    const u = l.toUpperCase();
    if (u.includes('FAIL') || u.includes('ERROR') || u.includes('✗') || u.includes('×')) return true;
    if (u.includes('PASS') || u.includes('✓') || u.includes('√')) return false;
    if (u.includes('TESTS:') || u.includes('SUITE') || u.includes('TEST')) return true;
    return false;
  });
  if (important.length === 0) return _truncateOutput(out);
  return important.join('\n');
}

function _compressLinter(out) {
  // Group by rule (like rtk): drop per-file details, keep rule-level summary
  const lines = out.split('\n');
  const grouped = {};
  for (const l of lines) {
    // Match: "filename:line:col: warning/error rule-id message"
    const m = l.match(/(\S+\.\w+):(\d+):(\d+):\s+(warning|error)\s+(\S+)\s+(.*)/);
    if (m) {
      const rule = m[5];
      if (!grouped[rule]) grouped[rule] = { count: 0, files: new Set() };
      grouped[rule].count++;
      grouped[rule].files.add(m[1]);
    }
  }
  if (Object.keys(grouped).length === 0) return _truncateOutput(out);
  const result = Object.entries(grouped).map(([rule, info]) =>
    `${rule}: ${info.count} occurrences in ${info.files.size} files`
  );
  return result.join('\n');
}

function _truncateOutput(out) {
  const lines = out.split('\n');
  if (lines.length <= MAX_DEFAULT_LINES) return out;
  const head = lines.slice(0, MAX_DEFAULT_LINES - TAIL_LINES);
  const tail = lines.slice(-TAIL_LINES);
  return [...head, `... [${lines.length - MAX_DEFAULT_LINES} lines truncated]`, ...tail].join('\n');
}

function _dedupLines(out) {
  const lines = out.split('\n');
  const deduped = [];
  let last = '';
  for (const l of lines) {
    if (l !== last) deduped.push(l);
    last = l;
  }
  return deduped.join('\n');
}

function _capLineLength(out) {
  return out.split('\n').map(l => l.length > MAX_LINE_LENGTH ? l.substring(0, MAX_LINE_LENGTH) + '...' : l).join('\n');
}

export { compressOutput as default };

// === auto-commit.mjs ===
// Auto commit: git stage + commit with generated message.
// === invariants ===
// - autoCommit(filePaths) stages files, generates message from git diff, commits
// - commitMessage() calls `git diff --cached` to generate descriptive message
// - Falls back to "feat: auto-commit" if diff is empty
// - commitFormat: "type(scope): description"
// - Only works inside a git repo

export function hasGitRepo(cwd = PROJECT_ROOT) {
  try {
    execSync('git rev-parse --git-dir', { cwd, encoding: 'utf8', windowsHide: true });
    return true;
  } catch { return false; }
}

export function gitAdd(filePaths, cwd = PROJECT_ROOT) {
  const files = Array.isArray(filePaths) ? filePaths.join(' ') : filePaths;
  execSync(`git add ${files}`, { cwd, encoding: 'utf8', windowsHide: true });
  return { staged: filePaths };
}

export function gitDiff(cwd = PROJECT_ROOT) {
  try {
    const diff = execSync('git diff --cached', { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true });
    return diff.trim();
  } catch { return ''; }
}

export function generateMessage(diff, cwd = PROJECT_ROOT) {
  if (!diff) return 'chore: auto-commit';
  // Parse diff for type/scope hints
  const lines = diff.split('\n');
  const addedFiles = lines.filter(l => l.startsWith('+') && l.includes('import') && !l.startsWith('+++'));
  const changedFiles = lines.filter(l => l.startsWith('diff --git')).length;
  const isNewFile = lines.some(l => l.startsWith('new file mode'));

  // Determine type
  let type = 'feat';
  if (lines.some(l => l.includes('fix') || l.includes('bug') || l.includes('error'))) type = 'fix';
  if (lines.some(l => l.includes('refactor') || l.includes('rename') || l.includes('move'))) type = 'refactor';
  if (lines.some(l => l.includes('docs') || l.includes('README') || l.includes('.md'))) type = 'docs';
  if (lines.some(l => l.includes('test') || l.includes('.spec.') || l.includes('.test.'))) type = 'test';
  if (lines.some(l => l.includes('chore') || l.includes('config') || l.includes('.json'))) type = 'chore';

  // Determine scope from first changed file
  const diffHeader = lines.find(l => l.startsWith('diff --git'));
  let scope = '';
  if (diffHeader) {
    const file = diffHeader.replace('diff --git a/', '').replace(' b/', '/');
    scope = file.split('/')[0];
  }

  // Description from the most meaningful line
  const descLines = lines.filter(l =>
    (l.startsWith('+') && !l.startsWith('+++') && l.length > 5 && l.length < 80) ||
    (l.startsWith('-') && !l.startsWith('---') && l.length > 5 && l.length < 80)
  ).slice(0, 5);
  const description = descLines[0]?.replace(/^[+-]\s*/, '').substring(0, 50) || 'update';

  const scopePart = scope ? `(${scope})` : '';
  return `${type}${scopePart}: ${description.substring(0, 60)}`;
}

export async function autoCommit(filePaths, cwd = PROJECT_ROOT) {
  if (!hasGitRepo(cwd)) return { committed: false, error: 'Not a git repository' };
  gitAdd(filePaths, cwd);
  const diff = gitDiff(cwd);
  const message = generateMessage(diff, cwd);
  try {
    execSync(`git commit -m "${message}"`, { cwd, encoding: 'utf8', windowsHide: true });
    return { committed: true, message, files: Array.isArray(filePaths) ? filePaths : [filePaths] };
  } catch (e) {
    return { committed: false, error: e.message, message };
  }
}

// === system-exec.mjs ===
// System command execution tool for LLM agent.
// === invariants ===
// - ALLOWED_COMMANDS: whitelist of safe executables (prefix match)
// - BLOCKED_PATTERNS: regex patterns that will reject a command outright
// - timeout defaults to 10s, max output 100KB
// - execCommand() returns { stdout, stderr, exitCode }
// - TOOLS array follows OpenAI function-calling schema
// - Never executes if cmd fails safety check (throws)

const ALLOWED_COMMANDS = ['ls', 'cat', 'echo', 'node', 'npm', 'git', 'pwd', 'dir', 'type', 'whoami', 'date', 'find', 'grep', 'head', 'tail', 'wc', 'cmd'];
const BLOCKED_PATTERNS = [/\brm\b/, /\bdel\b/, /\bformat\b/, /\bsudo\b/, /\bshutdown\b/, /\breboot\b/, /\bhalt\b/, /\bpoweroff\b/, /\bmv\b/, /\bcp\b/, /\bchmod\b/, /\bchown\b/, /\bmkfs\b/, /\bdd\b/, /\b>|>>|\||;&\${/];
const MAX_OUTPUT = 100 * 1024;
const DEFAULT_TIMEOUT = 10000;
const EXEC_OPTS = { timeout: DEFAULT_TIMEOUT, maxBuffer: MAX_OUTPUT, windowsHide: true, encoding: 'utf8' };

export function isSafeCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  const trimmed = cmd.trim();
  if (!trimmed) return false;
  // Blacklist check
  for (const p of BLOCKED_PATTERNS) {
    if (p.test(trimmed)) return false;
  }
  // Whitelist: first word must be an allowed command
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  return ALLOWED_COMMANDS.includes(firstWord);
}

export function execCommand(cmd, timeout, compress = false) {
  if (!isSafeCommand(cmd)) {
    throw new Error(`Command rejected by safety check: "${cmd.substring(0, 60)}"`);
  }
  const opts = { ...EXEC_OPTS };
  if (timeout) opts.timeout = timeout;
  try {
    const raw = execSync(cmd, opts).toString().trim();
    const result = { stdout: raw, stderr: '', exitCode: 0 };
    if (compress) {
      const c = compressOutput(cmd, raw, '');
      result.stdout = c.stdout;
      result._compression = c.meta;
    }
    return result;
  } catch (e) {
    const result = {
      stdout: (e.stdout || '').toString().trim(),
      stderr: (e.stderr || '').toString().trim(),
      exitCode: e.status !== null ? e.status : 1,
    };
    if (compress) {
      const c = compressOutput(cmd, result.stdout, result.stderr);
      result.stdout = c.stdout;
      result.stderr = c.stderr;
      result._compression = c.meta;
    }
    return result;
  }
}

// OpenAI function-calling schema

// Execute tool by name, return result as string (with compression for LLM)

// === ast-edit.mjs ===
// AST edit — syntax-aware editing for JS/JSX files using acorn.
// === invariants ===
// - Only works for .js/.jsx/.mjs files (falls back to error for other types)
// - Uses acorn to parse, walks AST to find target node by selector
// - Edits source by replacing at AST position — no codegen needed
// - Selectors: function:{name}, class:{name}, const:{name}, let:{name}, var:{name}
// - edit: rename, replace_body (replace function body)


const JS_EXT = /\.(js|jsx|mjs|cjs)$/;

// Simple AST walker (no acorn-walk dependency)
function walkFind(node, test) {
  if (!node || typeof node !== 'object') return null;
  if (test(node)) return node;
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = walkFind(item, test);
        if (found) return found;
      }
    } else if (child && typeof child.type === 'string') {
      const found = walkFind(child, test);
      if (found) return found;
    }
  }
  return null;
}

function parseSelector(selector) {
  const colonIdx = selector.indexOf(':');
  if (colonIdx === -1) return { type: 'all', name: selector };
  return { type: selector.substring(0, colonIdx), name: selector.substring(colonIdx + 1) };
}

function buildTest(parsed) {
  return (node) => {
    if (parsed.type === 'all') return true;
    if (parsed.type === 'function') {
      return (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')
        && node.id?.name === parsed.name;
    }
    if (parsed.type === 'class') {
      return node.type === 'ClassDeclaration' && node.id?.name === parsed.name;
    }
    if (['const', 'let', 'var'].includes(parsed.type)) {
      return node.type === 'VariableDeclaration'
        && node.declarations?.some(d => d.id?.name === parsed.name);
    }
    return false;
  };
}

export async function astEdit(filePath, selector, action, newValue) {
  if (!JS_EXT.test(filePath)) {
    throw new Error(`AST edit only supports .js/.jsx/.mjs/.cjs files, got: ${filePath}`);
  }

  const acorn = await import('acorn');
  const content = await readFile(filePath);
  const parsed = parseSelector(selector);

  let ast;
  try {
    ast = acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true });
  } catch (e) {
    throw new Error(`Parse error in ${filePath}: ${e.message}`);
  }

  const test = buildTest(parsed);
  const node = walkFind(ast, test);
  if (!node) {
    throw new Error(`No node matching selector "${selector}" found in ${filePath}`);
  }

  let result;
  if (action === 'rename') {
    if (!node.id) throw new Error('Node has no identifier to rename');
    const start = node.id.start;
    const end = node.id.end;
    result = content.substring(0, start) + newValue + content.substring(end);
  } else if (action === 'replace_body') {
    // Find the body node
    const body = node.body || (node.expression?.type === 'ArrowFunctionExpression' ? node.expression.body : null);
    if (!body) throw new Error('Node has no body to replace');
    // For block bodies, replace inside the braces
    if (body.type === 'BlockStatement') {
      result = content.substring(0, body.start + 1) + '\n' + newValue + '\n' + content.substring(body.end - 1);
    } else {
      result = content.substring(0, body.start) + newValue + content.substring(body.end);
    }
  } else {
    throw new Error(`Unknown action: "${action}". Supported: rename, replace_body`);
  }

  await writeFile(filePath, result);
  const oldBytes = content.length;
  return { path: filePath, action, selector, oldBytes, newBytes: result.length };
}

// Unified dispatch for dev.mjs tool loop

// === mcp-server.mjs ===

const TOOL_LIST = TOOLS.map(t => ({
  name: t.function.name,
  description: t.function.description || '',
  inputSchema: t.function.parameters || { type: 'object', properties: {} },
}));

export class McpServer {
  constructor() {
    this._closed = false;
    this._reqId = 0;
  }

  async handle(line) {
    if (this._closed) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return this._send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
    if (!msg || typeof msg !== 'object') return;
    const { id, method, params } = msg;

    try {
      switch (method) {
        case 'initialize':
          return this._send({ id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'openchat-mcp', version: '0.1.0' } } });
        case 'tools/list':
          return this._send({ id, result: { tools: TOOL_LIST } });
        case 'tools/call': {
          if (!params?.name) return this._send({ id, error: { code: -32602, message: 'Missing tool name' } });
          const args = params.arguments || {};
          try {
            const raw = await executeTool(params.name, args);
            const content = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
            return this._send({ id, result: { content: [{ type: 'text', text: content }] } });
          } catch (e) {
            return this._send({ id, error: { code: -32603, message: e.message?.slice(0, 200) || 'Tool execution failed' } });
          }
        }
        case 'resources/list':
          return this._send({ id, result: { resources: [] } });
        case 'resources/read':
          return this._send({ id, error: { code: -32601, message: 'Not implemented' } });
        case 'notifications/initialized':
          return;
        default:
          return this._send({ id, error: { code: -32601, message: `Unknown method: ${method}` } });
      }
    } catch (e) {
      return this._send({ id, error: { code: -32603, message: e.message?.slice(0, 200) || 'Internal error' } });
    }
  }

  _send(msg) {
    if (this._closed) return;
    process.stdout.write(JSON.stringify(msg) + '\n');
  }

  close() { this._closed = true; }
}

export function startStdioServer() {
  const server = new McpServer();
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) server.handle(trimmed);
    }
  });
  process.stdin.on('end', () => server.close());
  return server;
}

// === coding-tools.mjs ===
// Coding tools for LLM software development agent.
// === invariants ===
// - readFile(path): returns file content as string
// - writeFile(path, content): writes content to file
// - editFile(path, edits): apply multiple search/replace edits with quality gate
// - hashEdit(content, search, replace): hashline-style edit with anchor hash
// - TOOLS: OpenAI function-calling schema array
// - All file ops relative to project root (F:\openchat)
// - editFile validates that search string exists uniquely before replacing
// - editFile runs lint after edit by default, returns {pass, step?, ...editResult}
// - use force=true on edit_file to skip quality gate

// memory-tools.mjs removed: dead code

/** 单行 8 字符 md5 hash (lowercase) — hashline 编辑的锚点 */
function hashlineHash(line) {
  return crypto.createHash('md5').update(line).digest('hex').substring(0, 8);
}

export async function readFile(filePath, allowExternal) {
  if (allowExternal) {
    const resolved = path.resolve(filePath);
    const content = await fs.readFile(resolved, 'utf8');
    return content;
  }
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
  const content = await fs.readFile(resolved, 'utf8');
  return content;
}

export async function writeFile(filePath, content, opts = {}) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
  await fs.mkdir(path.dirname(resolved), { recursive: true });

  // ─── 写文件护栏 (L1.5 教训: DeepSeek V3 4x 重复覆盖 slash-commands.mjs) ───
  let existed = false;
  let origSize = 0;
  let backupPath = null;
  try {
    const stat = await fs.stat(resolved);
    existed = true;
    origSize = stat.size;
  } catch { /* new file, no backup needed */ }

  if (existed) {
    // 1. 自动备份 (给用户后悔的机会)
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = filePath.replace(/[\\/]/g, '__');
    const backupDir = path.join(PROJECT_ROOT, '.openchat', 'backups', 'write_file');
    await fs.mkdir(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `${safeName}.${ts}`);
    await fs.copyFile(resolved, backupPath);

    // 2. 收缩检测: 新内容 < 原 30% 视为疑似破坏, 拒绝 (除非 force=true 或 dry-run 显式确认)
    if (!opts.force && content.length < origSize * 0.3) {
      throw new Error(
        `write_file guardrail: ${filePath} shrunk ${origSize} → ${content.length} bytes ` +
        `(${(100 * content.length / origSize).toFixed(1)}%). ` +
        `If intentional, pass force=true. Backup: ${backupPath}`
      );
    }

    // 3. 提示: 改文件优先用 edit_file (diff 可见, 出错可逆)
    console.debug(`[write_file] ${filePath} exists (${origSize} bytes) — consider edit_file for partial changes. Backup: ${backupPath}`);
  }

  // 4. Dry-run 模式: OPENCHAT_WRITE_DRYRUN=1 时只打印, 不写
  if (process.env.OPENCHAT_WRITE_DRYRUN === '1') {
    console.debug(`[write_file DRY-RUN] would write ${content.length} bytes to ${filePath}${backupPath ? ` (backup: ${backupPath})` : ''}`);
    return { path: filePath, bytes: content.length, dryRun: true, backup: backupPath };
  }

  await fs.writeFile(resolved, content, 'utf8');
  return { path: filePath, bytes: content.length, backup: backupPath };
}

// Internal raw edit (no quality gate)
async function _editFileRaw(filePath, search, newStr) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
  const content = await fs.readFile(resolved, 'utf8');
  const idx = content.indexOf(search);
  if (idx === -1) throw new Error(`Search string not found in ${filePath}`);
  const nextIdx = content.indexOf(search, idx + 1);
  if (nextIdx !== -1) throw new Error(`Search string appears ${(content.match(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length} times — not unique`);
  const result = content.substring(0, idx) + newStr + content.substring(idx + search.length);
  await fs.writeFile(resolved, result, 'utf8');
  return { path: filePath, oldBytes: content.length, newBytes: result.length };
}

// Public edit with quality gate by default. Use force=true to skip quality gate.
export async function editFile(filePath, search, newStr, options = {}) {
  const { force = false, lint = true, test = false } = options;
  if (force) {
    return _editFileRaw(filePath, search, newStr);
  }
  const result = await applyWithGuard(filePath,
    () => _editFileRaw(filePath, search, newStr),
    { lint, test },
  );
  if (!result.pass) throw new Error(`Edit failed at ${result.step}: ${result.output || result.error}`);
  return result;
}

// Hashline-style edit: locate anchor by content hash
export async function hashEdit(filePath, hash, newContent) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
  const fullContent = await fs.readFile(resolved, 'utf8');
  const lines = fullContent.split('\n');
  const targetHash = hash.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    if (hashlineHash(lines[i]) === targetHash) {
      lines[i] = newContent;
      const result = lines.join('\n');
      await fs.writeFile(resolved, result, 'utf8');
      return { path: filePath, line: i, oldLine: lines.length, newLine: lines.length };
    }
  }
  throw new Error(`Hash anchor ${hash} not found in ${filePath}`);
}


export async function getDNAContext() {
  try {
    const { getDNAContext: ctx } = await import('../42.mjs');
    return await ctx();
  } catch { return ''; }
}


