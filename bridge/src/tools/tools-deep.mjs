// v2 deep tools: Git / Test / Multi-language AST
// === invariants ===
// - Git tools parse diff/conflict markers, don't run interactive commands
// - Test tools run files in parallel with Promise.all
// - Multi-language adapters: JS via acorn, others via regex fallback

import fs from 'fs/promises';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);

const PROJECT_ROOT = process.cwd();
function run(cmd, opts = {}) {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim(); }
  catch (e) { return (e.stdout || '').trim() || e.message; }
}

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

export const TOOLS = [
  { type: 'function', function: { name: 'git_branch', description: 'List branches and show current', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'git_merge_dry', description: 'Dry-run merge to check for conflicts', parameters: { type: 'object', properties: { targetBranch: { type: 'string' }, source: { type: 'string', default: 'HEAD' } }, required: ['targetBranch'] } } },
  { type: 'function', function: { name: 'git_apply_patch', description: 'Apply a patch string (dry-run check first)', parameters: { type: 'object', properties: { patch: { type: 'string' } }, required: ['patch'] } } },
  { type: 'function', function: { name: 'test_parallel', description: 'Run test files in parallel', parameters: { type: 'object', properties: { pattern: { type: 'string', default: 'src' } } } } },
  { type: 'function', function: { name: 'test_flaky', description: 'Detect flaky tests by running N times', parameters: { type: 'object', properties: { pattern: { type: 'string' }, runs: { type: 'number', default: 3 } } } } },
  { type: 'function', function: { name: 'lang_ast_parse', description: 'Parse code AST for any supported language (js/py/rs/go)', parameters: { type: 'object', properties: { language: { type: 'string' }, code: { type: 'string' } }, required: ['language', 'code'] } } },
];

export async function executeTool(name, args) {
  switch (name) {
    case 'git_branch': return gitBranch();
    case 'git_merge_dry': return gitMerge(args.targetBranch, args.source);
    case 'git_apply_patch': return gitApplyPatch(args.patch);
    case 'test_parallel': return testParallel(args.pattern);
    case 'test_flaky': return testFlakyDetect(args.pattern, args.runs || 3);
    case 'lang_ast_parse': return langASTParse(args.language, args.code);
    default: throw new Error(`Unknown deep tool: ${name}`);
  }
}
