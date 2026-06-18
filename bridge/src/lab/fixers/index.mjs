// === invariants ===
// - applyFixer(goalText) 遍历所有 fixer 的 match(), 第一个命中
// - 无匹配回退到其他处理器（实验 test / lab-health）

import { apply as fixEmptyCatch } from './empty-catch.mjs';

const FIXERS = [
  { match: (t) => t.startsWith('[fix] empty catch:'), apply: fixEmptyCatch },
];

export async function applyFixer(goalText) {
  for (const fx of FIXERS) {
    if (fx.match(goalText)) return fx.apply(goalText);
  }
  return { ok: false, info: `no fixer for: ${goalText.slice(0, 60)}` };
}
