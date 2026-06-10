// E2E live test v3: M3 + 22.mjs 跑真 feature, 修 backup 在 testCoding rm 范围外
import { run, initProvider } from './src/experiments/22.mjs';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const BACKUP = path.join(os.tmpdir(), 'coding-tools.mjs.e2e.bak');
const TARGET = path.join(process.cwd(), 'src/experiments/lib/coding-tools.mjs');
const RESULT = path.join(process.cwd(), 'e2e_test_result.json');

console.log('[e2e] === 1/4 init ===');
await initProvider();

console.log('[e2e] === 2/4 backup ===');
fs.copyFileSync(TARGET, BACKUP);
const baselineContent = fs.readFileSync(TARGET, 'utf-8');
const baselineTools = baselineContent.match(/^function\s+\w+/gm) || [];
console.log(`[e2e] baseline: ${baselineContent.length} chars, ${baselineTools.length} functions`);

const TASK = `在 bridge/src/experiments/lib/coding-tools.mjs 加一个新 tool 叫 'git_diff', 接参数 { ref?: string, file?: string } (ref 是 git ref 如 'HEAD~1' 或 commit hash, file 是可选文件路径).

实现: 用 child_process.execSync 调 'git diff <ref> -- <file>' 或 'git diff <ref>', 返回 diff 文本 (string). 错误时返回 '[Error] <message>'.

要求:
1. 跟现有 tool 的代码风格保持一致 (export async function + executeTool switch case)
2. 加到 TOOLS 数组末尾 (function.name: 'git_diff', parameters JSON schema 描述 ref + file)
3. 不要修改 lib/code-search.mjs 或其他文件
4. 不要跑 test (test 我会自己跑), 但要确保改完文件不挂

完成后告诉我: (a) 新 tool 加在哪一行 (b) 函数体前 5 行 (c) 是否有报错`;

console.log('[e2e] === 3/4 跑 22.mjs (with retry) ===');
const start = Date.now();
const result = { baseline: { chars: baselineContent.length, fns: baselineTools.length } };
const MAX_ATTEMPTS = 3;
// 窄工具集: 4 个 edit-class, M3 在 39 工具下偏向 build_run 浪费 round. capture_22 验证 OK.
const NARROW_TOOLS = ['read_file', 'edit_file', 'hash_edit', 'write_file'];
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  console.log(`[e2e] attempt ${attempt}/${MAX_ATTEMPTS}`);
  const chatId = `e2e-v3-${attempt}`;
  try {
    const r = await run({ inputs: { text: TASK, chatId, tools: NARROW_TOOLS } });
    result.response = r.outputs.response;
    result.elapsedMs = Date.now() - start;
    result.runOk = true;
    result.attempts = attempt;
    result.chatId = chatId;
    console.log(`[e2e] 跑完, ${(result.elapsedMs/1000).toFixed(1)}s, attempt ${attempt}`);
    console.log('[e2e] response 前 500 字:');
    console.log(String(r.outputs.response).slice(0, 500));
    break;
  } catch (e) {
    console.log(`[e2e] attempt ${attempt} 失败: ${e.message.slice(0, 200)}`);
    result.lastError = e.message;
    if (attempt < MAX_ATTEMPTS) {
      console.log('[e2e] 等 10s 重试...');
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}
if (!result.runOk) {
  result.elapsedMs = Date.now() - start;
  fs.copyFileSync(BACKUP, TARGET);
  fs.unlinkSync(BACKUP);
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2));
  console.log(`[e2e] ${MAX_ATTEMPTS} 次都失败, 详情看 ${RESULT}`);
  process.exit(1);
}

// 立刻存 response (在 testCoding 删 backup 之前)
fs.writeFileSync(RESULT, JSON.stringify(result, null, 2));
console.log(`[e2e] response 已存 ${RESULT}`);

console.log('[e2e] === 4/4 验收 ===');

// (1) file 是否被改
const afterContent = fs.readFileSync(TARGET, 'utf-8');
result.fileModified = (afterContent !== baselineContent);
result.afterChars = afterContent.length;
result.charDelta = afterContent.length - baselineContent.length;
if (result.fileModified) {
  const baseLines = baselineContent.split('\n');
  const afterLines = afterContent.split('\n');
  result.addedLines = afterLines.length - baseLines.length;
  // 保存 modified 内容到独立文件 (在 restore 之前)
  fs.writeFileSync('coding-tools.mjs.modified_by_m3.mjs', afterContent);
  // 找新增的行 (assume 追加)
  if (afterContent.length > baselineContent.length) {
    result.addedTail = afterContent.slice(baselineContent.length);
  } else {
    // 找 diff (简单的行级别对比)
    const baseSet = new Set(baseLines);
    result.addedLines2 = afterLines.filter(l => !baseSet.has(l));
  }
}

// (2) git_diff 是否在 TOOLS
try {
  const m = await import('./src/experiments/lib/coding-tools.mjs');
  const toolNames = m.TOOLS.map(t => t.function?.name).filter(Boolean);
  result.toolCount = toolNames.length;
  result.hasGitDiff = toolNames.includes('git_diff');
} catch (e) {
  result.toolCheckError = e.message;
}

// (3) 新 tool 能否调
if (result.hasGitDiff) {
  try {
    const m = await import('./src/experiments/lib/coding-tools.mjs');
    const out = await m.executeTool('git_diff', {});
    result.gitDiffRuns = true;
    result.gitDiffOutputLen = String(out).length;
    result.gitDiffOutputPreview = String(out).slice(0, 400);
  } catch (e) {
    result.gitDiffRuns = false;
    result.gitDiffError = e.message.slice(0, 200);
  }
}

// (4) 09.mjs testCoding 仍 pass
try {
  await (await import('./src/experiments/09.mjs')).testCoding();
  result.exp09Pass = true;
} catch (e) {
  result.exp09Pass = false;
  result.exp09Error = String(e.message).slice(0, 500);
}

// 还原 (testCoding 不会删 /tmp)
console.log('[e2e] === 还原 ===');
fs.copyFileSync(BACKUP, TARGET);
fs.unlinkSync(BACKUP);

// 再存一次 (含验收)
fs.writeFileSync(RESULT, JSON.stringify(result, null, 2));
console.log('\n[e2e] === 总结 ===');
console.log('  runOk:        ', result.runOk, `(attempt ${result.attempts}, ${(result.elapsedMs/1000).toFixed(1)}s)`);
console.log('  fileModified: ', result.fileModified, `(${result.charDelta > 0 ? '+' : ''}${result.charDelta || 0} chars, ${result.addedLines || 0} lines)`);
console.log('  hasGitDiff:   ', result.hasGitDiff, `(tools: ${result.toolCount}, baseline ${result.baseline.fns} fns)`);
console.log('  gitDiffRuns:  ', result.gitDiffRuns);
console.log('  exp09Pass:    ', result.exp09Pass);
console.log('  详情:', RESULT);
