/**
 * 统一 LLM 调用
 *
 * 遵循 OpenAI 设计原则：内容类型由 provider 层在 API 响应时归一化，
 * 应用层不解析 content 文本。
 * - content     → 干净的回答文本
 * - reasoningContent → 推理过程（由 provider 从 API 的 reasoning_content 字段提取）
 * - toolCalls   → 结构化工具调用
 */
import { persistentConfig } from '../../../core/persistent-config.js';
import { sessionManager } from '../../../core/session-manager.js';
import { parseEpcPayload } from 'provider-kit';

export function unwrapJsonAnswer(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const inner = obj.answer ?? obj.response ?? obj.text ?? obj.content ?? obj.result;
      if (typeof inner === 'string') return inner;
    }
  } catch {}
  return text;
}

/** 获取当前 provider 配置的 provider instance（无则抛错） */
export async function getActiveProvider() {
  const type = persistentConfig.getCurrentProvider();
  const apiKey = persistentConfig.getApiKey(type);
  const model = persistentConfig.getPreference('currentModel');
  if (!type || !apiKey) throw new Error('NO_API_KEY');
  if (!sessionManager.getProvider(type)) await sessionManager.addProvider(type, apiKey);
  return { provider: sessionManager.getProvider(type), model, type };
}

/** 统一 chat 调用，自带超时 */
export async function callLLM(provider, model, messages, { timeout = 120000, tools = null } = {}) {
  const opts = {};
  if (tools) opts.tools = tools;
  const prevTimeout = provider.timeout;
  if (timeout) provider.timeout = timeout;
  let result;
  try {
    result = await provider.chat(model, messages, opts);
  } finally {
    provider.timeout = prevTimeout;
  }
  const epc = result.epc ? parseEpcPayload(result.epc) : null;
  return {
    content: result.content || '',
    reasoningContent: epc ? epc.reasoningContent : (result.reasoning_content || result.reasoningContent || ''),
    rawContent: result.content || '',
    toolCalls: epc ? epc.toolCalls : (result.tool_calls || result.toolCalls || []),
  };
}
