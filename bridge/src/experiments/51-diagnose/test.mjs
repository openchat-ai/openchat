// Experiment 51-diagnose test harness — dry-run
// 跑法: node src/experiments/51-diagnose/test.mjs
// 期望: 0 错退出
//
// 测试 4 个 case + 1 个兜底 + 3 个 network/transport stall fingerprint:
//   Case 1: v3 transcript 摘要 → 期望 "round 0 零 tool call"
//   Case 2: v2 transcript 摘要 → 期望 "幻觉 system-reminder 服从"
//   Case 3: 自定义撞 30 rounds → 期望 3-5 个 ranked hypothesis 含 If/then
//   Case 4: 0 fingerprint 兜底 → 期望至少 1 条 local hypothesis
//   Case 5: failover-hang-no-stream (aaa50d48) → 件 3 强契约 + 件 4 可恢复执行
//   Case 6: provider-region-block (a3f75eb0 Part 1) → 件 4 region-aware fallback chain
//   Case 7: clear-empty-content (a26cfad6 Tier 2 bug) → 件 4 retry 前清空 content
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
