export async function getActiveProvider() {
  return { provider: 'openrouter', model: 'default', type: 'remote' };
}

export async function callLLM(provider, model, messages, opts) {
  return { content: 'LLM response (stub)', toolCalls: [] };
}
