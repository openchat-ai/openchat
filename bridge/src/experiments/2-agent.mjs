// Experiment 2: skeleton-agent (走 provider-kit 调 LLM)
// Walking-skeleton 的实际 agent 在 `scripts/skeleton-agent.mjs`，统一通过
// provider-kit (createProvider/connect/chat) 调用 LLM，配置在 persistent-config。

export const META = { id: 'agent' };

// compose 契约入口：调 LLM，返回 reply + toolCalls
//   inputs:  { text, chatId?, guardian? }
//   deps:    { guardian } — 由 guardian 实验提供守卫层中间件
//   outputs: { response, toolCalls }
export async function run({ inputs = {}, deps = {} } = {}) {
  const { text, chatId = 'default', guardian: guardianInput } = inputs;
  if (!text) throw new Error('agent.run: text required');
  const agent = await import('../../scripts/skeleton-agent.mjs');
  try { await agent.initProvider(); } catch (e) {
    console.warn(`[agent] initProvider 失败: ${e.message}`);
  }
  // 优先级: inputs.guardian > deps.guardian.guardian > undefined
  const guardianOpt = guardianInput || deps.guardian?.guardian;
  const r = await agent.processText(text, chatId, guardianOpt ? { guardian: guardianOpt } : {});
  return { outputs: { response: r.response || '', toolCalls: r.toolCalls || [] } };
}
