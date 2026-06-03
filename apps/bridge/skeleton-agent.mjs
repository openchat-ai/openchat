// Agent wrapper: calls agentEngine.processStream and captures TOOL_CALL events
import { agentEngine } from '../../bridge/src/core/agent/agent-engine.js';
import { sessionManager } from '../../bridge/src/core/session-manager.js';
import { persistentConfig } from '../../bridge/src/core/persistent-config.js';
import { OpenAiProvider } from '../../bridge/src/providers/ai-provider.js';
import { PRESET_PROVIDERS } from '../../modules/provider-kit/src/providers/openai-compatible.js';

// Disable quality checker for walking skeleton (has bugs: score=100, passed=false)
agentEngine.enableQualityCheck = false;

let _sessionId = null;

export async function initProvider() {
  const cfg = persistentConfig.config;
  let provider = cfg.current?.provider;
  const model = cfg.current?.model;

  if (!provider || !model || !cfg.providers?.[provider]) {
    provider = Object.keys(cfg.providers || {})[0];
    if (!provider) throw new Error('config.json: no provider found, check providers.<name>.apiKey');
    console.warn(`[skeleton] current.provider invalid, auto-detected: ${provider}`);
  }

  const apiKey = cfg.providers?.[provider]?.apiKey;
  if (!apiKey) throw new Error(`config.json: providers.${provider}.apiKey missing`);

  const preset = PRESET_PROVIDERS[provider];
  const baseUrl = preset?.baseUrl || null;
  const aiProvider = new OpenAiProvider(provider);
  await aiProvider.connect(apiKey, baseUrl);
  sessionManager.addProviderDirect(aiProvider);

  const session = await sessionManager.createSession(provider, model);
  _sessionId = session.id;

  console.log(`[skeleton] provider=${provider} model=${model} session=${_sessionId}`);
  return _sessionId;
}

export function getSessionId() {
  return _sessionId;
}

async function processText(text) {
  if (!_sessionId) throw new Error('call initProvider() first');
  let response = '';
  let toolCalls = [];

  await agentEngine.processStream(_sessionId, 'skeleton-user', text, (event) => {
    switch (event.type) {
      case 'content':
        response += event.content;
        break;
      case 'tool_call':
        toolCalls.push({ tool: event.tool, args: event.args });
        console.log(`[C13d] TOOL_CALL=${event.tool}(${JSON.stringify(event.args)})`);
        break;
      case 'complete':
        response = event.response || response;
        console.log(`[C13d] iterations=${event.iterations}`);
        break;
      case 'error':
        console.error(`[C13d] error=${event.error || event.message}`);
        break;
    }
  });

  return { response, toolCalls };
}

export { processText };
