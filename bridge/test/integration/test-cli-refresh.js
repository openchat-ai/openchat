import('./src/memory/persistent-config.js').then(async m => {
  // Switch to baidu provider
  m.persistentConfig.setPreference('currentProvider', 'baidu-qianfan-coding-plan');
  console.log('已切换到 baidu-qianfan-coding-plan');
  
  // Test sync command functionality
  const { commands } = await import('./src/cli/commands.js');
  console.log('Available sync methods:');
  console.log('1. commands.provider([\'--sync\', \'baidu-qianfan-coding-plan\'])');
  console.log('2. commands.upgrade([\'--sync\', \'baidu-qianfan-coding-plan\'])');
  
  process.exit(0);
});