// cleanup-test-msgs.mjs — delete .msg files in test-prefixed chatIds
//
// Scope: 0_test, test-reasoning, poll-one-test (artificial test data)
// Keeps: bridge/* (user's real chat)
// Skips: -reply.* (already processed)

import { qiniuList, qiniuDelete } from '../src/experiments/lib/storage-lib.mjs';

const TEST_PREFIXES = ['oc/chat/0_test/', 'oc/chat/test-reasoning/', 'oc/chat/poll-one-test/'];

let totalDeleted = 0, totalFailed = 0;
for (const prefix of TEST_PREFIXES) {
  const keys = await qiniuList(prefix);
  const msgs = keys.filter(k => k.endsWith('.msg'));
  console.log(`scanning ${prefix}: total=${keys.length} msg=${msgs.length}`);
  for (const k of msgs) {
    try { await qiniuDelete(k); totalDeleted++; }
    catch (e) { console.error(`fail ${k}: ${e.message}`); totalFailed++; }
  }
}
console.log(`done: deleted=${totalDeleted} failed=${totalFailed}`);
