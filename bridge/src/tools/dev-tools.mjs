// Dev tools: 依赖图 / Git / 测试 / Lint / 构建 / 语言 / Docker / SQL / API / 安全 / 性能 / 文档 / CI / 环境
// === invariants ===
// - All tools are thin wrappers: parse stdin, call CLI, return structured output
// - Path traversal denied on all file-based ops
// - Tools prefixed by category for clarity

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

const PROJECT_ROOT = process.cwd();

function safeResolve(p) { const r = path.resolve(PROJECT_ROOT, p); if (!r.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied'); return r; }
function run(cmd, opts = {}) { try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...opts }); } catch (e) { return e.stdout || e.message; } }

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
        } catch {}
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

export const TOOLS = [
  { type: 'function', function: { name: 'dep_graph', description: 'Analyze JS/TS file dependency graph (imports/exports)', parameters: { type: 'object', properties: { rootDir: { type: 'string' } } } } },
  { type: 'function', function: { name: 'detect_cycles', description: 'Detect circular dependencies in JS/TS project', parameters: { type: 'object', properties: { rootDir: { type: 'string' } } } } },
  { type: 'function', function: { name: 'to_mermaid', description: 'Convert dependency edges to Mermaid graph format', parameters: { type: 'object', properties: { edges: { type: 'array', items: { type: 'object' } } }, required: ['edges'] } } },
  { type: 'function', function: { name: 'git_commit', description: 'Git add + commit with auto message', parameters: { type: 'object', properties: { context: { type: 'string' } } } } },
  { type: 'function', function: { name: 'git_log', description: 'Show recent git log', parameters: { type: 'object', properties: { count: { type: 'number' } } } } },
  { type: 'function', function: { name: 'test_run', description: 'Discover and run test files', parameters: { type: 'object', properties: { pattern: { type: 'string' } } } } },
  { type: 'function', function: { name: 'test_discover', description: 'Discover test files without running', parameters: { type: 'object', properties: { rootDir: { type: 'string' } } } } },
  { type: 'function', function: { name: 'lint_run', description: 'Run ESLint and return errors', parameters: { type: 'object', properties: { pattern: { type: 'string' } } } } },
  { type: 'function', function: { name: 'lint_fix', description: 'Run ESLint --fix', parameters: { type: 'object', properties: { pattern: { type: 'string' } } } } },
  { type: 'function', function: { name: 'build_run', description: 'Run build command and return output', parameters: { type: 'object', properties: { command: { type: 'string' } } } } },
  { type: 'function', function: { name: 'ts_typecheck', description: 'Run TypeScript type check (tsc --noEmit)', parameters: { type: 'object', properties: { pattern: { type: 'string' } } } } },
  { type: 'function', function: { name: 'lang_run', description: 'Run code in specified language (python/go/rust)', parameters: { type: 'object', properties: { language: { type: 'string' }, command: { type: 'string' } }, required: ['language', 'command'] } } },
  { type: 'function', function: { name: 'docker_build', description: 'Build Docker image', parameters: { type: 'object', properties: { tag: { type: 'string' }, dockerfile: { type: 'string' } } } } },
  { type: 'function', function: { name: 'sql_parse', description: 'Parse CREATE TABLE SQL into structured schema', parameters: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } } },
  { type: 'function', function: { name: 'curl_run', description: 'Execute HTTP request via curl', parameters: { type: 'object', properties: { method: { type: 'string' }, url: { type: 'string' }, body: { type: 'object' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'sec_audit', description: 'Run npm audit for vulnerability scan', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'docs_suggest', description: 'Find changed files that may need docs update', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'ci_detect', description: 'Detect project type and suggest CI workflow', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'env_diff', description: 'Compare two env objects and list differences', parameters: { type: 'object', properties: { a: { type: 'object' }, b: { type: 'object' } }, required: ['a', 'b'] } } },
];

export async function executeTool(name, args) {
  switch (name) {
    case 'dep_graph': return depGraph(args.rootDir);
    case 'detect_cycles': return detectCycles(args.rootDir);
    case 'to_mermaid': return toMermaid(args.edges);
    case 'git_commit': return gitCommit(args.context);
    case 'git_log': return gitLog(args.count);
    case 'test_run': return testRun(args.pattern);
    case 'test_discover': return testDiscover(args.rootDir);
    case 'lint_run': return lintRun(args.pattern);
    case 'lint_fix': return lintFix(args.pattern);
    case 'build_run': return buildRun(args.command);
    case 'ts_typecheck': return tsTypeCheck(args.pattern);
    case 'lang_run': return langRun(args.language, args.command);
    case 'docker_build': return dockerBuild(args.tag, args.dockerfile);
    case 'sql_parse': return sqlParseCreate(args.sql);
    case 'curl_run': return curlRun(args.method, args.url, args.body);
    case 'sec_audit': return secNpmAudit();
    case 'docs_suggest': return docsFindChanged();
    case 'ci_detect': return ciDetect();
    case 'env_diff': return envDiff(args.a, args.b);
    default: throw new Error(`Unknown dev tool: ${name}`);
  }
}
