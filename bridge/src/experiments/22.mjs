// Walking-skeleton agent: LLM chat via provider-kit.
// (Rule: any LLM call MUST go through provider-kit, not custom code.)
// No sessionManager — _sessions Map handles per-chat history.
// Multi-turn tool loop: after user message, agent can call tools repeatedly
// until it produces a final text answer (like opencode goal).

import { persistentConfig } from './lib/config.mjs';
import { createProvider } from 'provider-kit';
import { runPipeline, getEditProtocolGuidance } from './lib/epc-pipeline.mjs';
import { TOOLS as CODING_TOOLS, executeTool as codingExec } from './lib/coding-tools.mjs';
import { createGuardian } from './lib/guardian.mjs';
import { getRole } from './lib/subagent-roles.mjs';
import {
  init as brainInit,
  predict as brainPredict,
  adaptTools as brainAdaptTools,
  adaptMaxRounds as brainAdaptMaxRounds,
  trainOnOutcome as brainTrain,
} from './lib/neural-bridge.mjs';
import { checkPermission as permCheck } from './lib/permission-gate.mjs';
import { runPre as hookPre, runPost as hookPost } from './lib/agent-hooks.mjs';

brainInit();  // 进程启动一次性, always-on

const CWD = process.cwd();
// 简化 SYSTEM_PROMPT — 原版约束太多 (Call ONE tool at a time + getEditProtocolGuidance), 阻断 M3 多步探索
// M3 验证 (e2e_loop_result.json) 显示它喜欢多 read + 多 write + 中间 verify, 给它自由度
const SYSTEM_PROMPT = `You are a coding assistant. Working directory: ${CWD}.

Use available tools to complete the user's task. Be thorough — read files first, then make targeted edits, then verify (re-read or run tests).

Reply in the same language as the user.`;

const MAX_ROUNDS = 20;
const MAX_REPEAT = 8;
// 读类工具不计入 repeat 限制 — M3 习惯多读几遍确认 (wc / powershell / node -e 等), 这是合法探索, 不是 loop
const READ_ONLY_TOOLS = new Set(['read_file', 'grep', 'code_search', 'ast_find_refs', 'find_refs', 'ast_index', 'ast_search', 'ast_extract', 'ts_typecheck', 'lint_run', 'test_run', 'test_discover', 'docs_suggest', 'env_diff', 'sec_audit', 'ci_detect', 'git_log']);
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
  console.debug(`[tool-loop] init OK: ${provider}/${model} (via provider-kit)`);
  return `${provider}/${model}`;
}

// === invariants ===
//   - _provider 必须先调 initProvider() 才能调 processText/run
//   - 每个 chatId 一份 history (in-memory Map), session 不持久化
//   - role > brain > base 的优先级: role 决定 prompt/tools/maxRounds 顶, brain 在 role 之上微调
//   - toolSubset = (role.tools if role else callerTools) ∩ brain-adapt
// === end invariants ===

function _getOrCreateSession(chatId, systemPrompt = SYSTEM_PROMPT) {
  if (_sessions.has(chatId)) return _sessions.get(chatId);
  const entry = { history: [{ role: 'system', content: systemPrompt }], sessionId: chatId };
  _sessions.set(chatId, entry);
  console.debug(`[tool-loop] new session chatId=${chatId}${systemPrompt !== SYSTEM_PROMPT ? ' (role)' : ''}`);
  return entry;
}

