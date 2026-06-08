// Walking-skeleton agent: LLM chat via provider-kit.
// (Rule: any LLM call MUST go through provider-kit, not custom code.)
// No sessionManager — _sessions Map handles per-chat history.
// Multi-turn tool loop: after user message, agent can call tools repeatedly
// until it produces a final text answer (like opencode goal).

import { persistentConfig } from '../src/core/persistent-config.js';
import { createProvider } from 'provider-kit';
import { runPipeline, getEditProtocolGuidance } from '../src/core/epc-pipeline.mjs';
import { TOOLS as CODING_TOOLS, executeTool as codingExec } from '../src/tools/coding-tools.mjs';

const SYSTEM_PROMPT = `You are OpenChat, a friendly Chinese-speaking AI software development assistant.
You have tools to explore, read, edit, and search the codebase.
Rules:
- Reply in the same language as the user (Chinese → Chinese).
- For software tasks, use tools proactively — read files, search patterns, then answer.
- Never describe what you would do — execute tools and show results.
- Call ONE tool at a time. After getting results, either call more or answer.

${getEditProtocolGuidance()}`;

const MAX_ROUNDS = 12;
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

  let finalText = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const rawResponse = await _provider.chat(_model, entry.history, {
      tools: CODING_TOOLS,
    });

    const p = runPipeline(rawResponse);
    const toolCalls = p.toolCalls;

    if (toolCalls && toolCalls.length > 0) {
      const asstMsg = {
        role: 'assistant',
        content: p.content || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
      entry.history.push(asstMsg);

      for (const tc of toolCalls) {
        const result = await _execTool(tc.name, tc.arguments);
        entry.history.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    } else {
      finalText = p.content || '';
      break;
    }
  }

  if (!finalText) finalText = '[max rounds reached]';
  entry.history.push({ role: 'assistant', content: finalText });

  const trimmed = [entry.history[0], ...entry.history.slice(-18)];
  entry.history = trimmed;

  return { response: finalText, toolCalls: [], sessionId: entry.sessionId };
}

async function _execTool(name, argsRaw) {
  let args;
  try { args = typeof argsRaw === 'string' ? JSON.parse(argsRaw) : argsRaw; } catch { return `[Error] Invalid JSON: ${String(argsRaw).slice(0, 80)}`; }
  try {
    const r = await codingExec(name, args);
    const s = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
    return s.length > 8000 ? s.slice(0, 8000) + '\n... (truncated)' : s;
  } catch (e) {
    return `[Error] ${e.message}`;
  }
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
