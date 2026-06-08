// Experiment 2: skeleton-agent (走 provider-kit 调 LLM)
// Walking-skeleton 的实际 agent 在 `scripts/skeleton-agent.mjs`，统一通过
// provider-kit (createProvider/connect/chat) 调用 LLM，配置在 persistent-config。

export const META = { id: 'agent' };

// compose 契约入口：调 LLM，返回 reply + toolCalls
//   inputs:  { text, chatId? }
//   outputs: { response, toolCalls }
export async function run({ inputs = {} } = {}) {
  const { text, chatId = 'default' } = inputs;
  if (!text) throw new Error('agent.run: text required');
  const agent = await import('../../scripts/skeleton-agent.mjs');
  try { await agent.initProvider(); } catch (e) {
    console.warn(`[agent] initProvider 失败: ${e.message}`);
  }
  const r = await agent.processText(text, chatId);
  return { outputs: { response: r.response || '', toolCalls: r.toolCalls || [] } };
}
