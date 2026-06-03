// Walking-skeleton agent: direct provider chat, no agent/tool prompts.
import { persistentConfig } from '../../bridge/src/core/persistent-config.js';
import { sessionManager } from '../../bridge/src/core/session-manager.js';
import { OpenAiProvider } from '../../bridge/src/providers/ai-provider.js';
import { PRESET_PROVIDERS } from '../../modules/provider-kit/src/providers/openai-compatible.js';

const SYSTEM_PROMPT = `You are OpenChat, a friendly Chinese-speaking AI assistant.
Rules:
- Reply in the same language as the user (Chinese → Chinese).
- Be concise: 1-3 sentences unless asked for detail.
- For voice messages, respond conversationally as if the user just spoke.`;

let _sessionId = null;
let _provider = null;
let _model = null;

export async function initProvider() {
  const cfg = persistentConfig.config;
  let provider = cfg.current?.provider;
  const model = cfg.current?.model;
  if (!provider || !model || !cfg.providers?.[provider]) {
    provider = Object.keys(cfg.providers || {})[0];
    if (!provider) throw new Error('config.json: no provider found');
  }
  const apiKey = cfg.providers?.[provider]?.apiKey;
  if (!apiKey) throw new Error(`config.json: providers.${provider}.apiKey missing`);

  const preset = PRESET_PROVIDERS[provider];
  const baseUrl = preset?.baseUrl || null;
  _provider = new OpenAiProvider(provider);
  await _provider.connect(apiKey, baseUrl);
  sessionManager.addProviderDirect(_provider);
  _model = model;

  const session = await sessionManager.createSession(provider, model);
  _sessionId = session.id;
  console.log(`[skeleton] provider=${provider} model=${model} session=${_sessionId}`);
  return _sessionId;
}

export function getSessionId() {
  return _sessionId;
}

async function processText(text) {
  if (!_provider) throw new Error('call initProvider() first');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: text },
  ];
  const response = await _provider.chat(_model, messages);
  return { response: response?.content || '', toolCalls: [] };
}

export { processText };
