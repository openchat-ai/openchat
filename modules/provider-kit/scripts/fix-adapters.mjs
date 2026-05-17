import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const adapters = [
  'anthropic-adapter', 'azure-adapter', 'bedrock-adapter',
  'cohere-adapter', 'gemini-adapter', 'local-provider'
];

for (const name of adapters) {
  const fp = `src/providers/${name}.js`;
  let c = readFileSync(fp, 'utf8');

  c = c.replace(/[^\x00-\x7F\n\r]+/g, '');
  c = c.replace(/\n\s*\n\s*\n/g, '\n\n');

  if (!c.includes('ProviderError')) {
    c = `import { ProviderError } from './provider-error-adapter.js';\n${c}`;
  }

  c = c.replace(/new Error\(/g, 'new ProviderError(');
  writeFileSync(fp, c);

  try {
    execSync(`node --check "${fp}"`, { stdio: 'pipe' });
    console.log(`${name}: OK`);
  } catch (e) {
    console.log(`${name}: FAIL`);
  }
}
