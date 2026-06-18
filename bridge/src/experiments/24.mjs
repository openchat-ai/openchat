// Experiment 12a: 高级编辑 — multi-edit / ast-edit / diff-review
// Manifest id: edit-advanced
// I/O: { op, path?, data? } → result

import { create } from './lib/report.mjs';
import fs from 'fs/promises';
import path from 'path';

export const META = { id: 'edit-advanced' };

const NAME = 'Edit-Advanced — multi-edit / ast-edit / diff-review';
const TMP_DIR = path.join(process.cwd(), 'tests', 'experiments', '_tmp_edit_advanced');

export async function run({ inputs = {} } = {}) {
  const { op = 'test' } = inputs;
  if (op === 'test') { await testEditAdvanced(); return { outputs: { ok: true } }; }
  if (op === 'multiEdit') {
    const { multiEdit } = await import('../experiments/lib/multi-edit.mjs');
    return { outputs: await multiEdit(inputs.edits) };
  }
  if (op === 'astEdit') {
    const { astEdit } = await import('../experiments/lib/ast-edit.mjs');
    return { outputs: await astEdit(inputs.file, inputs.pattern, inputs.action, inputs.newValue) };
  }
  if (op === 'getGitDiff') {
    const { getGitDiff } = await import('../experiments/lib/diff-review.mjs');
    return { outputs: await getGitDiff(inputs.base) };
  }
  throw new Error(`edit-advanced: unknown op "${op}"`);
}

async function testEditAdvanced() {
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(TMP_DIR, { recursive: true });

  const r = create();

  // 1. multi-edit 可加载
  let me;
  try {
    me = await import('./lib/multi-edit.mjs');
    r.ok('multi-edit.mjs 可加载');
    if (typeof me.multiEdit === 'function') r.ok('multiEdit 函数存在');
    else r.ng('multiEdit 缺失');
  } catch (e) {
    r.ng('multi-edit 加载失败', e);
  }

  // 2. ast-edit 可加载 + rename / replace_body
  let ae;
  try {
    ae = await import('./lib/ast-edit.mjs');
    r.ok('ast-edit.mjs 可加载');
    if (typeof ae.astEdit === 'function') r.ok('astEdit 函数存在');
    else r.ng('astEdit 缺失');

    const astTestFile = path.join(TMP_DIR, 'ast-test.js');
    await fs.writeFile(astTestFile, 'function greet(name) { return "hello " + name; }\n', 'utf8');
    const r1 = await ae.astEdit(astTestFile, 'function:greet', 'rename', 'sayHi');
    if (r1.action === 'rename') r.ok(`ast-edit rename: "${r1.path}"`);
    const afterAst = await fs.readFile(astTestFile, 'utf8');
    if (afterAst.includes('sayHi')) r.ok('ast-edit 重命名内容正确');
    else r.ng(`ast-edit 内容: "${afterAst}"`);

    await ae.astEdit(astTestFile, 'function:sayHi', 'replace_body', 'return "hi " + name;');
    const afterBody = await fs.readFile(astTestFile, 'utf8');
    if (afterBody.includes('return "hi " + name;')) r.ok('ast-edit replace_body 正确');
    else r.ng(`ast-edit body: "${afterBody}"`);
  } catch (e) {
    r.ng('ast-edit 失败', e);
  }

  // 3. diff-review 可加载
  let dr;
  try {
    dr = await import('./lib/diff-review.mjs');
    r.ok('diff-review.mjs 可加载');
    if (typeof dr.getGitDiff === 'function') r.ok('getGitDiff 存在');
    if (typeof dr.revertChanges === 'function') r.ok('revertChanges 存在');
  } catch (e) {
    r.ng('diff-review 加载失败', e);
  }

  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  r.report(NAME);
}

export { testEditAdvanced, testEditAdvanced as test };
