import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join, extname } from 'path';
import { fileURLToPath } from 'url';
import { addGoal, listGoals, updateGoal } from './goal-queue.mjs';
import { addFinding } from './findings.mjs';
import { listHistory } from './history.mjs';

// === invariants ===
// - runScoutRound() 幂等: 相同输入产生相同 finding 列表
// - 单 scanner 5s timeout (AbortSignal.timeout), 失败静默
// - finding 永远不重复添加 (key = type+desc, append-only)
// - goal 永远不重复 add (goal-queue.mjs permanent dedup on done)
// - 全部 try/catch 静默失败, scout 不该 crash
// - 文件扫描仅限 bridge/src, 深度 ≤ 10
// - 单次 cycle < 30s (即使所有网络失败)

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const LAB_DIR = join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'lab');
const PROJECTS_FILE = join(LAB_DIR, 'projects.json');
const CONCURRENCY = 3;
const MIN_PENDING = 10;
const FETCH_TIMEOUT = 5000;

function log(msg) {
  console.log(`[scout] ${new Date().toISOString()} ${msg}`);
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

function scanDir(dir, results = []) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) scanDir(full, results);
      else if (['.js', '.mjs', '.cjs'].includes(extname(e.name))) results.push(full);
    }
  } catch {}
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
      try { out[idx] = await fn(items[idx], idx); } catch {}
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

// === P5: Code review — file quality scan ===
function codeReviewP5(projectRoot, projectName) {
  const files = scanDir(join(projectRoot, 'src'));
  let goals = 0;
  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf8');
      const relPath = f.replace(projectRoot + '/', '');
      const lines = content.split('\n');
      if (lines.length > 200) {
        addGoal(`[code] ${relPath}: consider splitting for readability (${lines.length} lines)`, { priority: 5 });
        goals++;
      }
      if (/catch\s*\{[\s]*\}/.test(content)) {
        addGoal(`[code] ${relPath}: empty catch block`, { priority: 5 });
        goals++;
      }
      if (/console\.(log|warn)\(/.test(content)) {
        addGoal(`[code] ${relPath}: console.log left in production code`, { priority: 5 });
        goals++;
      }
      if (/(?:^|\n)\s*(let|var)\s+(?!for\s*\()/.test(content)) {
        addGoal(`[code] ${relPath}: uses var/let instead of const`, { priority: 5 });
        goals++;
      }
    } catch {}
  }
  if (goals > 0) addFinding(projectName, 'codesmell', `${goals} code issue(s) enqueued`);
  return goals;
}

// === P1/P2: queue level guards ===
function ensureQueueLevel(targetPending, label) {
  const pending = listGoals({ pending: true }).length;
  if (pending >= targetPending) { log(`${label}: ${pending} pending, enough`); return true; }
  log(`${label}: ${pending} < ${targetPending}, low`);
  return false;
}

// === P4 (legacy): major bumps via npm outdated ===
async function checkMajorBumps(projectRoot, projectName) {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const { execSync } = await import('child_process');
    const out = execSync('npm outdated --json', { cwd: projectRoot, encoding: 'utf8', timeout: 15000 });
    const outdated = JSON.parse(out);
    let count = 0;
    for (const [name, info] of Object.entries(outdated)) {
      if (info.wanted && info.latest && info.wanted !== info.latest) {
        addGoal(`evaluate upgrading ${name}: ${info.current} → ${info.latest} (major bump)`, { priority: 4 });
        count++;
      }
    }
    if (count > 0) {
      addFinding(projectName, 'npm', `${count} major bump eval(s) enqueued`);
      log(`[${projectName}] major: ${count} major bump eval(s) enqueued`);
    }
    return count;
  } catch { return 0; }
}

// === 1. scanInternet — npm downloads comparison ===
async function scanInternet(project) {
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
      addFinding(project.name || 'unknown', 'internet', `${name}/${alt} ratio=${ratio.toFixed(2)}`);
      findings++;
      if (ratio > 5 || ratio < 0.2) {
        addGoal(`investigate: switch ${name} to ${alt} (downloads ratio ${ratio.toFixed(2)})`, { priority: 3 });
      }
    }
  });
  return findings;
}

// === 2. scanDegradation — failure rate from history ===
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

// === 3. scanExplore — untested dep pairs from manifest ===
async function scanExplore() {
  const mf = join(PROJECT_ROOT, 'src/experiments/manifest.json');
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

// === 4. scanMajor — semver major upgrade check via registry ===
async function scanMajor(project) {
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
      addFinding(name, 'major', `${dep}: ${cur} → ${latest}`);
      count++;
    }
  });
  return count;
}

// === 5. scanNpm — minor/patch upgrades ===
async function scanNpm(project) {
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
      addFinding(project.name || 'unknown', 'npm', `${dep}: ${cur} → ${latest}`);
      count++;
    }
  });
  if (count >= 5) addGoal(`npm upgrade batch (${count} minor/patch available)`, { priority: 3 });
  return count;
}

