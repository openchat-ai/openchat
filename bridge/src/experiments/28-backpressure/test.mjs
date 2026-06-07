import { _setDeps, _resetDeps, processOne } from '../../core/chat-poller.mjs';
import assert from 'assert';

// Simulate slow Qiniu: 30 in-flight → backpressure kicks in
let getDelay = 0;
_setDeps({
  qiniuGet: async () => { await new Promise(r => setTimeout(r, getDelay)); return Buffer.from('{"text":"hi"}'); },
  qiniuList: async () => [],
  qiniuPut: async () => {},
  processText: async () => ({ response: 'ok' }),
  generateSessionName: async () => 'test',
  autoNameIfNeeded: async () => {},
  composeRun: async () => ({ outputs: { reply: 'ok', replyKey: 'r.json', error: null } }),
  LmdnCodec: class { initialize = async () => {}; decode = async () => ({ pcm: Buffer.alloc(100) }); },
});

// Fire many concurrent requests to exceed MAX_IN_FLIGHT=20
getDelay = 500; // each takes 500ms
const promises = [];
for (let i = 0; i < 25; i++) {
  promises.push(processOne(`oc/chat/test/${i}.msg`));
}
const results = await Promise.allSettled(promises);
const backpressured = results.filter(r => r.status === 'fulfilled' && r.value?.skipped === 'backpressure').length;
assert.ok(backpressured > 0, `should have backpressure (got ${backpressured})`);
console.log(`✓ backpressure: ${backpressured}/25 requests rejected due to backpressure`);

// Clean up inFlight state
_resetDeps();
console.log('✓ backpressure: deps reset');

// Test: normal load passes
getDelay = 0;
const normal = await Promise.all([0,1,2,3].map(i => processOne(`oc/chat/normal/${i}.msg`)));
const rejected = normal.filter(r => r && r.skipped).length;
assert.equal(rejected, 0);
console.log('✓ backpressure: normal load passes');
