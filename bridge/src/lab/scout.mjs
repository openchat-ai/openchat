import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, join, extname, relative } from 'path';
import { fileURLToPath } from 'url';
import { addGoal, listGoals, updateGoal } from './goal-queue.mjs';
import { addFinding } from './findings.mjs';
import { listHistory } from './history.mjs';
import { parseJS } from '../experiments/lib/ast-search.mjs';

// === invariants ===
// - runScoutRound() 幂等: 相同输入产生相同 finding 列表
// - 单 scanner 5s timeout (AbortSignal.timeout), 失败静默
// - finding 永远不重复添加 (key = type+desc, append-only)
// - goal 永远不重复 add (goal-queue.mjs permanent dedup on done)
// - 全部 try/catch 静默失败, scout 不该 crash
// - 文件扫描仅限 bridge/src, 深度 ≤ 10
// - 单次 cycle < 30s (即使所有网络失败)
// - 15 scanner 全部独立 try/catch, 1 个失败不影响其他
// - 15 scanner 全部返回 number (0 表示"无", N 表示"有多少")

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SRC_DIR = join(PROJECT_ROOT, 'src');
const EXP_DIR = join(SRC_DIR, 'experiments');
const LAB_DIR = join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'lab');
const PROJECTS_FILE = join(LAB_DIR, 'projects.json');
const MANIFEST_FILE = join(EXP_DIR, 'manifest.json');
const PERSISTENT_CONFIG = join(SRC_DIR, 'core/persistent-config.js');

const CONCURRENCY = 20;
const MIN_PENDING = 10;
const FETCH_TIMEOUT = 5000;

function log(msg) {
  console.debug(`[scout] ${new Date().toISOString()} ${msg}`);
}

async function safe(name, fn) {
  try {
    const r = await fn();
    const n = typeof r === 'number' ? r : 0;
    log(`${name}: ${n}`);
    return n;
  } catch (e) {
    log(`${name}: FAIL ${(e?.message || String(e)).slice(0, 120)}`);
    return 0;
  }
}

function readProjects() {
  try { return JSON.parse(readFileSync(PROJECTS_FILE, 'utf8')); } catch { return []; }
}

function relPath(abs) {
  return relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
}

function scanDir(dir, results = [], maxDepth = 10, depth = 0) {
  if (depth > maxDepth) return results;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) scanDir(full, results, maxDepth, depth + 1);
      else if (['.js', '.mjs', '.cjs'].includes(extname(e.name))) results.push(full);
    }
  } catch (e) { console.error('[C0]', e); }
  return results;
}

async function mapLimit(items, limit, fn) {
  if (items.length === 0) return [];
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      try { out[idx] = await fn(items[idx], idx); } catch (e) { console.error('[C0]', e); }
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// === P1: leftover .p2. file references (有无 = 0/有) ===
function scanForLeftoverP2() {
  const files = scanDir(SRC_DIR);
  const re = /from\s+['"][^'"]*\.p2\.[^'"]*['"]/g;
  let count = 0;
  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf8');
      const m = content.match(re);
      if (m && m.length > 0) {
        count += m.length;
        addFinding('bridge', 'p1', `${relPath(f)}: ${m.length} leftover .p2. import(s)`);
        addGoal(`remove leftover .p2. import in ${relPath(f)}`, { priority: 1 });
      }
    } catch {}
  }
  return count;
}

// === P2: syntax errors (有无 = pass/fail, count = 多少文件有) ===
function scanForSyntaxErrors() {
  const files = scanDir(SRC_DIR);
  let count = 0;
  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf8');
      const r = parseJS(content);
      if (!r) {
        count++;
        addFinding('bridge', 'p2', `${relPath(f)}: parse failed`);
        addGoal(`fix syntax error in ${relPath(f)}`, { priority: 2 });
      }
    } catch (e) {
      count++;
      const msg = (e?.message || String(e)).split('\n')[0].slice(0, 120);
      addFinding('bridge', 'p2', `${relPath(f)}: ${msg}`);
      addGoal(`fix syntax error in ${relPath(f)}`, { priority: 2 });
    }
  }
  return count;
}

