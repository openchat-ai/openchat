// tui/actions.mjs — 执行动作：跑单实验 test / 跑 run-all
// === invariants ===
// - runOne/runAll 有超时保护，绝不让 TUI 永久卡死
// - experiments-all.mjs 懒加载（有初始化副作用），首次调用才 import
// - 独立文件（含 '/' 或非 experiments-all 前缀）走动态 import mod.test

import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { EXP_DIR } from './data.mjs';

const TIMEOUT_MS = 15000;
let _ALL = null;

async function loadAll() {
  if (!_ALL) _ALL = await import('../experiments-all.mjs');
  return _ALL;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`超时 ${ms}ms`)), ms)),
  ]);
}

function findTestFn(ALL, expId) {
  const safe = 'experiment_' + expId.replace(/[^a-zA-Z0-9_]/g, '_');
  if (typeof ALL[safe + '_test'] === 'function') return ALL[safe + '_test'];
  for (const [k, v] of Object.entries(ALL)) {
    if (k.startsWith(safe + '_test') && typeof v === 'function') return v;
  }
  for (const [k, v] of Object.entries(ALL)) {
    if (k.startsWith(safe + '_') && typeof v === 'function' && /^test[A-Z]/.test(k)) return v;
  }
  if (typeof ALL[safe + '_run'] === 'function') return () => ALL[safe + '_run']({ inputs: {} });
  return null;
}

export async function runOne(exp) {
  const t0 = Date.now();
  try {
    let result;
    if (exp.file && !exp.file.startsWith('experiments-all') && !exp.file.includes('/')) {
      const ALL = await loadAll();
      const fn = findTestFn(ALL, exp.id);
      if (!fn) {
        const mod = await import(pathToFileURL(resolve(EXP_DIR, exp.file)).href);
        if (typeof mod.test !== 'function') return fmt(exp, false, '无 test 函数', t0);
        result = await withTimeout(mod.test(), TIMEOUT_MS);
      } else {
        result = await withTimeout(fn(), TIMEOUT_MS);
      }
    } else {
      const mod = await import(pathToFileURL(resolve(EXP_DIR, exp.file)).href);
      if (typeof mod.test !== 'function') return fmt(exp, false, '无 test 函数', t0);
      result = await withTimeout(mod.test(), TIMEOUT_MS);
    }
    const ok = result?.ok !== false;
    return fmt(exp, ok, result?.info || JSON.stringify(result || {}), t0);
  } catch (e) {
    return fmt(exp, false, e.message, t0);
  }
}

function fmt(exp, ok, info, t0) {
  const ms = Date.now() - t0;
  return `${ok ? '✓ 通过' : '✗ 失败'}  ${exp.id}  (${ms}ms)\n\n${info}`;
}

export async function runAllSummary(exps) {
  const runnable = exps.filter((e) => e.status === 'closed-loop' && e.file && !e.file.includes('/'));
  const lines = [`跑 ${runnable.length} 个 closed-loop 实验（各限 ${TIMEOUT_MS}ms）…`, ''];
  let pass = 0;
  for (const e of runnable) {
    try {
      const ALL = await loadAll();
      const fn = findTestFn(ALL, e.id);
      if (!fn) { lines.push(`  ⚠ ${e.id}: 无 test`); continue; }
      const r = await withTimeout(fn(), TIMEOUT_MS);
      const ok = r?.ok !== false;
      if (ok) pass++;
      lines.push(`  ${ok ? '✓' : '✗'} ${e.id}`);
    } catch (err) {
      lines.push(`  ✗ ${e.id}: ${err.message}`);
    }
  }
  lines.push('', `结果: ${pass}/${runnable.length} 通过`);
  return lines.join('\n');
}
