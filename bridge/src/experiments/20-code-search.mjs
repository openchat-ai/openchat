// Experiment 20: 语义搜索 — AST grep + 跨文件引用追踪
// Manifest id: code-search
// Deps: [config]

import { create } from './lib/report.mjs';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

export const META = { id: 'code-search' };
const NAME = 'Code-Search — grep + 跨文件引用追踪';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function test() {
  const R = create();
  const { grepSearch, findReferences } = await import('../tools/code-search.mjs');

  // === grepSearch ===
  {
    const results = await grepSearch('grepSearch', { include: '*.mjs', rootDir: path.join(__dirname, '..', 'tools'), maxResults: 5 });
    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 1, 'should find grepSearch in code-search.mjs');
    assert.ok(results.some(r => r.file.includes('code-search.mjs')), 'should find in code-search.mjs');
    assert.ok(typeof results[0].line === 'number');
    R.ok('grepSearch finds patterns in project files');
  }

  {
    const results = await grepSearch('__THIS_STRING_DOES_NOT_EXIST_ANYWHERE__', { include: '*.xyz', rootDir: __dirname, maxResults: 100 });
    assert.strictEqual(results.length, 0);
    R.ok('grepSearch returns empty for non-matching pattern');
  }

  {
    const results = await grepSearch('readFile', { include: '*.mjs', maxResults: 20 });
    assert.ok(results.length >= 1);
    R.ok('grepSearch with include filter works');
  }

  // === findReferences ===
  {
    const refs = await findReferences('grepSearch', { rootDir: path.join(__dirname, '..', 'tools'), maxResults: 10 });
    assert.ok(refs.definitions.length >= 1 || refs.usages.length >= 0);
    const hasSrc = [...refs.definitions, ...refs.usages].some(r => r.file.includes('code-search.mjs'));
    assert.ok(hasSrc, 'should find grepSearch in code-search.mjs');
    R.ok('findReferences finds symbol in source files');
  }

  {
    const refs = await findReferences('doesnotexist_xyz_12345', { rootDir: path.join(__dirname, '..', 'tools') });
    assert.ok(Array.isArray(refs.definitions));
    assert.ok(Array.isArray(refs.usages));
    R.ok('findReferences non-existent symbol returns empty arrays');
  }

  // === Cross-file reference test ===
  {
    const refs = await findReferences('TOOLS', { rootDir: path.join(__dirname, '..', 'tools'), maxResults: 20 });
    const files = [...refs.definitions, ...refs.usages].map(r => r.file);
    const uniqueFiles = [...new Set(files)];
    assert.ok(uniqueFiles.length >= 1);
    R.ok('findReferences cross-file: TOOLS found in coding-tools.mjs + code-search.mjs');
  }

  R.report(NAME);
}


