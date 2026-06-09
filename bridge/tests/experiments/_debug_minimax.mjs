import { persistentConfig } from '../../src/core/persistent-config.js';
import { createProvider } from 'provider-kit';

const cfg = persistentConfig.config;
console.log('current provider:', cfg.current?.provider, cfg.current?.model);

const provider = createProvider(cfg.current?.provider, cfg.providers?.[cfg.current?.provider]?.apiKey);
await provider.connect(cfg.providers?.[cfg.current?.provider]?.apiKey);

try {
  // Test with tools (this is what the dev-repl does)
  const resp = await provider.chat(cfg.current?.model, [
    { role: 'system', content: 'Say hello' },
    { role: 'user', content: 'hi' },
  ], { tools: [
    { type: 'function', function: { name: 'get_cwd', description: 'Get cwd', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'exec_command', description: 'Run command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  ]});
  console.log('response:', JSON.stringify(resp).slice(0, 500));
} catch (e) {
  console.log('ERROR name:', e.constructor.name);
  console.log('ERROR message:', e.message);
  console.log('ERROR stack:', e.stack?.split('\n').slice(0, 3).join('\n'));
  if (e.response) console.log('ERROR response:', typeof e.response === 'string' ? e.response.slice(0, 500) : JSON.stringify(e.response).slice(0, 500));
  if (e.statusCode) console.log('statusCode:', e.statusCode);
  if (e.status) console.log('status:', e.status);
  if (e.body) console.log('body:', typeof e.body === 'string' ? e.body.slice(0, 500) : JSON.stringify(e.body).slice(0, 500));
}
