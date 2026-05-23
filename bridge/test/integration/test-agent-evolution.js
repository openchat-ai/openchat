import('./src/core/agent-session.js').then(async (m) => {
  console.log('Testing AgentSession with evolution...');
  
  // Create a test agent
  const crypto = await import('crypto');
  const agent = new m.AgentSession(crypto.randomUUID(), {
    name: 'TestEvolution',
    provider: 'minimax-coding-plan',
    model: 'MiniMax-M2.7'
  });
  
  console.log('Agent created with evolution engine');
  console.log('Evolution engine available:', !!agent.evolutionEngine);
  
  // Test the analyzeExperience method
  await agent.evolutionEngine.analyzeExperience(
    'Write a simple function',
    'function hello() { console.log("Hello World"); }',
    { test: true }
  );
  
  const stats = agent.evolutionEngine.getStats();
  console.log('Evolution stats after test:', stats);
  
  agent.cleanup();
  console.log('Test completed');
  
  process.exit(0);
});