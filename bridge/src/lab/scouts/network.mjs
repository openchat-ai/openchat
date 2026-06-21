import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { addGoal, updateGoal, listGoals, addFinding, listHistory, SRC_DIR, EXP_DIR, MANIFEST_FILE, scanDir, relPath, mapLimit, fetchJson, readProjects } from '../lab-core.mjs';

// === invariants ===
// - 所有异步操作使用 await 或 Promise.all 串联
// - 同步 FS 调用仅用于小文件读写，阻塞 ≤1ms
// - try/catch 覆盖所有外部 IO 调用
// - 事件发射使用 fire-and-forget，不阻塞调用方

export async function scanAltExists(project) {
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

export async function scanNewVersion(project) {
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

export async function scanPatch(project) {
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

export async function scanBench() {
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

export function scanNewModule() {
  if (!existsSync(MANIFEST_FILE)) return 0;
  let manifest;
  try { manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')); } catch { return 0; }
  const registered = new Set((manifest.experiments || []).map(e => e.file));
  const lingbaoDir = join(EXP_DIR, 'lingbao');
  try {
    if (existsSync(lingbaoDir)) {
      for (const e of readdirSync(lingbaoDir)) {
        if (e.endsWith('.mjs')) registered.add('lingbao/' + e);
      }
    }
  } catch {}
  const candidates = [];
  try {
    for (const e of readdirSync(EXP_DIR)) {
      if (e.endsWith('.mjs') && !registered.has(e)) candidates.push(e);
    }
  } catch { return 0; }
  if (candidates.length === 0) return 0;
  const files = scanDir(SRC_DIR);
  const refCount = {};
  for (const c of candidates) refCount[c] = 0;
  const baseName = (c) => c.replace(/\.(mjs|js|cjs)$/, '');
  for (const f of files) {
    try {
      const txt = readFileSync(f, 'utf8');
      for (const c of candidates) {
        const stem = baseName(c);
        const re = new RegExp(`from\\s+['"][^'"]*${stem.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?:\\.mjs)?['"]`, 'g');
        const m = txt.match(re);
        if (m) refCount[c] += m.length;
      }
    } catch {}
  }
  let count = 0;
  for (const c of candidates) {
    if (refCount[c] >= 1) {
      count++;
      addFinding('bridge', 'newModule', `experiments/${c}: not in manifest.json, referenced ${refCount[c]}x`);
      addGoal(`register: experiments/${c} in manifest.json`, { priority: 2 });
    }
  }
  return count;
}

export async function scanRerun() {
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
