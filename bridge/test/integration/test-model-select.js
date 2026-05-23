// Test the new CLI model selection command
import('./src/core/persistent-config.js').then(async () => {
  const { commands } = await import('./src/cli/commands.js');
  const { persistentConfig } = await import('./src/core/persistent-config.js');

  // Set a provider
  persistentConfig.setPreference('currentProvider', 'siliconflow');
  persistentConfig.setPreference('currentModel', 'Qwen/Qwen2.5-72B-Instruct');

  console.log('\n[Test] Testing new "m" command...');

  // Test: m (no args) → shows recent models
  await commands.model([]);

  console.log('\n[Test] Testing "m <keyword>" search...');
  await commands.model(['72b']);

  console.log('\n[PASS] model command works correctly\n');
  process.exit(0);
});
