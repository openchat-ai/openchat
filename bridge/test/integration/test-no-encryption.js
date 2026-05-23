import('./src/cli/commands.js').then(async ({ commands }) => {
  console.log('Testing provider command...');
  
  // Test provider command to see all providers
  await commands.provider([]);
  
  process.exit(0);
});