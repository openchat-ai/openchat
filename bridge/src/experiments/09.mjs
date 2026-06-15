// Experiment 12: 编程工具核心 — coding-tools + quality-gate
// Manifest id: coding
// I/O: { op, path, content?, search?, replace?, options? } → result

import { create } from './lib/report.mjs';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const META = { id: 'coding' };

const NAME = 'Coding — 编程工具核心 (coding-tools + quality-gate)';
const TMP_DIR = path.join(process.cwd(), 'tests', 'experiments', '_tmp_coding');

// compose 契约入口：通过 coding-tools 执行文件操作
//   inputs: { op, path, content?, search?, replace?, hash?, newContent?, options?, force? }
//   outputs: { result }
export async function run({ inputs = {} } = {}) {
  const { op } = inputs;
  if (!op) throw new Error('coding.run: op required');
  const tools = await import('./lib/coding-tools.mjs');
  const args = { ...inputs };
  delete args.op;
  let result;
  switch (op) {
    case 'read_file':
      result = await tools.readFile(args.path);
      break;
    case 'write_file':
      result = await tools.writeFile(args.path, args.content);
      break;
    case 'edit_file':
      result = await tools.editFile(args.path, args.search, args.replace, args);
      break;
    case 'hash_edit':
      result = await tools.hashEdit(args.path, args.hash, args.newContent);
      break;
    default:
      result = await tools.executeTool(op, args);
  }
  return { outputs: { result } };
}

