import('./src/core/multi-agent-coordinator.js').then(async ({ multiAgentCoordinator }) => {
  console.log('Starting test evolution...');
  const result = await multiAgentCoordinator.evolutionLoop('test module', 'say hello in 3 words');
  console.log('Done, success:', result.success);
  process.exit(0);
});