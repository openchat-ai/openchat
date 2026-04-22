import('./src/cli/commands.js').then(async ({ commands }) => {
  console.log('Testing provider command help...');
  
  // Call the provider function without arguments to show help
  await commands.provider([]);
  
  process.exit(0);
});