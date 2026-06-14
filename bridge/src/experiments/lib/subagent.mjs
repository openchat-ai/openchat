// === subagent.mjs ===
// dev-repl 的子 agent 调度：复用主进程的 provider/failover/工具链，
// 用独立 sessionId 隔离历史，把任务一次性跑完并返回 final answer。
//
// === invariants ===
// - runSubagent 入口必须接收 deps (provider/fallbacks/picker/loadTools) 由 dev-repl 注入，
//   不自己再读 cfg 也不再走 startDevRepl
// - sessionId 必须独立于调用方 (子任务历史不污染主 session)
// - 历史轮数上限比 dev-repl 低 (默认 30), 防子任务失控
// - 子任务不持久化到 repl-history (子任务是 throw-away, 不占磁盘)
// - 失败/超时统一返 { ok:false, error }, 不抛
// - system prompt 强化"独立完成, 不需要追问", 子任务不应触发交互
// - toolCache 独立, 不复用主 session 的 cache
// - 返回的 finalAnswer 截断到 4000 字符 (防主 session 被灌爆)
// - opts.tools 接受 tool name 数组 → 窄工具集 (5 件套第 2 条: 子任务越窄越好, M3 偏 build_run 时浪费 round)

import { randomUUID } from 'crypto';

const DEFAULT_MAX_ROUNDS = 30;
const MAX_ANSWER_CHARS = 4000;
const ROUND_DELAY_MS = 200;

