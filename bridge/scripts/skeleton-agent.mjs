// Walking-skeleton agent: LLM chat via provider-kit.
// (Rule: any LLM call MUST go through provider-kit, not custom code.)
// No sessionManager — _sessions Map handles per-chat history.

import { persistentConfig } from '../src/core/persistent-config.js';
import { createProvider } from 'provider-kit';
import { runPipeline, getEditProtocolGuidance } from '../src/core/epc-pipeline.mjs';

const SYSTEM_PROMPT = `You are OpenChat, a friendly Chinese-speaking AI assistant.
Rules:
- Reply in the same language as the user (Chinese → Chinese).
- Be concise: 1-3 sentences unless asked for detail.
- For voice messages, respond conversationally as if the user just spoke.

${getEditProtocolGuidance()}`;

let _provider = null;
let _model = null;
const _sessions = new Map(); // chatId → { history, sessionId }

export async function initProvider() {
  const cfg = persistentConfig.config;
  let provider = cfg.current?.provider;
  let model = cfg.current?.model;
  if (!provider || !model || !cfg.providers?.[provider]) {
    const keys = Object.keys(cfg.providers || {});
    if (keys.length === 0) throw new Error('config.json: no provider configured');
    provider = keys[0];
    model = cfg.providers[provider]?.defaultModel || cfg.providers[provider]?.model;
    if (!model) throw new Error(`config.json: no model for ${provider}`);
  }
  const apiKey = cfg.providers[provider]?.apiKey;
  if (!apiKey) throw new Error(`config.json: providers.${provider}.apiKey missing`);

  _provider = createProvider(provider, apiKey);
  await _provider.connect(apiKey);
  _model = model;
  console.log(`[skeleton-agent] init OK: ${provider}/${model} (via provider-kit)`);
  return `${provider}/${model}`;
}

function _getOrCreateSession(chatId) {
  if (_sessions.has(chatId)) return _sessions.get(chatId);
  const entry = { history: [{ role: 'system', content: SYSTEM_PROMPT }], sessionId: chatId };
  _sessions.set(chatId, entry);
  console.log(`[skeleton-agent] new session chatId=${chatId}`);
  return entry;
}

export async function processText(text, chatId = 'default') {
  if (!_provider) throw new Error('call initProvider() first');
  const entry = _getOrCreateSession(chatId);
  entry.history.push({ role: 'user', content: text });

  const rawResponse = await _provider.chat(_model, entry.history, { includeRaw: false });
  // 显式走 pipeline: raw → stripThink + extractReasoning + normalizeToolCalls + parseActionFallback → EPC
  const p = runPipeline(rawResponse);
  const reply = p.content || '';

  entry.history.push({ role: 'assistant', content: reply });

  // Trim history: keep system + last 18 messages
  const trimmed = [entry.history[0], ...entry.history.slice(-18)];
  entry.history = trimmed;

  return { response: reply, toolCalls: p.toolCalls, sessionId: entry.sessionId };
}

export function getHistory(chatId) {
  const entry = _sessions.get(chatId);
  return entry ? [...entry.history] : [];
}

export async function generateSessionName(chatId) {
  if (!_provider) throw new Error('provider not initialized');
  const entry = _sessions.get(chatId);
  if (!entry || entry.history.length < 2) return null;
  const userMessages = entry.history.filter(m => m.role === 'user').slice(0, 5);
  if (userMessages.length === 0) return null;
  const context = userMessages.map(m => m.content).join('\n');
  const messages = [
    { role: 'system', content: 'Generate a 1-4 character Chinese session title. Return ONLY the title, no quotes, no punctuation.' },
    { role: 'user', content: `Conversation:\n${context}\n\nSession title:` },
  ];
  const resp = await _provider.chat(_model, messages, { includeRaw: false });
  const p = runPipeline(resp);
  return (p.content || '').replace(/["'「」]/g, '').trim().substring(0, 20) || null;
}
