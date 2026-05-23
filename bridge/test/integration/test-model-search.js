import('./src/cli/commands.js').then(async ({ commands }) => {
  console.log('Testing model search for GLM...');
  
  // Search for GLM models
  await commands.model(['baidu-qianfan-coding-plan', 'glm']);
  
  process.exit(0);
});