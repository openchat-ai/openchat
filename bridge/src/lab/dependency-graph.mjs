// dependency-graph.mjs — 静态扫 imports, 构建 file → [importers] 映射
//
// 用途: 改一个 .mjs 文件, 立刻知道哪些 experiment 会受影响
//
// 数据流:
//   1. 扫 src/experiments/*.mjs + src/lab/*.mjs (后续可加 src/api/*)
//   2. 每个 .mjs 找静态 import 路径 (regex: `from '...'`, `import '...'`, `await import('...')`)
//   3. 跳过相对路径解析 (./foo 跟当前文件同目录, 算同一文件; 跨目录的 ./lib/agent-hooks.mjs 也算)
//   4. 跳过 node_modules (e.g. 'express', 'fs')
//   5. 跳过 dynamic require() 字符串
//
// 输出: {
//   files: { 'src/lab/goal-queue.mjs': { importers: ['src/experiments/22.mjs', 'src/lab/runner.mjs'] } },
//   experiments: { 'src/experiments/22.mjs': { imports: ['src/lab/goal-queue.mjs', ...] } },
// }
//
// 限制:
//   - 只看直接 import (不递归 transitive) — A 改了, 看 A 的 importer, 不算 importer 的 importer
//   - 只看 .mjs / .js, 不看 .ts / .dart / .py
//   - dynamic import() 算静态 (因为是字面量)
//   - 缓存: 进程内只 build 一次, 后续调 getGraph 拿缓存

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';

// === invariants ===
// - 扫 src/experiments/ + src/lab/ 下的 .mjs (可加 dirs 参数扩展)
// - 路径全部 normalize 到 repo 相对路径 (以 repo root 为基准)
// - import 解析: 相对路径 → join; 绝对 / 包名 → 跳过
// - 缓存: 进程内 buildGraph 一次
// - 不递归 transitive: A → B → C, A 改了只告 B 的 importer, 不算 C

let _cache = null;

export function buildGraph(repoRoot, opts = {}) {
  if (_cache) return _cache;
  // 默认扫 src/experiments/ + src/lab/ (bridge 在子目录时也找得到)
  // 自动探测: 有 bridge/ 就用 bridge/src/, 没有就用 src/
  const dirs = opts.dirs || _detectDirs(repoRoot);
  const files = {};
  const experiments = {};
  for (const dir of dirs) {
    const absDir = join(repoRoot, dir);
    if (!existsSync(absDir)) continue;
    for (const f of _walkMjs(absDir)) {
      const rel = _toRepoRel(repoRoot, f);
      const imports = _scanImports(f, repoRoot);
      experiments[rel] = { imports };
      for (const imp of imports) {
        if (!files[imp]) files[imp] = { importers: [] };
        if (!files[imp].importers.includes(rel)) files[imp].importers.push(rel);
      }
    }
  }
  _cache = { files, experiments, builtAt: Date.now(), dirs };
  return _cache;
}

function _detectDirs(repoRoot) {
  // 优先 bridge/src/* (子目录结构), 退回 src/* (扁平)
  if (existsSync(join(repoRoot, 'bridge/src/experiments'))) {
    return ['bridge/src/experiments', 'bridge/src/lab'];
  }
  return ['src/experiments', 'src/lab'];
}

export function getGraph() {
  return _cache || buildGraph(_detectRepoRoot());
}

export function resetCache() {
  _cache = null;
}

export function getAffectedExperiments(changedFiles) {
  const g = getGraph();
  const affected = new Set();
  for (const f of changedFiles) {
    const norm = _normalize(f);
    // exact match — 文件是 lab/* 改, 找 importer
    if (g.files[norm]) {
      for (const imp of g.files[norm].importers) {
        if (imp.includes('/src/experiments/')) affected.add(imp);
      }
    }
    // forward match — 改的本身是 experiment, 它自己也算
    if (norm.includes('/src/experiments/') && g.experiments[norm]) {
      affected.add(norm);
    }
  }
  return [...affected].sort();
}

export function getFileDependents(file) {
  const g = getGraph();
  const norm = _normalize(file);
  return g.files[norm]?.importers || [];
}

// === helpers ===

function _walkMjs(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(..._walkMjs(p));
    else if (e.endsWith('.mjs') || e.endsWith('.js')) out.push(p);
  }
  return out;
}

function _scanImports(file, repoRoot) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const fileDir = dirname(file);
  const imports = new Set();

  // from '...'
  const fromRe = /\bfrom\s+['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(fromRe)) _tryAdd(m[1]);

  // import '...' (side-effect)
  const seRe = /\bimport\s+['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(seRe)) _tryAdd(m[1]);

  // await import('...') / import('...') (字面量动态)
  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of text.matchAll(dynRe)) _tryAdd(m[1]);

  function _tryAdd(spec) {
    if (spec.startsWith('.') || spec.startsWith('/')) {
      // 相对 / 绝对路径
      const abs = resolve(fileDir, spec);
      if (existsSync(abs) || existsSync(abs + '.mjs') || existsSync(abs + '.js') || existsSync(abs + '/index.mjs')) {
        // 解析 .mjs / .js 后缀
        let resolved = abs;
        if (!existsSync(resolved) && existsSync(resolved + '.mjs')) resolved += '.mjs';
        else if (!existsSync(resolved) && existsSync(resolved + '.js')) resolved += '.js';
        else if (!existsSync(resolved) && existsSync(resolved + '/index.mjs')) resolved += '/index.mjs';
        imports.add(_toRepoRel(repoRoot, resolved));
      }
    }
    // 包名 / 绝对路径包: 跳过
  }
  return [...imports];
}

function _toRepoRel(repoRoot, abs) {
  return relative(repoRoot, abs).replace(/\\/g, '/');
}

function _normalize(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function _detectRepoRoot() {
  // 走 cwd 上找到 .git
  let cur = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(cur, '.git'))) return cur;
    cur = dirname(cur);
  }
  return process.cwd();
}
