import { readFileSync, writeFileSync } from 'fs';

const files = [
  'anthropic-adapter.js', 'azure-adapter.js', 'bedrock-adapter.js',
  'cohere-adapter.js', 'gemini-adapter.js', 'local-provider.js'
];

for (const f of files) {
  const fp = `src/providers/${f}`;
  let c = readFileSync(fp, 'utf8');
  if (!c.includes('ProviderError')) {
    c = `import { ProviderError } from './provider-error-adapter.js';\n${c}`;
  }
  c = c.replace(/new Error\(/g, 'new ProviderError(');
  writeFileSync(fp, c);
  console.log(`${f} done`);
}