async function testCoding() {
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(TMP_DIR, { recursive: true });

  const r = create();

  let tools, qg;
  try {
    tools = await import('./lib/coding-tools.mjs');
    r.ok('coding-tools.mjs 可加载');
  } catch (e) {
    r.ng('coding-tools 加载失败', e);
    r.report(NAME); return;
  }

  try {
    qg = await import('./lib/quality-gate.mjs');
    r.ok('quality-gate.mjs 可加载');
  } catch (e) {
    r.ng('quality-gate 加载失败', e);
  }

  // 1. TOOLS 数组 — read_file, write_file, edit_file (no more safe_edit)
  if (Array.isArray(tools.TOOLS) && tools.TOOLS.length >= 3) r.ok(`TOOLS: ${tools.TOOLS.length} 个工具`);
  else r.ng(`TOOLS 数组异常: ${tools.TOOLS?.length}`);

  const toolNames = tools.TOOLS.map(t => t.function?.name).filter(Boolean);
  for (const n of ['read_file', 'write_file', 'edit_file']) {
    if (toolNames.includes(n)) r.ok(`工具 ${n} 已定义`);
    else r.ng(`工具 ${n} 缺失`);
  }
  if (!toolNames.includes('safe_edit')) r.ok('safe_edit 已移除 — 合并到 edit_file');
  else r.ng('safe_edit 应已移除');

  // 2. readFile — 文件不存在
  try {
    await tools.readFile(path.join(TMP_DIR, 'nonexistent.txt'));
    r.ng('readFile 不存在文件应抛异常');
  } catch (e) {
    r.ok(`readFile 不存在文件: ${e.message.substring(0, 60)}`);
  }

  // 3. writeFile + readFile 写读
  const testContent = 'hello world\nline 2\nline 3';
  const testFile = path.join(TMP_DIR, 'test.txt');
  const writeResult = await tools.writeFile(testFile, testContent);
  if (writeResult.bytes === testContent.length) r.ok(`writeFile: ${writeResult.bytes} bytes`);
  else r.ng(`writeFile bytes 不匹配: ${writeResult.bytes}`);

  const readResult = await tools.readFile(testFile);
  if (readResult === testContent) r.ok('readFile 内容一致');
  else r.ng('readFile 内容不匹配');

  // 4. editFile — search/replace
  const edited = await tools.editFile(testFile, 'line 2', 'line TWO', { force: true });
  if (edited.oldBytes === testContent.length) r.ok(`editFile(force): ${edited.oldBytes}B -> ${edited.newBytes}B`);

  const afterEdit = await tools.readFile(testFile);
  if (afterEdit.includes('line TWO') && afterEdit.includes('line 3')) r.ok('editFile 内容正确');
  else r.ng(`editFile: "${afterEdit}"`);

  // 5. editFile — 不存在的 search
  try {
    await tools.editFile(testFile, 'NOT FOUND', 'replacement', { force: true });
    r.ng('editFile 不存在的 search 应抛异常');
  } catch (e) {
    r.ok(`editFile 不存在的 search: ${e.message.substring(0, 60)}`);
  }

  // 6. editFile — 不唯一的 search
  await fs.writeFile(testFile, 'same\nsame', 'utf8');
  try {
    await tools.editFile(testFile, 'same', 'different', { force: true });
    r.ng('editFile 非唯一 search 应抛异常');
  } catch (e) {
    r.ok(`editFile 非唯一 search: ${e.message.substring(0, 60)}`);
  }

  // 7. hashEdit
  await fs.writeFile(testFile, 'anchor line\nother line', 'utf8');
  const hashLine = 'anchor line';
  const hash = crypto.createHash('md5').update(hashLine).digest('hex').substring(0, 8);
  const hashResult = await tools.hashEdit(testFile, hash, 'REPLACED ANCHOR');
  if (hashResult.line >= 0) r.ok(`hashEdit: line ${hashResult.line} replaced`);

  const afterHash = await tools.readFile(testFile);
  if (afterHash.includes('REPLACED ANCHOR') && afterHash.includes('other line')) r.ok('hashEdit 内容正确');
  else r.ng(`hashEdit: "${afterHash}"`);

  // 8. hashEdit — 不存在的 hash
  try {
    await tools.hashEdit(testFile, 'deadbeef', 'x');
    r.ng('hashEdit 不存在的 hash 应抛异常');
  } catch (e) {
    r.ok(`hashEdit 不存在的 hash: ${e.message.substring(0, 60)}`);
  }

  // 9. executeTool 路由
  const routeResult = await tools.executeTool('write_file', { path: testFile, content: 'routed' });
  if (routeResult.bytes === 6) r.ok('executeTool write_file 路由正确');
  else r.ng(`executeTool: ${JSON.stringify(routeResult)}`);

  try {
    await tools.executeTool('unknown_tool', {});
    r.ng('未知工具应抛异常');
  } catch (e) {
    r.ok('未知工具被拒绝');
  }

  // 10. 路径穿越防护
  const traversal = path.join(TMP_DIR, '..', '..', '..', 'secret');
  try {
    await tools.readFile(traversal);
    const resolved = path.resolve(process.cwd(), traversal);
    if (!resolved.startsWith(process.cwd())) r.ng('路径穿越未拦截');
    else r.ok('路径穿越防护 (未穿越)');
  } catch (e) {
    r.ok(`路径穿越防护: ${e.message.substring(0, 60)}`);
  }

  // 11. quality-gate: snapshot/restore
  const snapFile = path.join(TMP_DIR, 'snap-test.txt');
  await fs.writeFile(snapFile, 'original content', 'utf8');
  const snap = await qg.snapshot(snapFile);
  if (snap.filePath === snapFile) r.ok('snapshot 创建成功');
  await fs.writeFile(snapFile, 'modified', 'utf8');
  const afterMod = await fs.readFile(snapFile, 'utf8');
  if (afterMod === 'modified') r.ok('文件已修改');

  await qg.restore(snapFile);
  const afterRestore = await fs.readFile(snapFile, 'utf8');
  if (afterRestore === 'original content') r.ok('restore 恢复原始内容');
  else r.ng(`restore 失败: "${afterRestore}"`);

  if (qg.hasSnapshot(snapFile) === false) r.ok('restore 后 snapshot 已清除');

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
  if (guardResult.pass === true && guardResult.path === 'guard-test.js') r.ok('applyWithGuard 透传 edit 结果');
  else r.ng(`applyWithGuard 结果: ${JSON.stringify(guardResult)}`);

  // 13. executeTool 路由: edit_file 直接走 editFile (无运行时拦截 — 协议选用由 LLM 通过 system prompt 决定)
  const gwFile = path.join(TMP_DIR, 'gateway-test.txt');
  const padLines = Array.from({ length: 100 }, (_, i) => `// line ${i} placeholder content here`);
  const targetLine = '    const API_KEY = process.env.OPENAI_LONG_KEY_NAME_FOR_TOKEN_BIAS;';
  padLines[42] = targetLine;
  await fs.writeFile(gwFile, padLines.join('\n'), 'utf8');
  try {
    const gw = await tools.executeTool('edit_file', {
      path: gwFile,
      search: targetLine,
      newStr: '    const API_KEY = process.env.NEW_KEY;',
    });
    if (gw._protocol === undefined) r.ok('executeTool(edit_file) 不做运行时拦截 — 协议选用由 LLM 决定 (system prompt 引导)');
    else r.ng(`意外出现 _protocol: ${JSON.stringify(gw)}`);
    const afterGw = await tools.readFile(gwFile);
    if (afterGw.includes('NEW_KEY') && !afterGw.includes('OPENAI_LONG_KEY')) r.ok('executeTool(edit_file) 内容正确');
    else r.ng(`executeTool(edit_file) 内容错: ${afterGw.substring(0, 80)}...`);
  } catch (e) {
    r.ng(`executeTool(edit_file) 失败: ${e.message.substring(0, 80)}`);
  }

  // 14. executeTool('hash_edit') — LLM 主动选 hash_edit (system prompt 引导)
  await fs.writeFile(gwFile, padLines.join('\n'), 'utf8');
  const targetHash = crypto.createHash('md5').update(targetLine).digest('hex').substring(0, 8);
  try {
    const he = await tools.executeTool('hash_edit', {
      path: gwFile,
      hash: targetHash,
      newContent: '    const API_KEY = process.env.HASH_EDITED;',
    });
    if (he.line === 42) r.ok(`executeTool(hash_edit) 命中第 42 行`);
    else r.ng(`hash_edit 行号错: ${JSON.stringify(he)}`);
    const afterHe = await tools.readFile(gwFile);
    if (afterHe.includes('HASH_EDITED')) r.ok('hash_edit 内容正确');
    else r.ng(`hash_edit 内容错: ${afterHe.substring(0, 80)}...`);
  } catch (e) {
    r.ng(`hash_edit 失败: ${e.message.substring(0, 80)}`);
  }

  // 15. 端到端: hash_edit 节流验证 — 模拟"LLM 看了 prompt 选 hash_edit"的整条数据流
  //     对比 edit_file (整行做 search) vs hash_edit (8 字符 hash) 的 token 消耗
  await fs.writeFile(gwFile, padLines.join('\n'), 'utf8');
  const fileContent = padLines.join('\n');
  // 模拟"LLM 决定用 hash_edit" 时发的工具调用 (基于真实场景: 它读了文件, 知道 hash)
  const hashEditCall = {
    toolName: 'hash_edit',
    args: { path: gwFile, hash: crypto.createHash('md5').update(targetLine).digest('hex').substring(0, 8), newContent: '    const API_KEY = process.env.HASHLINE_OK;' },
  };
  // 模拟"LLM 决定用 edit_file" 时发的工具调用 (整行做 search, 真实 LLM 行为)
  const editFileCall = {
    toolName: 'edit_file',
    args: { path: gwFile, search: targetLine, newStr: '    const API_KEY = process.env.EDIT_FILE_OK;', force: true },
  };
  // 粗略 token 估算 (4 字符 ≈ 1 tok, 公开算法, 与 epc-pipeline.mjs:_estimateTokens 一致)
  const estTokens = s => Math.ceil(String(s).length / 4);
  const hashEditTokens = estTokens(hashEditCall.args.hash) + estTokens(hashEditCall.args.newContent);
  const editFileTokens = estTokens(editFileCall.args.search) + estTokens(editFileCall.args.newStr);

  if (hashEditTokens < editFileTokens) {
    r.ok(`hashline 节流: edit_file=${editFileTokens} tok → hash_edit=${hashEditTokens} tok (省 ${editFileTokens - hashEditTokens} tok = ${Math.round((1 - hashEditTokens / editFileTokens) * 100)}%)`);
  } else {
    r.ng(`hashline 没省: edit=${editFileTokens} hash=${hashEditTokens}`);
  }

  // 端到端: 跑 hash_edit, 验证改对了
  await fs.writeFile(gwFile, padLines.join('\n'), 'utf8');  // 重置
  const hashEditResult = await tools.executeTool(hashEditCall.toolName, hashEditCall.args);
  const afterHashEdit = await tools.readFile(gwFile);
  if (hashEditResult.line === 42 && afterHashEdit.includes('HASHLINE_OK')) {
    r.ok(`hash_edit 端到端: hash=${hashEditResult.line} 命中, 内容正确`);
  } else r.ng(`hash_edit 端到端错: line=${hashEditResult.line}, content="${afterHashEdit.substring(0, 60)}..."`);

  // 端到端: 跑 edit_file, 验证也改对了 (确认两条路径都 work)
  await fs.writeFile(gwFile, padLines.join('\n'), 'utf8');  // 重置
  const editFileResult = await tools.executeTool(editFileCall.toolName, editFileCall.args);
  const afterEditFile = await tools.readFile(gwFile);
  const expectedLen = fileContent.length - (targetLine.length - '    const API_KEY = process.env.EDIT_FILE_OK;'.length);
  if (afterEditFile.includes('EDIT_FILE_OK') && afterEditFile.length === expectedLen) {
    r.ok(`edit_file 端到端: 同样能改, 但浪费 ${editFileTokens - hashEditTokens} tok (字节差 = ${fileContent.length - expectedLen})`);
  } else r.ng(`edit_file 端到端错: 期望 ${expectedLen} 字节, 实际 ${afterEditFile.length} 字节, " ${afterEditFile.substring(0, 60)}..."`);

  // 16. 验证 skeleton-agent 的 SYSTEM_PROMPT 实际包含 guidance — 这是 hash_edit 路径生效的前提
  try {
    const { getEditProtocolGuidance } = await import('../core/epc-pipeline.mjs');
    const guidance = getEditProtocolGuidance();
    if (guidance.includes('hash_edit') && guidance.includes('edit_file') && guidance.includes('write_file')) {
      r.ok(`getEditProtocolGuidance: 含 3 工具名 (${guidance.length} 字符), LLM 可见`);
    } else r.ng(`guidance 缺工具名`);
  } catch (e) {
    r.ng(`guidance 加载失败: ${e.message.substring(0, 60)}`);
  }

  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  r.report(NAME);
}

;
