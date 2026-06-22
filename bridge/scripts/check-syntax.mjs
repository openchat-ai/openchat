#!/usr/bin/env node
// scripts/check-syntax.mjs — syntax check all .mjs and .js files under src/
// Usage: node scripts/check-syntax.mjs

import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (['.mjs', '.js'].includes(extname(full))) yield full;
  }
}

let pass = 0, fail = 0;
const failures = [];
for (const file of walk(SRC)) {
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
    pass++;
  } catch (e) {
    fail++;
    failures.push(file);
  }
}

console.log(`✓ ${pass} files pass, ✗ ${fail} files fail`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ' + f);
  process.exit(1);
}
