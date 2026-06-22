#!/usr/bin/env node
import { readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { spawnSync } from 'child_process';

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function* walk(dir, pattern) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full, pattern);
    else if (pattern.test(entry)) yield full;
  }
}

const testFiles = [
  ...walk(join(ROOT, 'src/core/__tests__'), /\.test\.(js|mjs)$/),
  ...walk(join(ROOT, 'tests'), /\.test\.(js|mjs)$/),
].filter(f => !relative(ROOT, f).replace(/\\/g, '/').startsWith('tests/contract'));

if (testFiles.length === 0) {
  console.log('No test files found.');
  process.exit(0);
}

console.log(`Running ${testFiles.length} test files...`);
const result = spawnSync(process.execPath, ['--test', '--test-force-exit', ...testFiles], {
  cwd: ROOT,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);

