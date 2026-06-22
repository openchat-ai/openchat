import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const filePath = resolve(__dirname, 'src/experiments/experiments-all.mjs');
const N = String.fromCharCode(10);
const c = readFileSync(filePath, 'utf8');
const lines = c.split(N);

const fileDir = dirname(filePath);

// Find all static imports and check if the file exists
const importRe = /^import\s+(?:\{[^}]+\}\s+from\s+|\w+\s+from\s+|\*\s+as\s+\w+\s+from\s+)?['"]([^'"]+)['"]/;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(importRe);
  if (m) {
    const importPath = m[1];
    // Skip node: and package imports
    if (importPath.startsWith('node:') || !importPath.startsWith('.')) continue;
    const fullPath = resolve(fileDir, importPath);
    if (!existsSync(fullPath)) {
      console.log('Line ' + (i+1) + ': ' + lines[i] + ' → ' + importPath);
    }
  }
}