export async function runSubagent({ goal, deps, opts = {} }) {
  const startTs = Date.now();
  const sessionId = `subagent_${randomUUID().slice(0, 8)}`;
  const maxRounds = opts.maxRounds || DEFAULT_MAX_ROUNDS;

  if (!goal || typeof goal !== 'string') {
    return { ok: false, error: 'goal 必须是非空字符串', sessionId, durationMs: 0 };
  }
  if (!deps || typeof deps.loadTools !== 'function' || !deps.provider) {
    return { ok: false, error: 'deps 缺失: 需要 { provider, loadTools, pickFirstAlive, cfg }', sessionId, durationMs: 0 };
  }

  let { provider, providerLabel, MODEL, cfg, pickFirstAlive, fallbacks, loadTools } = deps;

  let { tools, dispatch } = await loadTools();
  // 5 件套第 2 条 — 窄工具集. dev-repl 可传 opts.tools, 只暴露子集给 subagent.
  // 默认 = 全 (向后兼容). M3 在 39 工具下偏 build_run 浪费 round, 窄化后 edit_file 命中率上升.
  if (Array.isArray(opts.tools) && opts.tools.length > 0) {
    const before = tools.length;
    tools = tools.filter(t => {
      const name = t.function?.name || t.name;
      return opts.tools.includes(name);
    });
    if (!tools.length) {
      return { ok: false, error: `opts.tools=${JSON.stringify(opts.tools)} 全部不在 loadTools 返回中 (loadTools 给 ${before} 工具)`, sessionId, durationMs: Date.now() - startTs };
    }
  }
  if (!tools.length) {
    return { ok: false, error: '工具加载失败 (loadTools 返回 0 工具)', sessionId, durationMs: Date.now() - startTs };
  }

  const { validateResponse } = await import('./response-validator.mjs');
  const { createStepEnforcer } = await import('./step-enforcer.mjs');
  const { createErrorTracker } = await import('./error-tracker.mjs');
  const enforcer = createStepEnforcer();
  const tracker = createErrorTracker();

  const toolList = tools.map(t => {
    const f = t.function || t;
    const p = f.parameters?.properties ? Object.keys(f.parameters.properties).join(', ') : '';
    return `  ${f.name}(${p}): ${f.description || ''}`;
  }).join('\n');

  const systemMsg = {
    role: 'system',
    content: `You are a subagent (session ${sessionId}). You must complete the goal INDEPENDENTLY in one shot.
You have ${tools.length} tools. Do NOT ask clarifying questions — make reasonable assumptions and proceed.

Tools:
${toolList}

Rules:
- This is Windows. For directory listing use exec_command(command="cmd /c dir /b") not ls.
- Read files with read_file (short paths) or exec_command(command="cmd /c type ...") for long Windows paths.
- Windows paths in JSON arguments must use escaped backslashes: path="C:\\\\Users\\\\name\\\\file.txt".
- For files outside the project root, use read_file with allowExternal=true.
- Aim for a CONCISE final answer (under ${MAX_ANSWER_CHARS} chars). The caller will read your final text — be direct.`,
  };

  const messages = [systemMsg, { role: 'user', content: goal }];
  const toolCache = new Map();
  let finalAnswer = '';
  let totalRounds = 0;
  let totalToolCalls = 0;
  let usedFallback = false;

  for (let round = 0; round < maxRounds; round++) {
    totalRounds = round + 1;
    try {
      let content = '';
      let toolCalls = [];
      if (typeof provider.chatStream === 'function') {
        for await (const ev of provider.chatStream(MODEL, messages, { tools })) {
          if (ev.type === 'content' && ev.content) content += ev.content;
          else if (ev.type === 'tool_calls' && ev.toolCalls) toolCalls = ev.toolCalls;
          else if (ev.done || ev.type === 'done') break;
        }
      } else {
        const resp = await provider.chat(MODEL, messages, { tools });
        content = resp.content || '';
        toolCalls = resp.toolCalls || [];
      }
      content = content.trim();

      // Think stripping (不打印, 子任务静默)
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      if (toolCalls.length) {
        const validation = validateResponse({
          toolCalls: toolCalls.map(tc => ({
            id: tc.id,
            function: { name: tc.function?.name || tc.name, arguments: tc.function?.arguments || tc.arguments },
          })),
        }, tools);
        const validatedCalls = validation.toolCalls;
        if (!validatedCalls.length && validation.errors.length) {
          messages.push({ role: 'system', content: `[Subagent JSON 错误] ${validation.errors.map(e => e.error).join('; ')}。请修正工具调用。` });
          continue;
        }
        messages.push({
          role: 'assistant',
          content: content || null,
          tool_calls: validatedCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })),
        });
        for (const tc of validatedCalls) {
          totalToolCalls++;
          const n = tc.name;
          const check = enforcer.check(n);
          if (!check.ok) {
            messages.push({ role: 'tool', tool_call_id: tc.id, content: `[dependency] ${n} needs: ${check.missing.join(', ')}` });
            continue;
          }
          const cacheKey = `${n}:${JSON.stringify(tc.args)}`;
          if (toolCache.has(cacheKey)) {
            messages.push({ role: 'tool', tool_call_id: tc.id, content: toolCache.get(cacheKey) });
            continue;
          }
          try {
            const result = await execTool({ function: { name: n, arguments: JSON.stringify(tc.args) }, id: tc.id }, dispatch);
            toolCache.set(cacheKey, result);
            enforcer.complete(n);
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          } catch (e) {
            const msg = e.message || String(e);
            tracker.record(n, tc.args, msg, round);
            messages.push({ role: 'tool', tool_call_id: tc.id, content: `[Error] ${msg.slice(0, 200)}` });
          }
        }
        await new Promise(r => setTimeout(r, ROUND_DELAY_MS));
      } else {
        finalAnswer = content;
        break;
      }
    } catch (e) {
      // 失败: 试 fallback
      const currentName = providerLabel.split('/')[0];
      const remaining = (fallbacks || []).filter(fb => fb.name !== currentName);
      if (remaining.length && pickFirstAlive) {
        const nextPicked = await pickFirstAlive(remaining, cfg, { silent: true });
        if (nextPicked.ok) {
          provider = nextPicked.provider;
          providerLabel = nextPicked.label;
          MODEL = providerLabel.split('/')[1] || MODEL;
          fallbacks = remaining;
          usedFallback = true;
          continue;
        }
      }
      return {
        ok: false,
        error: `subagent 失败 (round ${round + 1}): ${e.message?.slice(0, 200) || String(e)}`,
        sessionId,
        durationMs: Date.now() - startTs,
        rounds: totalRounds,
        toolCalls: totalToolCalls,
        usedFallback,
      };
    }
  }

  if (!finalAnswer) {
    // 强制收尾: 让 LLM 总结
    try {
      messages.push({ role: 'system', content: '[STOP] Give a concise final answer summarizing what you found. Be direct.' });
      const resp = await provider.chat(MODEL, messages, { tools: [] });
      finalAnswer = resp.content?.trim() || '[subagent 无输出]';
    } catch (e) {
      finalAnswer = `[subagent 收尾失败: ${e.message?.slice(0, 100)}]`;
    }
  }

  if (finalAnswer.length > MAX_ANSWER_CHARS) {
    finalAnswer = finalAnswer.slice(0, MAX_ANSWER_CHARS) + `\n\n... (truncated, ${finalAnswer.length - MAX_ANSWER_CHARS} chars omitted)`;
  }

  return {
    ok: true,
    sessionId,
    finalAnswer,
    durationMs: Date.now() - startTs,
    rounds: totalRounds,
    toolCalls: totalToolCalls,
    usedFallback,
  };
}

async function execTool(tc, dispatch) {
  const name = tc.function?.name || tc.name;
  const rawArgs = tc.function?.arguments || tc.arguments || '{}';
  let args;
  try { args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs; }
  catch { args = {}; }
  // [HOOKS] preTool — permission/限流/日志 注册的 hook 链
  const { runPre: hPre, runPost: hPost } = await import('./agent-hooks.mjs');
  try { await hPre(name, args); } catch (e) { return `[Hook denied] ${e.message?.slice(0, 200) || 'preTool hook rejected call'}`; }
  let lastError = '';
  for (const fn of Object.values(dispatch)) {
    try {
      let r = await fn(name, args);
      r = await hPost(name, args, r);
      const s = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
      const lines = s.split('\n');
      if (lines.length > 80) return lines.slice(0, 60).join('\n') + `\n... (${lines.length - 60} more lines)`;
      return s.length > 8000 ? s.slice(0, 8000) + '\n... (truncated)' : s;
    } catch (e) {
      const msg = e.message || String(e);
      if (!msg.includes('Unknown tool:')) return `[Error] ${msg.slice(0, 200)}`;
      lastError = msg;
    }
  }
  return `[Error] Tool "${name}" not found`;
}

export const META = { id: 'subagent' };
