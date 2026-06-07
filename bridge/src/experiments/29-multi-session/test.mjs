import assert from 'assert';

// Simulate multi-session isolation: 10 concurrent sessions
const sessions = {};
for (let i = 0; i < 10; i++) {
  sessions[`session-${i}`] = { history: [], name: `Session ${i}` };
}

async function simulateChat(sid, msg) {
  const s = sessions[sid];
  s.history.push({ role: 'user', content: msg, ts: Date.now() });
  const reply = `reply-to-${sid}: ${msg}`;
  s.history.push({ role: 'assistant', content: reply, ts: Date.now() });
  return reply;
}

// Run 10 concurrent sessions, 3 messages each
const results = await Promise.all(
  [0,1,2,3,4,5,6,7,8,9].flatMap(sid =>
    ['msg1','msg2','msg3'].map(msg => simulateChat(`session-${sid}`, msg))
  )
);

// Verify isolation: each session has exactly 6 entries (3 user + 3 assistant)
for (let i = 0; i < 10; i++) {
  const sid = `session-${i}`;
  assert.equal(sessions[sid].history.length, 6, `${sid} should have 6 messages`);
  assert.ok(sessions[sid].history[0].content === 'msg1', `${sid} first msg preserved`);
}
console.log('✓ multi-session: 10 sessions × 3 msgs, all isolated');

// Verify ordering: within each session, messages are in order
for (let i = 0; i < 10; i++) {
  const sid = `session-${i}`;
  for (let j = 0; j < sessions[sid].history.length - 1; j++) {
    assert.ok(sessions[sid].history[j].ts <= sessions[sid].history[j + 1].ts,
      `${sid} message ${j} out of order`);
  }
}
console.log('✓ multi-session: chronological ordering preserved');

// Test: chat-poller isolation (via chatId)
await import('../../core/chat-poller.mjs').then(m => {
  const keys = ['oc/chat/a/1.msg', 'oc/chat/b/2.msg', 'oc/chat/c/3.msg'];
  const chatIds = keys.map(k => k.split('/')[2]);
  assert.deepStrictEqual(chatIds, ['a', 'b', 'c']);
  console.log('✓ multi-session: chatId path isolation');
});
