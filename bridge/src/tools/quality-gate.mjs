// Quality gate: snapshot → verify → rollback pipeline.
// === invariants ===
// - applyWithGuard() saves original, runs edit, verifies, rollbacks on failure
// - snapshot store is in-memory Map<filePath, {content, ts}>
// - runLint() calls npm run lint in project root, returns {pass, output}
// - runTests() calls npm test -- --findRelatedTests, returns {pass, output, failedTests[]}
// - restore() writes original content back
// - applyWithGuard passes through the editFn return value on success

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const _snapshots = new Map();
const PROJECT_ROOT = process.cwd();

export async function snapshot(filePath) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  const content = await fs.readFile(resolved, 'utf8');
  _snapshots.set(filePath, { content, ts: Date.now() });
  return { filePath, bytes: content.length };
}

export async function restore(filePath) {
  const snap = _snapshots.get(filePath);
  if (!snap) throw new Error(`No snapshot for ${filePath}`);
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  await fs.writeFile(resolved, snap.content, 'utf8');
  _snapshots.delete(filePath);
  return { filePath, restoredBytes: snap.content.length };
}

export function hasSnapshot(filePath) {
  return _snapshots.has(filePath);
}

export function runLint(cwd = PROJECT_ROOT) {
  try {
    const out = execSync('npm run lint 2>&1', { cwd, encoding: 'utf8', timeout: 30000, windowsHide: true });
    return { pass: true, output: out.trim() };
  } catch (e) {
    return { pass: false, output: (e.stdout || '').trim() || e.message };
  }
}

export function runTests(testPaths = [], cwd = PROJECT_ROOT) {
  try {
    const opt = testPaths.length ? ` -- ${testPaths.join(' ')}` : '';
    const out = execSync(`npm test${opt} 2>&1`, { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true });
    return { pass: true, output: out.trim(), failedTests: [] };
  } catch (e) {
    const output = (e.stdout || '').trim() || e.message;
    const failedTests = _extractFailedTests(output);
    return { pass: false, output, failedTests };
  }
}

// Apply edit with guard: snapshot → edit → verify → rollback on failure
export async function applyWithGuard(filePath, editFn, options = {}) {
  const { lint = true, test = false, testPaths = [] } = options;
  await snapshot(filePath);
  let editResult;
  try {
    editResult = await editFn();
  } catch (e) {
    await restore(filePath);
    return { pass: false, step: 'edit', error: e.message };
  }
  if (lint) {
    const lintResult = runLint();
    if (!lintResult.pass) {
      await restore(filePath);
      return { pass: false, step: 'lint', output: lintResult.output };
    }
  }
  if (test) {
    const testResult = runTests(testPaths);
    if (!testResult.pass) {
      await restore(filePath);
      return { pass: false, step: 'test', output: testResult.output, failedTests: testResult.failedTests };
    }
  }
  // All passed — keep change, clear snapshot
  _snapshots.delete(filePath);
  return { pass: true, ...editResult };
}

function _extractFailedTests(output) {
  const failed = [];
  const patterns = [
    /FAIL\s+(\S+)/g,
    /✗\s+(\S+)/g,
    /×\s+(\S+)/g,
    /●\s+(.+)/g,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(output)) !== null) failed.push(m[1]);
  }
  return [...new Set(failed)];
}
