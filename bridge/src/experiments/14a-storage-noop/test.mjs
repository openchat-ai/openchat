// Experiment 14a test harness — dry-run
// 跑法: node src/experiments/14a-storage-noop/test.mjs
// 期望: 0 错退出
//
// 6 cases:
//   Case 1: basic CRUD (set/get/size)
//   Case 2: get-missing returns null
//   Case 3: delete then size, then re-get returns null
//   Case 4: has on existing vs deleted
//   Case 5: clear wipes all
//   Case 6: META.persistent === false (R3 self-declaration)

import { test } from './index.mjs';

(async () => {
  try {
    await test();
    process.exit(0);
  } catch (e) {
    console.error('[14a-storage-noop test] FAILED:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
