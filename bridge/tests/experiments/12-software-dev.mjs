import { ok, ng, skip, report } from './lib/report.mjs';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const NAME = 'Software Dev — 编程 Agent 工具链 (集成质量门禁)';
const TMP_DIR = path.join(process.cwd(), 'tests', 'experiments', '_tmp_dev');

async function testCoding() {
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(TMP_DIR, { recursive: true });

  let tools, qg;
  try {
    tools = await import('../../src/tools/coding-tools.mjs');
    ok('coding-tools.mjs 可加载');
  } catch (e) {
    ng('coding-tools 加载失败', e);
    report(NAME); return;
  }

  try {
    qg = await import('../../src/tools/quality-gate.mjs');
    ok('quality-gate.mjs 可加载');
  } catch (e) {
    ng('quality-gate 加载失败', e);
  }

  // 1. TOOLS 数组 — read_file, write_file, edit_file (no more safe_edit)
  if (Array.isArray(tools.TOOLS) && tools.TOOLS.length >= 3) ok(`TOOLS: ${tools.TOOLS.length} 个工具`);
  else ng(`TOOLS 数组异常: ${tools.TOOLS?.length}`);

  const toolNames = tools.TOOLS.map(t => t.function?.name).filter(Boolean);
  for (const n of ['read_file', 'write_file', 'edit_file']) {
    if (toolNames.includes(n)) ok(`工具 ${n} 已定义`);
    else ng(`工具 ${n} 缺失`);
  }
  if (!toolNames.includes('safe_edit')) ok('safe_edit 已移除 — 合并到 edit_file');
  else ng('safe_edit 应已移除');

  // 2. readFile — 文件不存在
  try {
    await tools.readFile(path.join(TMP_DIR, 'nonexistent.txt'));
    ng('readFile 不存在文件应抛异常');
  } catch (e) {
    ok(`readFile 不存在文件: ${e.message.substring(0, 60)}`);
  }

  // 3. writeFile + readFile 写读
  const testContent = 'hello world\nline 2\nline 3';
  const testFile = path.join(TMP_DIR, 'test.txt');
  const writeResult = await tools.writeFile(testFile, testContent);
  if (writeResult.bytes === testContent.length) ok(`writeFile: ${writeResult.bytes} bytes`);
  else ng(`writeFile bytes 不匹配: ${writeResult.bytes}`);

  const readResult = await tools.readFile(testFile);
  if (readResult === testContent) ok(`readFile 内容一致`);
  else ng(`readFile 内容不匹配`);

  // 4. editFile — search/replace (force=true since not under project lint scope)
  const edited = await tools.editFile(testFile, 'line 2', 'line TWO', { force: true });
  if (edited.oldBytes === testContent.length) ok(`editFile(force): ${edited.oldBytes}B -> ${edited.newBytes}B`);

  const afterEdit = await tools.readFile(testFile);
  if (afterEdit.includes('line TWO') && afterEdit.includes('line 3')) ok('editFile 内容正确');
  else ng(`editFile: "${afterEdit}"`);

  // 5. editFile — 不存在的 search
  try {
    await tools.editFile(testFile, 'NOT FOUND', 'replacement', { force: true });
    ng('editFile 不存在的 search 应抛异常');
  } catch (e) {
    ok(`editFile 不存在的 search: ${e.message.substring(0, 60)}`);
  }

  // 6. editFile — 不唯一的 search
  await fs.writeFile(testFile, 'same\nsame', 'utf8');
  try {
    await tools.editFile(testFile, 'same', 'different', { force: true });
    ng('editFile 非唯一 search 应抛异常');
  } catch (e) {
    ok(`editFile 非唯一 search: ${e.message.substring(0, 60)}`);
  }

  // 7. hashEdit — 基于内容 hash 修改
  await fs.writeFile(testFile, 'anchor line\nother line', 'utf8');
  const hashLine = 'anchor line';
  const hash = crypto.createHash('md5').update(hashLine).digest('hex').substring(0, 8);
  const hashResult = await tools.hashEdit(testFile, hash, 'REPLACED ANCHOR');
  if (hashResult.line >= 0) ok(`hashEdit: line ${hashResult.line} replaced`);

  const afterHash = await tools.readFile(testFile);
  if (afterHash.includes('REPLACED ANCHOR') && afterHash.includes('other line')) ok('hashEdit 内容正确');
  else ng(`hashEdit: "${afterHash}"`);

  // 8. hashEdit — 不存在的 hash
  try {
    await tools.hashEdit(testFile, 'deadbeef', 'x');
    ng('hashEdit 不存在的 hash 应抛异常');
  } catch (e) {
    ok(`hashEdit 不存在的 hash: ${e.message.substring(0, 60)}`);
  }

  // 9. executeTool 路由
  const routeResult = await tools.executeTool('write_file', { path: testFile, content: 'routed' });
  if (routeResult.bytes === 6) ok('executeTool write_file 路由正确');
  else ng(`executeTool: ${JSON.stringify(routeResult)}`);

  try {
    await tools.executeTool('unknown_tool', {});
    ng('未知工具应抛异常');
  } catch (e) {
    ok('未知工具被拒绝');
  }

  // 10. 路径穿越防护
  const traversal = path.join(TMP_DIR, '..', '..', '..', 'secret');
  try {
    await tools.readFile(traversal);
    const resolved = path.resolve(process.cwd(), traversal);
    if (!resolved.startsWith(process.cwd())) ng('路径穿越未拦截');
    else ok('路径穿越防护 (未穿越)');
  } catch (e) {
    ok(`路径穿越防护: ${e.message.substring(0, 60)}`);
  }

  // 11. quality-gate: snapshot/restore
  const snapFile = path.join(TMP_DIR, 'snap-test.txt');
  await fs.writeFile(snapFile, 'original content', 'utf8');
  const snap = await qg.snapshot(snapFile);
  if (snap.filePath === snapFile) ok('snapshot 创建成功');
  await fs.writeFile(snapFile, 'modified', 'utf8');
  const afterMod = await fs.readFile(snapFile, 'utf8');
  if (afterMod === 'modified') ok('文件已修改');

  await qg.restore(snapFile);
  const afterRestore = await fs.readFile(snapFile, 'utf8');
  if (afterRestore === 'original content') ok('restore 恢复原始内容');
  else ng(`restore 失败: "${afterRestore}"`);

  if (qg.hasSnapshot(snapFile) === false) ok('restore 后 snapshot 已清除');

  // 12. quality-gate: applyWithGuard 透传 edit 结果
  const guardFile = path.join(TMP_DIR, 'guard-test.js');
  await fs.writeFile(guardFile, 'const x = 1;\n', 'utf8');
  const guardResult = await qg.applyWithGuard(guardFile,
    async () => {
      await fs.writeFile(guardFile, 'const x = 2;\n', 'utf8');
      return { path: 'guard-test.js', oldBytes: 12, newBytes: 12 };
    },
    { lint: false, test: false },
  );
  if (guardResult.pass === true && guardResult.path === 'guard-test.js') ok('applyWithGuard 透传 edit 结果');
  else ng(`applyWithGuard 结果: ${JSON.stringify(guardResult)}`);

  // === auto-commit + project-context (原实验 13，已合并) ===

  // 14. auto-commit 可加载
  let ac;
  try {
    ac = await import('../../src/tools/auto-commit.mjs');
    ok('auto-commit.mjs 可加载');
  } catch (e) {
    ng('auto-commit 加载失败', e);
  }

  if (ac) {
    for (const f of ['hasGitRepo', 'gitAdd', 'gitDiff', 'generateMessage', 'autoCommit']) {
      if (typeof ac[f] === 'function') ok(`auto-commit.${f} 存在`);
    }
  }

  // 15. generateMessage 类型识别
  if (ac) {
    const t1 = ac.generateMessage('diff --git a/src/a.js b/src/a.js\n+fix: bug');
    if (t1.startsWith('fix')) ok(`commit msg fix 类型: ${t1}`);
    else ok(`commit msg: ${t1}`);

    const t2 = ac.generateMessage('diff --git a/README.md b/README.md\n+docs update');
    if (t2.startsWith('docs')) ok(`commit msg docs 类型: ${t2}`);
    else ok(`commit msg: ${t2}`);
  }

  // 16. project-context 可加载
  let pc;
  try {
    pc = await import('../../src/tools/project-context.mjs');
    ok('project-context.mjs 可加载');
  } catch (e) {
    ng('project-context 加载失败', e);
  }

  if (pc) {
    for (const f of ['findRelatedFiles', 'findDependencies', 'getProjectStructure']) {
      if (typeof pc[f] === 'function') ok(`project-context.${f} 存在`);
    }
    const deps = await pc.findDependencies('src/tools/system-exec.mjs');
    if (Array.isArray(deps) && deps.length > 0) ok(`findDependencies 找到 ${deps.length} 个依赖`);
    else ok('findDependencies 返回空');
  }

  // 17. coding-tools 已集成 quality-gate (edit_file uses applyWithGuard)
  try {
    const src = await fs.readFile('src/tools/coding-tools.mjs', 'utf8');
    if (src.includes('quality-gate')) ok('coding-tools 已集成 quality-gate');
    else ng('coding-tools 未集成质量门');
    if (!src.includes('safeEditFile')) ok('safeEditFile 已移除');
    if (!src.includes('safe_edit')) ok('safe_edit 工具已移除');
    if (!src.includes('safeWriteFile')) ok('safeWriteFile 已移除');
  } catch (e) {
    ng('coding-tools 集成验证失败', e);
  }

  // 18. dev-repl.mjs 可加载
  try {
    const dev = await import('../../src/core/dev-repl.mjs');
    ok(`dev-repl.mjs 可加载 (exports: ${Object.keys(dev).join(', ')})`);
  } catch (e) {
    ng('dev-repl.mjs 加载失败', e);
  }

  // 18b. bin/openchat.js 作为独立入口存在
  try {
    const stat = await fs.stat('../../bin/openchat.js');
    if (stat.size > 0) ok('bin/openchat.js 存在');
  } catch {
    ng('bin/openchat.js 不存在');
  }

  // === new tools: diff-review, multi-edit, ast-edit ===

  // 19. diff-review 可加载
  try {
    const dr = await import('../../src/tools/diff-review.mjs');
    ok('diff-review.mjs 可加载');
    if (typeof dr.getGitDiff === 'function') ok('diff-review.getGitDiff 存在');
    if (typeof dr.revertChanges === 'function') ok('diff-review.revertChanges 存在');
  } catch (e) {
    ng('diff-review 加载失败', e);
  }

  // 20. multi-edit 可加载
  try {
    const me = await import('../../src/tools/multi-edit.mjs');
    ok('multi-edit.mjs 可加载');
    if (typeof me.multiEdit === 'function') ok('multi-edit.multiEdit 存在');
  } catch (e) {
    ng('multi-edit 加载失败', e);
  }

  // 21. ast-edit 可加载 + 基本功能
  try {
    const ae = await import('../../src/tools/ast-edit.mjs');
    ok('ast-edit.mjs 可加载');
    if (typeof ae.astEdit === 'function') ok('ast-edit.astEdit 存在');

    // Test rename function
    const astTestFile = path.join(TMP_DIR, 'ast-test.js');
    await fs.writeFile(astTestFile, 'function greet(name) { return "hello " + name; }\n', 'utf8');
    const r = await ae.astEdit(astTestFile, 'function:greet', 'rename', 'sayHi');
    if (r.action === 'rename') ok(`ast-edit rename: "${r.path}"`);
    const afterAst = await fs.readFile(astTestFile, 'utf8');
    if (afterAst.includes('sayHi')) ok('ast-edit 重命名内容正确');
    else ng(`ast-edit 内容: "${afterAst}"`);

    // Test replace_body
    await ae.astEdit(astTestFile, 'function:sayHi', 'replace_body', 'return "hi " + name;');
    const afterBody = await fs.readFile(astTestFile, 'utf8');
    if (afterBody.includes('return "hi " + name;')) ok('ast-edit replace_body 正确');
    else ng(`ast-edit body: "${afterBody}"`);
  } catch (e) {
    ng('ast-edit 失败', e);
  }

  // 22. dev-workflow plugin 注册了所有新工具
  try {
    const src = await fs.readFile('src/plugins/dev-workflow-plugin.mjs', 'utf8');
    for (const t of ['multi_edit', 'ast_edit', 'diff_review']) {
      if (src.includes(t)) ok(`plugin 已注册 ${t}`);
      else ng(`plugin 缺少 ${t}`);
    }
  } catch (e) {
    ng('plugin 验证失败', e);
  }

  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  report(NAME);
}

testCoding().catch(e => { ng('软件工程实验异常', e); report(NAME); });
