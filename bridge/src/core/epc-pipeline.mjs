// EPC pipeline: LLM 响应 → EPC 字节流 (inbound 显式 4 步) + System prompt 拼段
//
// === Inbound (LLM → us): runPipeline ===
//   provider-kit 的 adapter 已经把 raw 响应做完了 4 个处理 (think 剥除 / reasoning 提取 /
//   tool_calls 标准化 / ACTION: 降级) 并返回 { content, toolCalls, epc }。
//   runPipeline 在 openchat 这一层"显式过一道" — 让数据流可见可测, 函数都是幂等的。
//   4 个纯函数从 provider-kit 导入, 单一来源。
//
// === Outbound (us → LLM): getEditProtocolGuidance ===
//   拼到 skeleton-agent 的 SYSTEM_PROMPT 末尾, 引导 LLM:
//     - 大文件 (≥80 行) + 单行编辑时, 用 hash_edit 而不是 edit_file (省 50%+ tokens)
//     - 多行 / 小文件 → edit_file
//     - 新文件 → write_file
//   协议选用交给 LLM (在 prompt 里明说), 不在 runtime 拦截 —
//   拦截会破坏 FC 协议, 又难以观测。
//
// 用法:
//   import { runPipeline, getEditProtocolGuidance } from './epc-pipeline.mjs';
//   // Inbound
//   const r = await _provider.chat(model, messages, { includeRaw: false });
//   const p = runPipeline(r);   // { rawContent, content, reasoningContent, toolCalls, epc }
//   // System prompt
//   const prompt = `${baseSystemPrompt}\n\n${getEditProtocolGuidance()}`;

import { epcFromResponse, stripThink, extractReasoning, normalizeToolCalls, parseActionFallback } from 'provider-kit';

/** 把 (content, reasoningContent, toolCalls) 装进 EPC 帧 */
export function buildEpc({ content, reasoningContent = '', toolCalls = [] }) {
  return epcFromResponse({ content, reasoningContent, toolCalls });
}

/**
 * 主入口: 显式过 4 步 + 装 EPC
 * @param {object} rawResponse  provider.chat(...) 返回的响应
 *                              通常 = { content, toolCalls, epc, raw? }
 *                              (注: reasoningContent 不在顶层, 只在 epc SUB_THINKING 帧里)
 * @returns {object} { rawContent, content, reasoningContent, toolCalls, epc }
 *
 * 注: provider-kit 的 adapter 已经做过 4 步处理, 这里再过一道是"显式可见"的兜底。
 *     4 个函数都从 provider-kit 导入且都是幂等的 — 二次处理不改变数据。
 */
export function runPipeline(rawResponse) {
  // rawContent 在这里是"半成品" (provider-kit 已剥过 think) — 我们再 stripThink 一道确保干净
  const rawContent = rawResponse?.content || '';
  const reasoningContent = extractReasoning(rawResponse);
  let toolCalls = normalizeToolCalls(rawResponse?.toolCalls);
  toolCalls = parseActionFallback(rawContent, toolCalls);
  const content = stripThink(rawContent);
  const epc = buildEpc({ content, reasoningContent, toolCalls });
  return { rawContent, content, reasoningContent, toolCalls, epc };
}

/**
 * 给 LLM 看的"工具选用指南" — 拼到 system prompt 里, 让 LLM 自己挑最省 token 的协议。
 *
 * 设计:
 *   - 不在 runtime 拦截 LLM 的 edit_file 调用 (会破坏 FC 协议 + 难以观测)
 *   - 改在 system prompt 里"明说" — LLM 看到后会主动用 hash_edit
 *   - hash_edit 工具在 coding-tools.mjs: executeTool('hash_edit', { path, hash, newContent })
 *
 * @returns {string} 拼到 system prompt 末尾的纯文本
 */
export function getEditProtocolGuidance() {
  return `## 工具选用指南 (省 token)
编辑代码时, 根据"目标文件大小" + "编辑范围" 选用最省 token 的工具:

1. **新建/全量重写文件** → 用 \`write_file\` (无替代)
2. **单行修改 (search/newStr 都不含换行) + 文件 ≥80 行** → 用 \`hash_edit\`
   - 8 字符 md5 hash 替代整个 search 串, token 可省 50%+
   - 格式: { path, hash: "8位hex", newContent: "新行完整内容" }
3. **多行修改 / 小文件 (<80 行)** → 用 \`edit_file\`
4. **修改多行不相邻** → 用 \`multi_edit\` (批量)

> 注: edit_file 的 search 串必须**完整且唯一** (含前导空格、缩进)。如果你不能确认唯一性, 优先 hash_edit。`;
}
