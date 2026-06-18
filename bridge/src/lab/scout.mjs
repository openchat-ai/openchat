import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { addGoal, listGoals } from './goal-queue.mjs';
import { CONCURRENCY, readProjects } from './scout-shared.mjs';
import { scanAltExists, scanNewVersion, scanPatch, scanBench, scanNewModule, scanRerun } from './scouts/network.mjs';
import { scanForLeftoverP2, scanForSyntaxErrors, scanTestCoverage, scanDepsParity, scanConfigSchema, scanEmptyCatch, scanHardcodedPaths } from './scouts/quality.mjs';
import { scanExplore, scanDegradation, scanExpIntrospect } from './scouts/experiment.mjs';
import { scanLLMVision } from './scouts/architecture.mjs';
import { scanSelf } from './scouts/self.mjs';
import { scanIsolation } from './scouts/isolation.mjs';

// === invariants ===
// - runScoutRound() 幂等: 相同输入产生相同 finding 列表
// - 单 scanner 5s timeout (AbortSignal.timeout), 失败静默
// - finding 永远不重复添加 (key = type+desc, append-only)
// - goal 永远不重复 add (goal-queue.mjs permanent dedup on done)
// - 全部 try/catch 静默失败, scout 不该 crash
// - 文件扫描仅限 bridge/src, 深度 ≤ 10
// - 单次 cycle < 30s (即使所有网络失败)
// - 19 scanner 全部独立 try/catch, 1 个失败不影响其他
// - 19 scanner 全部返回 number (0 表示"无", N 表示"有多少")
// - 每个 scanner 至少过 1 条 3 原则 (faster/cheaper/higher return)
// - 3 原则: faster=减少延迟, cheaper=省资源, higher return=给用户更多价值

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
  const bench = await safe('bench', scanBench);
  const llmVision = await safe('llmVision', scanLLMVision);
  const expIntrospect = await safe('expIntrospect', scanExpIntrospect);
  const self = await safe('self', scanSelf);
  const emptyCatch = await safe('emptyCatch', scanEmptyCatch);
  const hardcodedPaths = await safe('hardcodedPaths', scanHardcodedPaths);
  const rerun = await safe('rerun', scanRerun);
  const isolation = await safe('isolation', scanIsolation);

  // Drain
  const pending = listGoals({ pending: true }).length;
  let drainOK = 0;
  if (pending > 0) {
    const batch = Math.min(pending, CONCURRENCY);
    log(`cycle: ${pending} pending, draining (max ${CONCURRENCY})`);
    const { runNext } = await import('./runner.mjs');
    for (let i = 0; i < batch; i++) {
      const r = await runNext();
      if (r?.ok) drainOK++;
    }
    log(`drain: ${drainOK}/${batch} ok`);
  } else {
    log('cycle: 0 pending, skip');
  }

  // === DNA 刷新（有 fix 或超 1h 才重生成）===
  try {
    const { statSync, existsSync } = await import('fs');
    const { join, resolve } = await import('path');
    const { fileURLToPath } = await import('url');
    const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
    const dnaPath = join(root, '.dna', 'project-dna.json');
    const needsRefresh = !existsSync(dnaPath)
      || drainOK > 0
      || Date.now() - statSync(dnaPath).mtimeMs > 3600000;
    if (needsRefresh) {
      const { writeDNAFile } = await import('../experiments/42.mjs');
      await writeDNAFile();
      log('DNA refreshed' + (drainOK > 0 ? ' (after fix)' : ' (age >1h)'));
    }
  } catch (e) { log(`DNA refresh error: ${e.message}`); }

  // === 元能力心跳 ===
  try {
    const { ping } = await import('./lab-health.mjs');
    const health = ping();
    if (!health.ok) log(`[ALERT] lab-health heartbeat FAIL: ${health.issues?.join(', ')}`);
  } catch (e) {
    log(`[ALERT] lab-health heartbeat CRASH: ${e.message}`);
  }

  const result = {
    p1, p2,
    altExists, newVersion, patch,
    explore, degradation,
    newModule, testCoverage, depsParity, configSchema,
    bench, llmVision, expIntrospect, self, emptyCatch, hardcodedPaths, rerun, isolation,
  };
  log(`round end ${JSON.stringify(result)}`);
  return result;
}