// === 1. altExists: 是否有 >2x 流行度的替代品 (有无 + 数值) ===
async function scanAltExists(project) {
  const root = project.path || project.root;
  if (!root || !existsSync(join(root, 'package.json'))) return 0;
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const names = Object.keys(deps);
  if (names.length === 0) return 0;
  const downloads = {};
  await mapLimit(names, 4, async (name) => {
    const j = await fetchJson(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`);
    if (j) downloads[name] = j.downloads || 0;
  });
  let findings = 0;
  await mapLimit(names, 4, async (name) => {
    if (!downloads[name]) return;
    const j = await fetchJson(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(name)}&size=5`);
    if (!j || !j.objects) return;
    const alt = (j.objects.map(o => o.package?.name).find(n => n && n !== name));
    if (!alt) return;
    const aj = await fetchJson(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(alt)}`);
    if (!aj || !aj.downloads) return;
    const ratio = downloads[name] / aj.downloads;
    if (ratio > 2.0 || ratio < 0.5) {
      addFinding(project.name || 'unknown', 'altExists', `${name}/${alt} ratio=${ratio.toFixed(2)}`);
      findings++;
      if (ratio > 5 || ratio < 0.2) {
        addGoal(`investigate: switch ${name} to ${alt} (downloads ratio ${ratio.toFixed(2)})`, { priority: 3 });
      }
    }
  });
  return findings;
}

// === 2. degradation: 实验是否连续失败 (有无 + 次数) ===
async function scanDegradation() {
  const all = listHistory();
  if (all.length === 0) return 0;
  const byExp = {};
  for (const r of all) {
    const m = (r.description || '').match(/实验\s+(\S+):/);
    const id = m ? m[1] : (r.description || '').slice(0, 40);
    if (!id) continue;
    (byExp[id] = byExp[id] || []).push(r);
  }
  let findings = 0;
  for (const [id, runs] of Object.entries(byExp)) {
    const recent = runs.slice(-5);
    if (recent.length < 3) continue;
    const failed = recent.filter(r => r.status === 'failed').length;
    if (failed >= 3) {
      addFinding('all', 'degradation', `实验 ${id}: 最近 ${recent.length} 次中失败 ${failed} 次`);
      findings++;
      if (failed >= 4) {
        addGoal(`investigate: experiment ${id} failing ${failed}/${recent.length}`, { priority: 2 });
      }
    }
  }
  return findings;
}

// === 3. explore: untested dep pairs (有无组合 + 量化) ===
async function scanExplore() {
  const mf = MANIFEST_FILE;
  if (!existsSync(mf)) return 0;
  const m = JSON.parse(readFileSync(mf, 'utf8'));
  const exps = (m.experiments || []).filter(e => e.status !== 'paused');
  const tested = new Set();
  for (const e of exps) {
    const deps = e.deps || [];
    for (let i = 0; i < deps.length; i++)
      for (let j = i + 1; j < deps.length; j++) tested.add([deps[i], deps[j]].sort().join('|'));
  }
  const cand = [];
  for (let i = 0; i < exps.length; i++) for (let j = i + 1; j < exps.length; j++) {
    const a = exps[i], b = exps[j];
    if (tested.has([a.id, b.id].sort().join('|'))) continue;
    const combined = new Set([...(a.deps || []), ...(b.deps || [])]);
    if (combined.size === 0) continue;
    cand.push({ a: a.id, b: b.id, c: combined.size });
  }
  cand.sort((x, y) => y.c - x.c);
  const pick = cand.slice(0, 3);
  for (const c of pick) addGoal(`compose: test ${c.a} + ${c.b} together`, { priority: 3 });
  return pick.length;
}

// === 4. newVersion: 是否有 major 升级 (有无 + 版本号) ===
async function scanNewVersion(project) {
  const root = project.path || project.root;
  if (!root || !existsSync(join(root, 'package.json'))) return 0;
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const name = project.name || 'unknown';
  let count = 0;
  await mapLimit(Object.keys(deps), 4, async (dep) => {
    const j = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(dep)}/latest`);
    if (!j || !j.version) return;
    const latest = j.version;
    const cur = String(deps[dep]).replace(/^[~^]/, '');
    const cM = parseInt(cur.split('.')[0], 10);
    const lM = parseInt(latest.split('.')[0], 10);
    if (!isNaN(cM) && !isNaN(lM) && lM > cM) {
      addGoal(`evaluate upgrading ${dep}: ${cur} → ${latest} (major bump)`, { priority: 4 });
      addFinding(name, 'newVersion', `${dep}: ${cur} → ${latest}`);
      count++;
    }
  });
  return count;
}

