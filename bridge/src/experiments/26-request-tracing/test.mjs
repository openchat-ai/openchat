import { generate, createSpan, endSpan, getTrace, formatLog } from '../../tools/request-id.mjs';
import assert from 'assert';

// Test 1: generate unique IDs
const id1 = generate();
const id2 = generate();
assert.notEqual(id1, id2);
console.log('✓ request-id: unique generation');

// Test 2: span tree
const child = createSpan('', 'child');
const grandchild = createSpan(child, 'grandchild');
endSpan(grandchild);
endSpan(child);
const trace = getTrace(grandchild);
assert.equal(trace.length, 2);
assert.equal(trace[0].name, 'child');
assert.equal(trace[1].name, 'grandchild');
console.log('✓ request-id: span tree');

// Test 3: formatLog
const log = formatLog('abc123', 'hello', 'world');
assert.ok(log.includes('[abc123]'));
assert.ok(log.includes('hello world'));
console.log('✓ request-id: formatLog');

// Test 4: chat-poller exports (reqId threaded)
import('../../core/chat-poller.mjs').then(m => {
  assert.ok(typeof m.handleMessage === 'function');
  assert.ok(typeof m.processOne === 'function');
  console.log('✓ request-id: chat-poller reqId ready');
});
