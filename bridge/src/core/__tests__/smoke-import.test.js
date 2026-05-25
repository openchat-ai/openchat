import { test } from 'node:test';
import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const srcDir = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:').replace(/\/$/, '');

function walk(root) {
  const files = [];
  for (const e of readdirSync(root)) {
    const p = join(root, e);
    if (statSync(p).isDirectory()) {
      if (e.startsWith('__') || e === 'node_modules') continue;
      files.push(...walk(p));
    } else if (e.endsWith('.js') || e.endsWith('.mjs')) {
      files.push(p);
    }
  }
  return files;
}

test('all src/ files pass node --check syntax', () => {
  const files = walk(srcDir);
  const errors = [];
  for (const f of files) {
    try {
      execSync(`node --check "${f}"`, { stdio: 'pipe', timeout: 10000, shell: true });
    } catch (e) {
      const msg = (e.stderr || e.stdout || '').toString();
      // Skip CJS files that fail only because they use require() in ESM mode
      if (msg.includes('require is not defined') ||
          msg.includes('Cannot use import statement outside')) {
        continue;
      }
      errors.push(f.replace(srcDir, ''));
    }
  }
  if (errors.length > 0) {
    throw new Error(`Syntax errors in:\n${errors.join('\n')}`);
  }
});