export async function processText(text, chatId = 'default', opts = {}) {
  if (!_provider) throw new Error('call initProvider() first');

  // [ROLE] opt-in role override — prompt + tools + maxRounds 一起换
  const roleDef = opts.role ? getRole(opts.role) : null;
  if (roleDef) console.debug(`[role] ${chatId}: ${roleDef.name} (tools=${roleDef.tools.length}, maxRounds=${roleDef.maxRounds})`);

  // [BRAIN] predict — opt-in 读脑预测, 失败/未启 = null
  const brainPred = brainPredict(text);
  if (brainPred) {
    console.debug(`[brain] ${chatId}: difficulty=${brainPred.difficulty} domain=${brainPred.domain} canLocal=${brainPred.canLocal} (samples=${brainPred.samples})`);
  }

  const entry = _getOrCreateSession(chatId, roleDef ? roleDef.prompt : undefined);
  entry.history.push({ role: 'user', content: text });

  const guardian = opts.guardian !== undefined ? opts.guardian : null;  // 默认关闭 guardian — 它会拒绝 LLM 的合法 tool call, 阻断 M3 多步探索
  // 窄工具集: 调用方传 opts.tools (tool name 数组) → 只暴露这些给 LLM.
  // 默认 = 全 39. M3 在 39 工具下会偏向 build_run/lang_run (通用 shell), 不肯用 edit_file/hash_edit,
  // 浪费 round 在探索, 撞 MAX_ROUNDS. 5-件套原则: 任务越窄, 工具越少越好.
  // [ROLE] role 优先于 callerTools, callerTools 优先于全集
  const callerTools = (Array.isArray(opts.tools) && opts.tools.length > 0)
    ? CODING_TOOLS.filter(t => opts.tools.includes(t.function?.name))
    : CODING_TOOLS;
  const roleBase = roleDef
    ? CODING_TOOLS.filter(t => roleDef.tools.includes(t.function?.name))
    : callerTools;
  // [BRAIN] adapt tools by predicted domain (code_review → 只读)
  const toolSubset = brainAdaptTools(roleBase, brainPred?.domain);
  // [BRAIN] adapt max rounds by predicted difficulty
  // [ROLE] role.maxRounds 优先于 brain, brain 优先于 base
  const baseRounds = roleDef ? roleDef.maxRounds : MAX_ROUNDS;
  const effectiveMaxRounds = brainAdaptMaxRounds(baseRounds, brainPred?.difficulty);
  let finalText = '';
  const callCount = new Map();

  for (let round = 0; round < effectiveMaxRounds; round++) {
    const rawResponse = await _provider.chat(_model, entry.history, {
      tools: toolSubset,
    });

    let toolCalls;
    if (guardian) {
      // guardian 模式: 先校验整个响应
      const v = guardian.validateResponse(rawResponse);
      toolCalls = v.toolCalls;
      if (!v.valid) {
        const nudge = v.errors.map(e => `[Guardian] ${e.tool}: ${e.error}`).join('\n');
        entry.history.push({ role: 'tool', tool_call_id: 'guardian', content: nudge });
        if (v.toolCalls.length === 0) continue;
      }
    } else {
      const p = runPipeline(rawResponse);
      toolCalls = p.toolCalls;
    }

    if (toolCalls && toolCalls.length > 0) {
      const asstMsg = {
        role: 'assistant',
        content: rawResponse.content || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.args || {}) },
        })),
      };
      entry.history.push(asstMsg);

      for (const tc of toolCalls) {
        const rawArgs = tc.function?.arguments || tc.arguments || '{}';
        const key = `${tc.name}:${rawArgs}`;
        if (!READ_ONLY_TOOLS.has(tc.name)) {
          const count = (callCount.get(key) || 0) + 1;
          callCount.set(key, count);
          if (count > MAX_REPEAT) {
            finalText = `[loop aborted: ${tc.name} called ${count} times with same args]`;
            entry.history.push({ role: 'tool', tool_call_id: tc.id, content: finalText });
            break;
          }
        }

        if (guardian) {
          const g = await guardian.wrap(tc, _execTool);
          entry.history.push({ role: 'tool', tool_call_id: tc.id, content: g.ok ? g.result : g.error });
          if (g.bypassedByGuardian) break;
        } else {
          // [PERMISSION] gate before _execTool — safe 直通, confirm 问/auto, forbidden block
          let parsedArgs = {};
          try { parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs || {}); } catch { /* 留给 _execTool 报错 */ }
          const perm = permCheck(tc.name, parsedArgs, { chatId });
          if (!perm.allowed) {
            entry.history.push({ role: 'tool', tool_call_id: tc.id, content: `[Denied: ${perm.reason}]` });
            continue;
          }
          const result = await _execTool(tc.name, rawArgs);
          entry.history.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
      }
      if (finalText) break;
    } else {
      finalText = rawResponse.content || '';
      break;
    }
  }

  if (!finalText) finalText = '[max rounds reached]';

  // [BRAIN] train on outcome — 失败 → difficulty +1, domain → 'logic'
  if (brainPred) {
    const success = !finalText.startsWith('[max rounds') && !finalText.startsWith('[loop aborted');
    const error = success ? null : finalText;
    brainTrain({ text, predicted: brainPred, success, error });
  }

  entry.history.push({ role: 'assistant', content: finalText });

  const trimmed = [entry.history[0], ...entry.history.slice(-18)];
  entry.history = trimmed;

  return { response: finalText, toolCalls: [], sessionId: entry.sessionId };
}

async function _execTool(name, argsRaw) {
  let args;
  try { args = typeof argsRaw === 'string' ? JSON.parse(argsRaw) : argsRaw; } catch { return `[Error] Invalid JSON: ${String(argsRaw).slice(0, 80)}`; }
  try {
    // [HOOKS] preTool — permission/限流/撤销 注册的 hook 链, 抛 throw 中止 (Step 6.1 / L3 整车基础)
    await hookPre(name, args);
    const r = await codingExec(name, args);
    const s = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
    const truncated = s.length > 8000 ? s.slice(0, 8000) + '\n... (truncated)' : s;
    // [HOOKS] postTool — log/transform chain, hook 抛 throw 不阻断主流程 (warn 而已)
    return await hookPost(name, args, truncated);
  } catch (e) {
    return `[Error] ${e.message}`;
  }
}

export function getHistory(chatId) {
  const entry = _sessions.get(chatId);
  return entry ? [...entry.history] : [];
}

// compose 契约入口
//   inputs: { text, chatId?, guardian?, tools? }
//   deps:   { guardian: { guardian } }
//   outputs: { response, toolCalls }
export async function run({ inputs = {}, deps = {} } = {}) {
  if (!_provider) await initProvider();
  const { text, chatId = 'default' } = inputs;
  if (!text) throw new Error('tool-loop.run: text required');
  const guardianOpt = inputs.guardian || deps.guardian?.guardian;
  const opts = {};
  if (guardianOpt) opts.guardian = guardianOpt;
  if (Array.isArray(inputs.tools) && inputs.tools.length > 0) opts.tools = inputs.tools;
  if (typeof inputs.role === 'string') opts.role = inputs.role;
  const r = await processText(text, chatId, opts);
  return { outputs: { response: r.response || '', toolCalls: r.toolCalls || [] } };
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

// 最小 smoke test — 验证模块加载 + provider 初始化
export async function test() {
  const errors = [];
  try {
    await generateSessionName();
    await getHistory();
    await processText();
    await initProvider();
    if (typeof initProvider !== 'function') errors.push('initProvider not a function');
    if (typeof processText !== 'function') errors.push('processText not a function');
    if (typeof run !== 'function') errors.push('run not a function');
  } catch (e) { errors.push(e.message); }
  // 不实际调 LLM — 那是 e2e 测试的事
  return { ok: errors.length === 0, errors };
}
