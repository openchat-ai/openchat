// cleanup-old-msgs.mjs — delete old chat .msg files in bridge/ to unblock chat-poller
//
// Scoped: only deletes .msg (raw user messages) older than cutoffMs
// Keeps: -reply.epc / -reply.json (already-processed replies)
// Skips: 0_test, test-reasoning, c1, poll-one-test (test/active chatIds)

import { qiniuList, qiniuDelete } from '../src/experiments/lib/storage-lib.mjs';

const PREFIX = 'oc/chat/bridge/';
const CUTOFF_MS = Date.now() - 7 * 24 * 3600 * 1000; // older than 7 days

const keys = await qiniuList(PREFIX);
const oldMsgs = keys.filter(k => {
  if (!k.endsWith('.msg')) return false;
  const m = k.match(/(\d+)\.msg$/);
  if (!m) return false;
  return parseInt(m[1], 10) < CUTOFF_MS;
});

console.log(`scanning ${PREFIX}: total=${keys.length} old_msg_candidates=${oldMsgs.length}`);
let ok = 0, fail = 0;
for (const k of oldMsgs) {
  try { await qiniuDelete(k); ok++; }
  catch (e) { console.error(`fail ${k}: ${e.message}`); fail++; }
}
console.log(`done: deleted=${ok} failed=${fail}`);
