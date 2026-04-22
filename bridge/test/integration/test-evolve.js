import('../../src/core/multi-agent-coordinator.js').then(async ({ multiAgentCoordinator }) => {
  console.log('🚀 Starting evolution test...');
  console.log('🤖 Agent System Initializing...\n');

  try {
    const result = await multiAgentCoordinator.evolutionLoop('test module', 'say hello in 3 words');
    console.log('\n✅ Evolution completed');
    console.log('📊 Result:', result.success ? 'SUCCESS' : 'FAILED');
    process.exit(0);
  } catch (e) {
    console.error('❌ Evolution failed:', e.message);
    process.exit(1);
  }
});