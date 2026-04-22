import('./src/core/multi-agent-coordinator.js').then(async ({ multiAgentCoordinator }) => {
  console.log('Testing agent spawn...');
  try {
    const agent = await multiAgentCoordinator.spawnAgent('test', {
      name: 'TestAgent',
      provider: 'minimax-coding-plan',
      model: 'MiniMax-M2.7'
    });
    console.log('Agent spawned successfully');
    
    console.log('Testing agent run...');
    const result = await agent.run('Say: Test successful');
    console.log('Agent run result preview:', result.content?.substring(0, 100));
    
    agent.cleanup();
    console.log('Test completed');
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
});