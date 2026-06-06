// Walking-skeleton agent: direct provider chat, no agent/tool prompts.
import { persistentConfig } from '../src/core/persistent-config.js';
import { sessionManager } from '../src/core/session-manager.js';
import { createProvider, PRESET_PROVIDERS } from 'provider-kit';

const SYSTEM_PROMPT = `You are OpenChat, a friendly Chinese-speaking AI assistant.
Rules:
- Reply in the same language as the user (Chinese → Chinese).
- Be concise: 1-3 sentences unless asked for detail.
- For voice messages, respond conversationally as if the user just spoke.`;

let _provider = null;
let _model = null;
const _sessions = new Map(); // chatId → { history, sessionId }

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

  _provider = createProvider(provider, apiKey);
  await _provider.connect(apiKey);
  sessionManager.addProviderDirect(_provider);
  _model = model;

  // Reuse existing session for this provider+model if available
  const existing = sessionManager.listSessions()
    .find(s => s.providerType === provider && s.model === model);
  if (existing) {
    console.log(`[skeleton] reuse session ${existing.id} for ${provider}/${model}`);
    return existing.id;
  }
  const session = await sessionManager.createSession(provider, model);
  console.log(`[skeleton] provider=${provider} model=${model} session=${session.id}`);
  return session.id;
}

function _getOrCreateSession(chatId) {
  if (_sessions.has(chatId)) return _sessions.get(chatId);
  const entry = { history: [{ role: 'system', content: SYSTEM_PROMPT }], sessionId: chatId };
  _sessions.set(chatId, entry);
  console.log(`[skeleton] new session chatId=${chatId}`);
  return entry;
}

const MAX_TOOL_LOOP = 5;
import { TOOLS, executeTool } from '../src/tools/system-exec.mjs';

async function processText(text, chatId = 'default') {
  if (!_provider) throw new Error('call initProvider() first');
  const entry = _getOrCreateSession(chatId);
  entry.history.push({ role: 'user', content: text });

  let reply = '';
  let iterations = 0;
  let msgs = entry.history;
  while (iterations < MAX_TOOL_LOOP) {
    iterations++;
    const response = await _provider.chat(_model, msgs, TOOLS);
    const tc = response?.toolCalls || [];

    if (tc.length > 0) {
      // Execute tools and feed results back
      msgs.push({ role: 'assistant', content: null, tool_calls: tc });
      for (const call of tc) {
        if (call.type !== 'function') continue;
        try {
          const args = JSON.parse(call.function.arguments);
          const result = executeTool(call.function.name, args);
          msgs.push({ role: 'tool', tool_call_id: call.id, content: result });
        } catch (e) {
          msgs.push({ role: 'tool', tool_call_id: call.id, content: `Error: ${e.message}` });
        }
      }
      continue;
    }

    reply = response?.content || '';
    break;
  }

  // If we exhausted iterations, last assistant message is the reply
  if (!reply && iterations >= MAX_TOOL_LOOP) {
    reply = '(tool loop exhausted)';
  }

  // Rebuild clean history: system + last maxAssistant * 2 user/assistant pairs
  const systemMsg = entry.history[0];
  const nonToolMsgs = (entry.history.slice(1) || []).filter(m => m.role !== 'tool' && !m.tool_calls);
  // Keep system + last 18 non-tool messages
  const trimmed = [systemMsg, ...nonToolMsgs.slice(-18)];
  entry.history = trimmed;
  return { response: reply, toolCalls: [], sessionId: entry.sessionId };
}

const NAME_SYSTEM = `You are a session-naming assistant.
Rules:
- Generate a short Chinese session title (1-4 characters).
- Return ONLY the title, no explanation, no quotes, no punctuation.
- Based on the first few user messages, capture the core topic.
- Example: "Flutter", "聊天", "调试", "配置"`;

// Return a copy of conversation history for name generation
export function getHistory(chatId) {
  const entry = _sessions.get(chatId);
  return entry ? [...entry.history] : [];
}

// Generate session name without affecting conversation history
export async function generateSessionName(chatId) {
  if (!_provider || !_model) throw new Error('provider not initialized');
  const entry = _sessions.get(chatId);
  if (!entry || entry.history.length < 2) return null;
  // Use only user messages as context
  const userMessages = entry.history.filter(m => m.role === 'user').slice(0, 5);
  const context = userMessages.map(m => m.content).join('\n');
  const messages = [
    { role: 'system', content: NAME_SYSTEM },
    { role: 'user', content: `Conversation:\n${context}\n\nSession title:` },
  ];
  const resp = await _provider.chat(_model, messages);
  const name = (resp?.content || '').replace(/["'「」]/g, '').trim().substring(0, 20);
  return name || null;
}

export { processText };
