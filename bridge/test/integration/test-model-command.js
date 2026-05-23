import('./src/cli/commands.js').then(async ({ commands }) => {
  console.log('Testing model command for baidu-qianfan-coding-plan...');
  
  // Call the model function to list all models for baidu
  await commands.model(['baidu-qianfan-coding-plan']);
  
  process.exit(0);
});