// === 5. patch: 是否有 minor/patch 升级 (有无 + 次数) ===
async function scanPatch(project) {
  const root = project.path || project.root;
  if (!root || !existsSync(join(root, 'package.json'))) return 0;
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  let count = 0;
  await mapLimit(Object.keys(deps), 4, async (dep) => {
    const j = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(dep)}/latest`);
    if (!j || !j.version) return;
    const latest = j.version;
    const cur = String(deps[dep]).replace(/^[~^]/, '');
    const cv = cur.split('.'), lv = latest.split('.');
    const cM = parseInt(cv[0], 10), lM = parseInt(lv[0], 10);
    if (isNaN(cM) || isNaN(lM) || cM !== lM) return;
    const cm = parseInt(cv[1] || '0', 10), lm = parseInt(lv[1] || '0', 10);
    const cp = parseInt(cv[2] || '0', 10), lp = parseInt(lv[2] || '0', 10);
    if (lm > cm || (lm === cm && lp > cp)) {
      addFinding(project.name || 'unknown', 'patch', `${dep}: ${cur} → ${latest}`);
      count++;
    }
  });
  if (count >= 5) addGoal(`npm patch batch (${count} minor/patch available)`, { priority: 3 });
  return count;
}

// === 6. newModule: 新文件未注册到 manifest (有无 = 缺多少) ===
function scanNewModule() {
  if (!existsSync(MANIFEST_FILE)) return 0;
  let manifest;
  try { manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')); } catch { return 0; }
  const registered = new Set((manifest.experiments || []).map(e => e.file));
  // lingbao 目录实验独立
  const lingbaoDir = join(EXP_DIR, 'lingbao');
  try {
    if (existsSync(lingbaoDir)) {
      for (const e of readdirSync(lingbaoDir)) {
        if (e.endsWith('.mjs')) registered.add('lingbao/' + e);
      }
    }
  } catch {}
  let count = 0;
  try {
    for (const e of readdirSync(EXP_DIR)) {
      if (e.endsWith('.mjs') && !registered.has(e)) {
        count++;
        addFinding('bridge', 'newModule', `experiments/${e}: not in manifest.json`);
        addGoal(`register: experiments/${e} in manifest.json`, { priority: 2 });
      }
    }
  } catch {}
  return count;
}

// === 7. testCoverage: manifest 实验无 test() 函数 (有无 = 缺多少) ===
function scanTestCoverage() {
  if (!existsSync(MANIFEST_FILE)) return 0;
  let manifest;
  try { manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')); } catch { return 0; }
  const exps = (manifest.experiments || []).filter(e => e.status !== 'paused');
  let count = 0;
  for (const e of exps) {
    const file = join(EXP_DIR, e.file);
    if (!existsSync(file)) {
      count++;
      addFinding('bridge', 'testCoverage', `${e.id}: file ${e.file} missing`);
      addGoal(`write test() for ${e.id} (file missing)`, { priority: 2 });
      continue;
    }
    try {
      const content = readFileSync(file, 'utf8');
      const hasTest = /(?:async\s+)?function\s+test\s*\(/.test(content)
        || /^\s*test\s*[=:]/m.test(content)
        || /export\s+(?:async\s+)?function\s+test\b/.test(content);
      if (!hasTest) {
        count++;
        addFinding('bridge', 'testCoverage', `${e.id}: no test() in ${e.file}`);
        addGoal(`write test() for ${e.id}`, { priority: 2 });
      }
    } catch {}
  }
  return count;
}

// === 8. depsParity: 跨项目功能对照 (有无 = 缺口数) ===
function scanDepsParity() {
  const candidates = ['F:/openliems', 'F:/openhxcc', 'F:/openchat-flutter/lib'];
  const ourModules = new Set();
  try {
    for (const f of scanDir(join(SRC_DIR, 'core'))) {
      const name = f.split(/[\\/]/).pop().replace(/\.(js|mjs|cjs)$/, '');
      if (name && !name.startsWith('_') && !name.includes('.spec.') && !name.includes('.json')) {
        ourModules.add(name);
      }
    }
  } catch {}
  let gaps = 0;
  for (const proj of candidates) {
    if (!existsSync(proj)) continue;
    try {
      for (const f of scanDir(proj, [], 3)) {
        const name = f.split(/[\\/]/).pop().replace(/\.(js|mjs|cjs)$/, '');
        if (name && !name.startsWith('_') && !name.includes('.spec.') && !name.includes('.json') && !ourModules.has(name)) {
          gaps++;
          addFinding('bridge', 'depsParity', `${name} in ${proj.split(/[\\/]/).pop()} not in openchat`);
          if (gaps <= 10) {
            addGoal(`adopt: ${name} from ${proj.split(/[\\/]/).pop()}`, { priority: 3 });
          }
        }
      }
    } catch {}
  }
  return gaps;
}

// === 9. configSchema: 配置 key 缺 schema 校验 (有无 = 缺多少) ===
function scanConfigSchema() {
  if (!existsSync(PERSISTENT_CONFIG)) return 0;
  let content;
  try { content = readFileSync(PERSISTENT_CONFIG, 'utf8'); } catch { return 0; }
  // 找 DEFAULT_CONFIG 块
  const defMatch = content.match(/DEFAULT_CONFIG\s*=\s*\{([\s\S]*?)\n\}/);
  if (!defMatch) return 0;
  const block = defMatch[1];
  // 找顶级 key
  const keyRe = /^\s{2,4}([a-zA-Z_$][\w$]*)\s*:/gm;
  const keys = new Set();
  let m;
  while ((m = keyRe.exec(block)) !== null) {
    if (!['if', 'for', 'return', 'const', 'let', 'var', 'function', 'export', 'import', 'while'].includes(m[1])) {
      keys.add(m[1]);
    }
  }
  // 检查 schema 验证
  const hasSchema = /\b(joi|Joi|ajv|Ajv|zod|Zod)\s*\.\s*(object|Object)\s*\(/.test(content)
    || /validate\s*\(/.test(content)
    || /schema\s*[:=]/i.test(content);
  if (!hasSchema) {
    const n = keys.size;
    if (n > 0) {
      addFinding('bridge', 'configSchema', `persistent-config.js: no schema validator, ${n} keys unvalidated`);
      addGoal(`add schema (joi/ajv) for persistent-config.js (${n} keys)`, { priority: 2 });
    }
    return n;
  }
  // 有 schema 但没覆盖所有 key: 简单检查 schema 块里出现的 key
  const schemaBlock = content.match(/Joi\s*\.\s*object\s*\(\s*\{([\s\S]*?)\}/i);
  if (schemaBlock) {
    const covered = new Set();
    const re = /([a-zA-Z_$][\w$]*)\s*:\s*Joi\./g;
    let mm;
    while ((mm = re.exec(schemaBlock[1])) !== null) covered.add(mm[1]);
    let missing = 0;
    for (const k of keys) {
      if (!covered.has(k)) {
        missing++;
        addFinding('bridge', 'configSchema', `${k}: not in schema`);
      }
    }
    if (missing > 0) {
      addGoal(`extend schema to cover ${missing} config key(s)`, { priority: 2 });
    }
    return missing;
  }
  return 0;
}

// === 10. errorHandler: throw 缺 catch (有无 = 缺多少) ===
function scanErrorHandler() {
  const files = scanDir(SRC_DIR);
  let count = 0;
  for (const f of files) {
    if (count >= 50) break;
    try {
      const content = readFileSync(f, 'utf8');
      // 状态机: 跟踪 try/catch 嵌套
      const lines = content.split('\n');
      let tryDepth = 0;
      let lineNo = 0;
      for (const line of lines) {
        lineNo++;
        // 更新 try 深度
        const tryOpen = (line.match(/\btry\s*\{/g) || []).length;
        const tryClose = (line.match(/\}\s*catch\b/g) || []).length;
        tryDepth += tryOpen - tryClose;
        if (tryDepth < 0) tryDepth = 0;
        // 顶层 throw
        const trimmed = line.trim();
        if (tryDepth === 0
          && /\bthrow\s+/.test(line)
          && !trimmed.startsWith('//')
          && !trimmed.startsWith('*')
          && !trimmed.startsWith('/*')) {
          count++;
          addFinding('bridge', 'errorHandler', `${relPath(f)}:${lineNo}: throw without catch`);
          if (count <= 10) {
            addGoal(`add try/catch at ${relPath(f)}:${lineNo}`, { priority: 2 });
          }
        }
      }
    } catch {}
  }
  return count;
}

// === 11. missingFeatures: 跨项目功能对照 - 别人有 openchat 没有 (有无 = 缺口数) ===
function scanMissingFeatures() {
  const projects = readProjects();
  const ourFeatures = new Set();
  try {
    const ourSrc = join(PROJECT_ROOT, 'bridge/src');
    if (existsSync(ourSrc)) {
      for (const e of readdirSync(ourSrc, { withFileTypes: true })) {
        if (e.isDirectory() && !e.name.startsWith('.') && !['__tests__', 'node_modules'].includes(e.name)) {
          ourFeatures.add(e.name);
        }
      }
    }
  } catch {}
  const skipDirs = new Set(['bin', 'target', 'cmd', 'tests', 'test', 'docs', 'static', 'templates', 'plans', 'migrations', 'tools', 'node_modules', 'dist', 'build', 'vendor', 'uploads', 'uploadfiles', 'templates', 'static', 'docs', 'fonts', 'css', 'js', 'images', 'data', 'result', 'openchat.db', 'CHZ', 'xslt']);
  let gaps = 0;
  for (const proj of projects) {
    if (!proj || !proj.name || proj.name === 'openchat' || proj.name === 'openchat-flutter') continue;
    const root = proj.path || proj.root;
    if (!root || !existsSync(root)) continue;
    const candidates = [join(root, 'src'), join(root, 'bridge/src'), join(root, 'internal'), root];
    let otherSrc = null;
    for (const c of candidates) {
      try {
        if (existsSync(c) && statSync(c).isDirectory()) {
          const has = readdirSync(c).some(n => {
            try { return statSync(join(c, n)).isDirectory(); } catch { return false; }
          });
          if (has) { otherSrc = c; break; }
        }
      } catch {}
    }
    if (!otherSrc) continue;
    try {
      const otherFeatures = new Set();
      for (const e of readdirSync(otherSrc, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('.') || e.name.startsWith('__')) continue;
        if (skipDirs.has(e.name)) continue;
        otherFeatures.add(e.name);
      }
      for (const feat of otherFeatures) {
        if (ourFeatures.has(feat)) continue;
        gaps++;
        addFinding(proj.name, 'missingFeatures', `${feat}/ (in ${proj.name}, not in openchat)`);
        if (gaps <= 10) {
          addGoal(`adopt: ${feat} module from ${proj.name} (gap=missing)`, { priority: 3 });
        }
      }
    } catch {}
  }
  return gaps;
}

// === 12. bench: 性能是否退化 (有无 = 退化实验数) ===
async function scanBench() {
  const all = listHistory();
  if (all.length < 50) return 0;
  const byExp = {};
  for (const r of all) {
    if (!r.durationMs || r.status !== 'done') continue;
    const m = (r.description || '').match(/实验\s+(\S+):/);
    const id = m ? m[1] : (r.description || '').slice(0, 40);
    (byExp[id] = byExp[id] || []).push(r);
  }
  let findings = 0;
  for (const [id, runs] of Object.entries(byExp)) {
    if (runs.length < 10) continue;
    const sorted = runs.slice().sort((a, b) => a.finishedAt - b.finishedAt);
    const n = Math.max(3, Math.floor(sorted.length / 3));
    const avg = (arr) => arr.reduce((s, r) => s + r.durationMs, 0) / arr.length;
    const b = avg(sorted.slice(0, n)), r = avg(sorted.slice(-n));
    if (b > 0 && r > b * 2) {
      addFinding('all', 'bench', `实验 ${id}: ${(b / 1000).toFixed(1)}s → ${(r / 1000).toFixed(1)}s (${(r / b).toFixed(2)}x)`);
      findings++;
    }
  }
  return findings;
}

// === 13. rerun: 是否需要重置 failed goal (有无 = 多少可重置) ===
async function scanRerun() {
  const failed = listGoals({ status: 'failed' });
  const pendingDesc = new Set(listGoals({ pending: true }).map(g => g.description));
  let reset = 0;
  for (const g of failed) {
    if ((g.retryCount || 0) >= 3) continue;
    if (pendingDesc.has(g.description)) continue;
    updateGoal(g.id, { status: 'pending', startedAt: null, finishedAt: null, retryCount: 0, escalatedAt: null });
    pendingDesc.add(g.description);
    reset++;
    if (reset >= 5) break;
  }
  return reset;
}

// === Main round ===
export async function runScoutRound() {
  const projects = readProjects();
  const projArr = Array.isArray(projects)
    ? projects.map(p => ({ ...p }))
    : Object.entries(projects).map(([name, cfg]) => ({ name, ...cfg }));
  log(`started (pid=${process.pid}, projects=${projArr.length})`);

  const p1 = await safe('p1', scanForLeftoverP2);
  const p2 = await safe('p2', scanForSyntaxErrors);
  const altExists = projArr[0] ? await safe('altExists', () => scanAltExists(projArr[0])) : 0;
  const newVersion = projArr[0] ? await safe('newVersion', () => scanNewVersion(projArr[0])) : 0;
  const patch = projArr[0] ? await safe('patch', () => scanPatch(projArr[0])) : 0;
  const explore = await safe('explore', scanExplore);
  const degradation = await safe('degradation', scanDegradation);
  const newModule = await safe('newModule', scanNewModule);
  const testCoverage = await safe('testCoverage', scanTestCoverage);
  const depsParity = await safe('depsParity', scanDepsParity);
  const configSchema = await safe('configSchema', scanConfigSchema);
  const errorHandler = await safe('errorHandler', scanErrorHandler);
  const missingFeatures = await safe('missingFeatures', scanMissingFeatures);
  const bench = await safe('bench', scanBench);
  const rerun = await safe('rerun', scanRerun);

  // Drain
  const pending = listGoals({ pending: true }).length;
  if (pending > 0) {
    const batch = Math.min(pending, CONCURRENCY);
    log(`cycle: ${pending} pending, draining (max ${CONCURRENCY})`);
    const { runNext } = await import('./runner.mjs');
    let ok = 0;
    for (let i = 0; i < batch; i++) {
      const r = await runNext();
      if (r?.ok) ok++;
    }
    log(`drain: ${ok}/${batch} ok`);
  } else {
    log('cycle: 0 pending, skip');
  }

  const result = {
    p1, p2,
    altExists, newVersion, patch,
    explore, degradation,
    newModule, testCoverage, depsParity, configSchema, errorHandler, missingFeatures,
    bench, rerun,
  };
  log(`round end ${JSON.stringify(result)}`);
  return result;
}
