import('./src/core/agent-session.js').then(async ({ AgentSession }) => {
  const crypto = await import('crypto');
  const session = new AgentSession(crypto.randomUUID(), {
    name: 'Test',
    provider: 'minimax-coding-plan',
    model: 'MiniMax-M2.7'
  });
  console.log('Calling API...');
  const result = await session.run('Say: Hello from improved API!');
  console.log('Result:', result.content);
  process.exit(0);
});