import('./src/core/agent-session.js').then(async ({ AgentSession }) => {
  const crypto = await import('crypto');
  const session = new AgentSession(crypto.randomUUID(), {
    name: 'BaiduTest',
    provider: 'baidu-qianfan-coding-plan',
    model: 'ERNIE-Speed-Pro-128K'
  });
  console.log('Calling Baidu API...');
  const result = await session.run('Say hello in 3 words');
  console.log('Baidu result:', result.content);
  process.exit(0);
});