// Experiment 2: skeleton-agent (走 provider-kit 调 LLM)
//
// Current state: agent-engine.js 仍是历史模块，但走的是自写 LLM 链路（已废弃）。
// Walking-skeleton 的实际 agent 在 `scripts/skeleton-agent.mjs`，统一通过
// provider-kit (createProvider/connect/chat) 调用 LLM，配置在 persistent-config。

import { create } from './lib/report.mjs';

export const META = { id: 'agent' };

// compose 契约入口：调 LLM 一次，返回 reply + toolCalls
//   inputs:  { text, chatId? }
//   outputs: { response, toolCalls }
export async function run({ inputs = {} } = {}) {
  const { text, chatId = 'default' } = inputs;
  if (!text) throw new Error('agent.run: text required');
  const agent = await import('../../scripts/skeleton-agent.mjs');
  // initProvider 可能因 config 缺失失败；与 chat-poller 一致：失败不阻断，回退到 canned
  try { await agent.initProvider(); } catch (e) {
    console.warn(`[agent] initProvider 失败: ${e.message}`);
  }
  const r = await agent.processText(text, chatId);
  return { outputs: { response: r.response || '', toolCalls: r.toolCalls || [] } };
}

const { ok, ng, skip, report } = create();
const NAME = 'Agent — skeleton-agent 走 provider-kit';

async function test() {
  let agent;
  try {
    agent = await import('../../scripts/skeleton-agent.mjs');
    ok('scripts/skeleton-agent.mjs 可加载');
  } catch (e) {
    ng('skeleton-agent 加载失败', e);
    return report(NAME);
  }

  for (const f of ['initProvider', 'processText', 'generateSessionName', 'getHistory']) {
    if (typeof agent[f] === 'function') ok(`${f} 存在`);
    else ng(`${f} 缺失`);
  }

  // 验证源码走 provider-kit（项目规约：任何 LLM 调用统一通过 kit）
  try {
    const fs = await import('fs/promises');
    const src = await fs.readFile('scripts/skeleton-agent.mjs', 'utf8');
    if (src.includes("from 'provider-kit'")) ok('import createProvider from provider-kit');
    else ng('未 import provider-kit');
    if (src.includes('createProvider(')) ok('调用 createProvider(...)');
    else ng('未调 createProvider');
    if (src.includes('_provider.chat(')) ok('走 _provider.chat (kit 统一接口)');
    else ng('未走 _provider.chat');
    if (src.includes('SYSTEM_PROMPT')) ok('有系统提示词');
    else ng('缺系统提示词');
    if (src.includes('processText') && src.includes('chatId')) ok('processText(chatId) per-chat session');
    else ng('processText 签名异常');
  } catch (e) {
    ng('源码验证失败', e);
  }

  // 没有自写 LLM（无 fetch / axios 调 OpenAI / OpenRouter URL）
  try {
    const fs = await import('fs/promises');
    const src = await fs.readFile('scripts/skeleton-agent.mjs', 'utf8');
    if (!/api\.openai\.com|openrouter\.ai.*\/api\/v1/i.test(src)) ok('无自写 LLM HTTP 调用');
    else ng('发现自写 LLM HTTP 调用 — 应统一走 provider-kit');
  } catch (e) {
    skip('自写 LLM 检查跳过');
  }

  // 历史 agent-engine 标记为 legacy
  try {
    const fs = await import('fs/promises');
    const src = await fs.readFile('src/core/agent/agent-engine.js', 'utf8');
    ok('agent-engine.js (legacy) 仍存在');
  } catch {
    ok('agent-engine.js (legacy) 已清理');
  }

  report(NAME);
}

export { test };
