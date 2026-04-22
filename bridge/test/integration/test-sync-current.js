import('./src/cli/commands.js').then(async ({ commands }) => {
  console.log('Testing provider --sync-current...');
  
  // Call the provider function with --sync-current
  await commands.provider(['--sync-current']);
  
  process.exit(0);
});