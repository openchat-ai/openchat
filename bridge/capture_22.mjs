// 捕获 22.mjs 跑 M3 的 tool call 全过程 + 保存 modified file
import { run, initProvider, getHistory } from './src/experiments/22.mjs';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';

const TARGET = 'F:/openchat/bridge/src/experiments/lib/coding-tools.mjs';
const BACKUP = os.tmpdir() + '/coding-tools.capture.bak';
const MODIFIED_FILE = 'F:/openchat/bridge/coding-tools.mjs.MODIFIED.mjs';
const RESULT = 'F:/openchat/bridge/capture_result.json';

console.log('[capture] init provider (M3)...');
await initProvider();

fs.copyFileSync(TARGET, BACKUP);
const baseline = fs.readFileSync(TARGET, 'utf-8');

const TASK = `在 F:/openchat/bridge/src/experiments/lib/coding-tools.mjs 加一个新 tool 叫 'git_diff'.

接口: async function gitDiff({ ref, file }) → string (diff 文本)
实现: 用 child_process.execSync 调 'git diff <ref> -- <file>' 或 'git diff <ref>', 返回 stdout 文本. 错误返回 '[Error] <msg>'.
风格: 跟现有 39 个 tool 一致 (export async function + executeTool switch case).
加到 TOOLS 数组末尾, function.name: 'git_diff', parameters: { ref: { type: 'string' }, file: { type: 'string' } }.

不要改其他文件. 完成后报告: (a) 加在第几行 (b) 函数签名 (c) 是否有报错`;

const CHAT_ID = 'capture-1';
console.log('[capture] 跑 22.mjs (5-15 min)...');
const start = Date.now();
let response, runOk = true, err = null;
try {
  // 窄工具集: 只暴露 4 个编辑类工具. M3 在 39 工具下偏向 build_run, 浪费 round.
  const NARROW = ['read_file', 'edit_file', 'hash_edit', 'write_file'];
  const r = await run({ inputs: { text: TASK, chatId: CHAT_ID, tools: NARROW } });
  response = r.outputs.response;
} catch (e) {
  runOk = false;
  err = e.message;
}
const elapsed = Date.now() - start;

// 抓 history
const history = getHistory(CHAT_ID);

// 分析 tool calls
const toolCallLog = [];
for (const msg of history) {
  if (msg.role === 'assistant' && msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      let args = tc.function?.arguments;
      try { args = JSON.parse(args); } catch {}
      toolCallLog.push({ name: tc.function?.name, args });
    }
  }
}

// 保存 modified file
const after = fs.readFileSync(TARGET, 'utf-8');
const fileModified = after !== baseline;
if (fileModified) {
  fs.writeFileSync(MODIFIED_FILE, after);
}

const result = {
  elapsedMs: elapsed, runOk, err,
  response: (response || '').slice(0, 1500),
  fileModified,
  charDelta: after.length - baseline.length,
  toolCallCount: toolCallLog.length,
  toolCalls: toolCallLog,
  historyLen: history.length,
};
fs.writeFileSync(RESULT, JSON.stringify(result, null, 2));

// 还原
fs.copyFileSync(BACKUP, TARGET);
fs.unlinkSync(BACKUP);

console.log('\n[capture] === 总结 ===');
console.log('  runOk:        ', runOk, `(${(elapsed/1000).toFixed(1)}s)`);
console.log('  response:     ', (response || '').slice(0, 200).replace(/\n/g, ' '));
console.log('  fileModified: ', fileModified, `(${result.charDelta} chars)`);
console.log('  toolCalls:    ', toolCallLog.length);
console.log('  historyLen:   ', history.length);
console.log('  详情: capture_result.json');
if (fileModified) console.log('  modified file saved:', MODIFIED_FILE);
