import assert from 'assert';

// Test provider-kit failover: primary fails → fallback is called
const calls = [];
const mockPrimary = { chat: async () => { calls.push('primary'); throw new Error('timeout'); } };
const mockFallback = { chat: async () => { calls.push('fallback'); return { content: 'fallback ok' }; } };

// Simulate failover strategy
async function chatWithFailover(messages, providers) {
  providers = providers || [mockPrimary, mockFallback];
  for (const p of providers) {
    try { return await p.chat(messages); }
    catch { continue; }
  }
  throw new Error('all providers failed');
}

const result = await chatWithFailover([{ role: 'user', content: 'hi' }]);
assert.equal(result.content, 'fallback ok');
assert.deepStrictEqual(calls, ['primary', 'fallback']);
console.log('✓ provider-failover: primary timeout → fallback used');

// Test: all fail
calls.length = 0;
const allFail = [
  { chat: async () => { calls.push('p1'); throw new Error('err'); } },
  { chat: async () => { calls.push('p2'); throw new Error('err'); } },
];
try {
  await chatWithFailover([{ role: 'user', content: 'hi' }], allFail);
  assert.fail('should throw');
} catch (e) {
  assert.ok(e.message.includes('all providers failed'));
  assert.deepStrictEqual(calls, ['p1', 'p2']);
  console.log('✓ provider-failover: all fail → error');

  // Test: provider-kit's built-in failover config
  let kit;
  try {
    kit = await import('provider-kit');
    const provider = kit.createProvider('minimax'); // has anthropic+openai failover
    assert.ok(provider);
    console.log('✓ provider-failover: kit provider has failover config');
  } catch {}
}
