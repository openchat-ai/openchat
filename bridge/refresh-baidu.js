import('./src/memory/persistent-config.js').then(async m => {
  console.log('Refreshing Baidu Qianfan models...');
  const { syncModelsForProvider } = await import('../scripts/upgrade-providers.js');
  
  // Use the API key we set earlier
  const apiKey = m.persistentConfig.getApiKey('baidu-qianfan-coding-plan');
  console.log('API Key for Baidu:', apiKey ? 'Exists' : 'Not found');
  
  if (apiKey && apiKey !== 'your-baidu-api-key-here') {
    const result = await syncModelsForProvider('baidu-qianfan-coding-plan', apiKey);
    console.log('Sync result:', result);
  } else {
    console.log('Using placeholder API key, will sync with known models only');
    const result = await syncModelsForProvider('baidu-qianfan-coding-plan', 'placeholder');
    console.log('Sync result:', result);
  }
  
  // Check updated provider
  const { providerManager } = await import('./src/memory/provider-manager.js');
  const provider = providerManager.getProvider('baidu-qianfan-coding-plan');
  console.log('Updated provider models:', provider?.models?.length || 0, 'models');
  console.log('Sample models:', provider?.models?.slice(0, 5));
  
  process.exit(0);
});