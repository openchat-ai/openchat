import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { addGoal } from '../goal-queue.mjs';
import { addFinding } from '../findings.mjs';
import { listHistory } from '../history.mjs';
import { EXP_DIR, MANIFEST_FILE } from '../scout-shared.mjs';

// === invariants ===
// - 同步 FS 调用仅用于小文件读写，阻塞 ≤1ms
// - try/catch 覆盖所有外部 IO 调用
// - 事件发射使用 fire-and-forget，不阻塞调用方

export async function scanExplore() {
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

export async function scanDegradation() {
  const all = listHistory();
  if (all.length === 0) return 0;
  const byExp = {};
  for (const r of all) {
    const m = String(r.description || '').match(/实验\s+(\S+):/);
    const id = m ? m[1] : String(r.description || '').slice(0, 40);
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

export function scanExpIntrospect() {
  let count = 0;
  try {
    const m = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
    for (const entry of (m.experiments || [])) {
      if (entry.status === 'reference-only' || entry.status === 'paused') continue;
      const filePath = join(EXP_DIR, entry.file);
      if (!existsSync(filePath)) continue;
      const c = readFileSync(filePath, 'utf8');

      const exportedFns = [...c.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g)]
        .map(m => m[1])
        .filter(n => !['test', 'run', 'META'].includes(n) && !n.startsWith('_') && n !== 'NAME');
      if (exportedFns.length === 0) continue;

      // L1: test() 覆盖检测
      const checkEntry = (entryName) => {
        const fnType = entryName === 'test' ? 'test' : 'run';
        const match = c.match(new RegExp(`export\\s+(?:async\\s+)?function\\s+${fnType}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
        if (!match) {
          if (fnType === 'test') {
            addFinding('bridge', 'expIntrospect', `${entry.id}: 缺少 test()`);
            addGoal(`write test() for ${entry.id}`, { priority: 2 });
            count++;
          }
          return;
        }
        const body = match[1];
        for (const fn of exportedFns) {
          if (!new RegExp(`\\b${fn}\\s*\\(`).test(body)) {
            addFinding('bridge', 'expIntrospect', `${entry.id}: ${fnType}() 未覆盖 ${fn}`);
            addGoal(`[enhance] experiment: ${entry.id} — ${fnType}() missing ${fn}`, { priority: 2 });
            count++;
          }
        }
      };
      checkEntry('test');
      checkEntry('run');
    }
  } catch {}
  return count;
}
