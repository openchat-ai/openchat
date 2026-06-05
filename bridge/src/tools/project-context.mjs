// Project context: dependency & structure analysis for LLM.
// === invariants ===
// - findRelatedFiles(filePath) scans imports/exports and finds connected files
// - findDependencies(filePath) lists direct imports + their resolution
// - getProjectStructure(root) returns directory tree up to 3 levels
// - Only reads files, never modifies

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
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
  } catch {}
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
