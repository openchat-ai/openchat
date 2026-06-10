// === edit-quality-gate.mjs ===
// dev-repl 改文件后自动跑 lint (opencode quality-gate 风格, 失败不阻塞但告警)
//
// 触发: dev-repl 检测到工具调用是 edit_file/write_file/multi_edit/ast_edit 后
//   异步调 checkEditedFile(filePath), 失败结果写入 history 让 LLM 下轮看到
//
// 故意不阻塞: opencode 行为是"提示 + 让 agent 自己修", dev-repl 同
//   - 优点: REPL 响应快, agent 看到 lint 错可主动修
//   - 缺点: 可能漏掉, 但 history 兜底
//
// I/O (compose 契约, 供实验 10 dev-aux 测试):
//   { op: 'check', filePath } → { ok, errors, warnings, summary }
//   { op: 'isEditTool', toolName } → boolean
//
// === invariants ===
// - 永不抛 — 错误降级为 { ok:false, errors:[], summary:'lint runner unavailable' }
// - 只对 .js/.mjs/.ts/.jsx/.tsx 跑 lint, 其他扩展名直接 ok:true
// - 默认 8s 超时, 不阻塞 REPL 主循环
// - 不写盘, 不修改文件 (lintRun 只读)

import { lintRun } from './dev-tools.mjs';

const EDIT_TOOLS = new Set(['edit_file', 'write_file', 'multi_edit', 'ast_edit', 'editFile', 'writeFile', 'hashEdit']);
const LINT_EXTS = /\.(js|mjs|cjs|ts|jsx|tsx)$/i;
const LINT_TIMEOUT = 8000;

export function isEditTool(toolName) {
  return EDIT_TOOLS.has(toolName);
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

export async function checkEditedFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, errors: [], warnings: [], summary: 'invalid filePath' };
  }
  if (!LINT_EXTS.test(filePath)) {
    return { ok: true, errors: [], warnings: [], summary: 'skip (非 JS/TS 扩展名)' };
  }
  try {
    const result = await withTimeout(
      Promise.resolve(lintRun(filePath)),
      LINT_TIMEOUT
    );
    if (!result || typeof result !== 'object') {
      return { ok: true, errors: [], warnings: [], summary: 'lint 空结果' };
    }
    const errors = Array.isArray(result.errors) ? result.errors : [];
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const ok = errors.length === 0;
    const summary = ok
      ? `✓ ${filePath} lint 通过`
      : `✗ ${filePath} lint 失败 (${errors.length} errors${warnings.length ? `, ${warnings.length} warnings` : ''})`;
    return { ok, errors, warnings, summary, totalFiles: result.totalFiles };
  } catch (e) {
    return { ok: false, errors: [], warnings: [], summary: `lint 异常: ${e.message?.slice(0, 80)}` };
  }
}

export async function run({ inputs = {} } = {}) {
  const { op, filePath, toolName } = inputs;
  if (!op) throw new Error('edit-quality-gate.run: op required');
  if (op === 'check') return { outputs: await checkEditedFile(filePath) };
  if (op === 'isEditTool') return { outputs: { isEdit: isEditTool(toolName) } };
  throw new Error(`edit-quality-gate.run: unknown op "${op}"`);
}

export const META = { id: 'edit-quality-gate' };