// === 6. scanCodesmell — TODO/FIXME backlog ===
async function scanCodesmell() {
  const files = scanDir(join(PROJECT_ROOT, 'src'));
  const re = /\/\/\s*(TODO|FIXME|XXX|HACK)\b/;
  let findings = 0;
  const seen = new Set();
  for (const f of files) {
    if (seen.size >= 200) break;
    try {
      if (re.test(readFileSync(f, 'utf8'))) {
        seen.add(f);
        findings++;
        addFinding('bridge', 'codesmell', `${f.replace(PROJECT_ROOT + '/', '')}: TODO/FIXME`);
      }
    } catch {}
  }
  if (findings > 10) addGoal(`address TODO backlog (${findings} items)`, { priority: 3 });
  return findings;
}

// === 7. scanDeepsmell — function length + nesting + cyclomatic heuristic ===
function findMaxFunctionBodyLines(content) {
  const out = [];
  const re = /(?:function\s+\w+[^{]{0,80}\{|\([^)]*\)\s*=>\s*\{|[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    let depth = 1, i = m.index + m[0].length;
    while (i < content.length && depth > 0) {
      const ch = content[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
      if (i - m.index > 20000) break;
    }
    out.push(content.slice(m.index + m[0].length, i - 1).split('\n').length);
  }
  return out.length ? Math.max(...out) : 0;
}

function maxNestingDepth(content) {
  let max = 0, cur = 0, inStr = null, inLine = false, inBlock = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i], nx = content[i + 1];
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (ch === '*' && nx === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (ch === '\\') { i++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && nx === '/') { inLine = true; i++; continue; }
    if (ch === '/' && nx === '*') { inBlock = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') { cur++; if (cur > max) max = cur; }
    else if (ch === '}') cur--;
  }
  return max;
}

function cyclomaticComplexity(content) {
  let c = 1;
  const re = /\b(if|else if|for|while|case|catch|\?\?|\|\||&&)\b/g;
  let m;
  while ((m = re.exec(content)) !== null) c++;
  return c;
}

async function scanDeepsmell() {
  const files = scanDir(join(PROJECT_ROOT, 'src'));
  let findings = 0;
  for (const f of files) {
    if (findings >= 20) break;
    try {
      const content = readFileSync(f, 'utf8');
      const bodyLen = findMaxFunctionBodyLines(content);
      const nest = maxNestingDepth(content);
      const cyclo = cyclomaticComplexity(content);
      if (bodyLen > 50 || nest > 4 || cyclo > 10) {
        addFinding('bridge', 'deepsmell', `${f.replace(PROJECT_ROOT + '/', '')}: body=${bodyLen} nest=${nest} cyclo=${cyclo}`);
        findings++;
      }
    } catch {}
  }
  if (findings > 5) addGoal(`refactor: ${findings} deepsmell files`, { priority: 3 });
  return findings;
}

// === 8. scanBench — performance regression ===
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

// === 9. scanRerun — reset failed goals for retry ===
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
  const projArr = Array.isArray(projects) ? projects.map(p => ({ ...p })) : Object.entries(projects).map(([name, cfg]) => ({ name, ...cfg }));
  log(`started (pid=${process.pid}, projects=${projArr.length})`);

  const p1ok = ensureQueueLevel(MIN_PENDING, 'p1') ? 1 : 0;
  const p2ok = p1ok ? 1 : (ensureQueueLevel(MIN_PENDING, 'p2') ? 1 : 0);
  const p3 = 0;

  let p4 = 0;
  for (const proj of projArr) {
    const root = proj.path || proj.root;
    if (!root || !existsSync(root)) continue;
    const c = await safe(`p4/${proj.name}`, () => checkMajorBumps(root, proj.name));
    p4 += c;
  }

  let p5 = 0;
  for (const proj of projArr) {
    const root = proj.path || proj.root;
    if (!root || !existsSync(root)) continue;
    p5 += (codeReviewP5(root, proj.name) || 0);
  }

  const internet = projArr[0] ? await safe('internet', () => scanInternet(projArr[0])) : 0;
  const degradation = await safe('degradation', scanDegradation);
  const explore = await safe('explore', scanExplore);
  let major = 0;
  for (const proj of projArr) major += await safe(`major/${proj.name}`, () => scanMajor(proj));
  let npm = 0;
  for (const proj of projArr) npm += await safe(`npm/${proj.name}`, () => scanNpm(proj));
  const codesmell = await safe('codesmell', scanCodesmell);
  const deepsmell = await safe('deepsmell', scanDeepsmell);
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

  const result = { p1: p1ok, p2: p2ok, p3, p4, p5, internet, degradation, explore, major, npm, codesmell, deepsmell, bench, rerun };
  log(`round end p1=${p1ok} p2=${p2ok} p3=${p3} p4=${p4} p5=${p5} internet=${internet} degradation=${degradation} explore=${explore} major=${major} npm=${npm} codesmell=${codesmell} deepsmell=${deepsmell} bench=${bench} rerun=${rerun}`);
  return result;
}