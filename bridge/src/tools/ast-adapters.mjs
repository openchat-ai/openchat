// Multi-language AST adapters — unified query/replace interface
// === invariants ===
// - Dart: regex-based (no native parser available); covers classes/functions/imports/widget-build
// - JS: acorn-based full AST
// - Py/Rs/Go: regex-based for top-level symbols
// - All adapters return same shape: { language, parsed, symbols[], errors[] }

import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);

const PROJECT_ROOT = process.cwd();

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
  for (const m of code.matchAll(/^(?:pub\s+)?(?:unsafe\s+)?(?:async\s+)?fn\s+(\w+)\s*<([^>]*)>?\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{/gm)) {
    symbols.push({ kind: 'function', name: m[1], generics: m[2] || null, params: m[3], returnType: m[4]?.trim() || null });
  }
  for (const m of code.matchAll(/^(?:pub\s+)?(?:struct|enum|trait|union)\s+(\w+)\s*(?:<([^>]*)>)?\s*(?:\{|;|\s*where)/gm)) {
    symbols.push({ kind: m[1] ? 'type' : 'unknown', name: m[1], typeKind: RegExp.lastMatch?.includes('struct') ? 'struct' : RegExp.lastMatch?.includes('enum') ? 'enum' : 'trait' });
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
