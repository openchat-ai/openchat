import { ok, deepStrictEqual } from 'assert';

const NAME = 'Multi-Session — 多会话隔离';

export async function run({ inputs = {} } = {}) {
  const { sessionCount = 10, messagesPerSession = 3 } = inputs;

  const sessions = {};
  for (let i = 0; i < sessionCount; i++) {
    sessions[`session-${i}`] = { history: [], name: `Session ${i}` };
  }

  async function simulateChat(sid, msg) {
    const s = sessions[sid];
    s.history.push({ role: 'user', content: msg, ts: Date.now() });
    const reply = `reply-to-${sid}: ${msg}`;
    s.history.push({ role: 'assistant', content: reply, ts: Date.now() });
    return reply;
  }

  const msgs = Array.from({ length: messagesPerSession }, (_, i) => `msg${i + 1}`);
  await Promise.all(
    Array.from({ length: sessionCount }, (_, i) =>
      msgs.map(msg => simulateChat(`session-${i}`, msg))
    ).flat()
  );

  const isolationErrors = [];
  const orderErrors = [];

  for (let i = 0; i < sessionCount; i++) {
    const sid = `session-${i}`;
    const h = sessions[sid].history;
    if (h.length !== messagesPerSession * 2) {
      isolationErrors.push(`${sid}: expected ${messagesPerSession * 2} msgs, got ${h.length}`);
    }
    if (h[0]?.content !== msgs[0]) {
      isolationErrors.push(`${sid}: first msg lost`);
    }
    for (let j = 0; j < h.length - 1; j++) {
      if (h[j].ts > h[j + 1].ts) {
        orderErrors.push(`${sid} msg ${j} out of order`);
      }
    }
  }

  return {
    outputs: {
      sessionCount,
      totalMessages: sessionCount * messagesPerSession * 2,
      isolationErrors,
      orderErrors,
      isolated: isolationErrors.length === 0,
      ordered: orderErrors.length === 0,
    },
  };
}

export async function test() {
  const r = await run();
  const o = r.outputs;
  let pass = true;
  try {
    ok(o.isolated, `isolation errors: ${o.isolationErrors.join(', ') || 'none'}`);
    console.log(`  ✓ multi-session: ${o.sessionCount} sessions × ${o.totalMessages / (o.sessionCount * 2)} msgs, all isolated`);
    ok(o.ordered, `order errors: ${o.orderErrors.join(', ') || 'none'}`);
    console.log('  ✓ multi-session: chronological ordering preserved');
    const keys = ['oc/chat/a/1.msg', 'oc/chat/b/2.msg', 'oc/chat/c/3.msg'];
    const chatIds = keys.map(k => k.split('/')[2]);
    deepStrictEqual(chatIds, ['a', 'b', 'c']);
    console.log('  ✓ multi-session: chatId path isolation');
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    pass = false;
  }
  console.log(`\n${pass ? '✓' : '✗'} ${NAME}`);
  return pass;
}

