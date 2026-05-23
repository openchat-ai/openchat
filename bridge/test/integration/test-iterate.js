import('./src/core/multi-agent-coordinator.js').then(async ({ multiAgentCoordinator }) => {
  console.log('Testing iterative review loop...');
  const result = await multiAgentCoordinator.iterativeReviewLoop(
    'Write a simple JavaScript function that adds two numbers',
    { maxLoops: 2 }
  );
  console.log('Done, success:', result.success);
  console.log('Iterations:', result.iterations);
  console.log('Final result preview:', result.finalResult?.substring(0, 200));
  process.exit(0);
});