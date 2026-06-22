#!/usr/bin/env node
import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function* walk(dir, pattern) {
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
];

if (testFiles.length === 0) {
  console.log('No test files found.');
  process.exit(0);
}

const { run } = await import('node:test');
await run({ files: testFiles, timeout: 30_000 });
