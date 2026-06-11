// Experiment 14b test harness — boundary verification
// 跑法: node src/experiments/14b-storage-persist/test.mjs
// 期望: 0 错退出
//
// 5 cases:
//   Case 1: set×2 → listSessions has 2 __14b_test_* keys
//   Case 2: get returns the set value
//   Case 3: save + load roundtrip preserves data
//   Case 4: clear only wipes test keys, user data preserved (R6 respect)
//   Case 5: META.persistent === true (R3 exception self-declaration)
//
// 副作用: 真实写 ~/.openchat/sessions.json (写 __14b_test_* 前缀键, 跑完会 clear).
// 如果 clear 之前崩了, 残留键需要手动: cat ~/.openchat/sessions.json | grep __14b_test_
// 然后逐个 delete.

import { test } from './index.mjs';

(async () => {
  try {
    await test();
    process.exit(0);
  } catch (e) {
    console.error('[14b-storage-persist test] FAILED:', e.message);
    console.error(e.stack);
    console.error('');
    console.error('NOTE: this test writes to ~/.openchat/sessions.json. If it crashed before clear,');
    console.error('      residual __14b_test_* keys may be present. See KNOWN_FAILURES.md §1.');
    process.exit(1);
  }
})();
