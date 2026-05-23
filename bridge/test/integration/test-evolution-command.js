import('./src/cli/commands.js').then(async ({ commands }) => {
  console.log('Testing evolution command...');
  
  // Test evolution stats
  await commands.evolution([]);
  
  process.exit(0);
});