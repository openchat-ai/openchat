// Experiment 51-diagnose test harness — dry-run
// 跑法: node src/experiments/51-diagnose/test.mjs
// 期望: 0 错退出
//
// 测试 3 个 case + 1 个兜底:
//   Case 1: v3 transcript 摘要 → 期望 "round 0 零 tool call"
//   Case 2: v2 transcript 摘要 → 期望 "幻觉 system-reminder 服从"
//   Case 3: 自定义撞 30 rounds → 期望 3-5 个 ranked hypothesis 含 If/then
//   Case 4: 0 fingerprint 兜底 → 期望至少 1 条 local hypothesis
//
// 另: 验证 import 不挂 (持久化配置缺失时不应崩)

import { test } from './index.mjs';

(async () => {
  try {
    await test();
    process.exit(0);
  } catch (e) {
    console.error('[51-diagnose test] FAILED:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
