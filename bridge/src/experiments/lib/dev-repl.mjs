import { createInterface } from 'readline';
import os from 'os';

// === invariants ===
// - startDevRepl 入口先调 provider-health.diagnose + failover-picker 选 alive provider
// - readline 循环: 同一轮 tool 调用 cache (toolCache Map) 防重复
// - 流式分支: provider.chatStream 不存在时降级 provider.chat, lastStreamed 防重复打印
// - history: 每次 user/assistant/tool 落盘 ~/.openchat/repl-history/<id>.json, /clear 清空
// - /resume 跳到目标: sessionId 不变, 后续 histAppend 仍写**原** session (保护目标不被污染)
// - slash-commands: applySlash async, 调 ctx.onCommit (commit 路径) 和 ctx.availableSessions (/resume 路径)
// - edit-quality-gate: edit tool 完成后异步 fire-and-forget, 失败塞 messages+history, 不阻塞 REPL
// - 全程 never-throw 策略: 所有 catch 静默, gate/pinger 内部保永不抛

// 5 件套 v2 件套 5: 跟 subagent 对齐 30 轮 cap. 之前 100 太高, M3 在长 prompt 下会卡死.
// 100 是早期预 subagent 时代的值, 留作"足够长"的安全网, 实际 e2e 任务 8-15 轮够用.
const MAX_ROUNDS = 30;

const toolModules = [
  { name: 'system_exec', import: () => import('./system-exec.mjs'), toolsKey: 'TOOLS', execKey: 'executeTool' },
  { name: 'coding_tools', import: () => import('./coding-tools.mjs'), toolsKey: 'TOOLS', execKey: 'executeTool' },
  { name: 'multi_edit', import: () => import('./multi-edit.mjs'), toolsKey: null, execKey: 'executeTool' },
  { name: 'ast_edit', import: () => import('./ast-edit.mjs'), toolsKey: null, execKey: 'executeTool' },
  { name: 'diff_review', import: () => import('./diff-review.mjs'), toolsKey: null, execKey: 'executeTool' },
];

async function loadAllTools() {
  const tools = [];
  const dispatch = {};
  for (const mod of toolModules) {
    try {
      const m = await mod.import();
      if (Array.isArray(m[mod.toolsKey])) tools.push(...m[mod.toolsKey]);
      dispatch[mod.name] = m[mod.execKey];
    } catch { /* skip failed */ }
  }
  return { tools, dispatch };
}

function _repairJSON(s) {
  // Try adding missing closing quotes and braces for common LLM truncation
  let fixed = s;
  // Count unescaped quotes — if odd, add a closing quote
  let inStr = false, escape = false, quoteCount = 0;
  for (const c of fixed) { if (escape) { escape = false; continue; } if (c === '\\') { escape = true; continue; } if (c === '"') { inStr = !inStr; quoteCount++; } }
  if (inStr) fixed += '"';
  // Count braces — add missing closing braces
  const opens = (fixed.match(/\{/g) || []).length;
  const closes = (fixed.match(/\}/g) || []).length;
  for (let i = 0; i < opens - closes; i++) fixed += '}';
  return fixed;
}

async function execTool(tc, dispatch) {
  const name = tc.function?.name || tc.name;
  const rawArgs = tc.function?.arguments || tc.arguments || '{}';
  let args;
  try { args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs; }
  catch { args = typeof rawArgs === 'string' ? JSON.parse(_repairJSON(rawArgs)) : rawArgs; }
  let lastError = '';
  for (const fn of Object.values(dispatch)) {
    try {
      const r = await fn(name, args);
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

function parseToolCalls(text) {
  const calls = [];
  const blocks = text?.match(/<tool_call>[\s\S]*?<\/tool_call>/g) || [];
  for (const block of blocks) {
    // Format: <invoke name="x"><param>val</param></invoke>
    for (const inv of block.match(/<invoke[\s\S]*?<\/invoke>/g) || []) {
      const m = inv.match(/<invoke\s+name="([^"]*)"/);
      if (!m) continue;
      const args = {};
      for (const p of inv.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) {
        if (p[1] !== 'invoke') args[p[1]] = p[2].trim();
      }
      calls.push({ name: m[1], args });
    }
    // Format: name(key="val", key2=val2)
    for (const line of block.replace(/<\/?tool_call>/g, '').trim().split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const p = t.indexOf('(');
      if (p <= 0) continue;
      const name = t.slice(0, p).trim();
      try {
        const args = JSON.parse(t.slice(p + 1, t.lastIndexOf(')')));
        calls.push({ name, args });
      } catch { /* skip */ }
    }
  }
  // Format: <tool_name>name</tool_name><tool_args>{...}</tool_args> (standalone)
  for (const nm of text?.match(/<tool_name>([\s\S]*?)<\/tool_name>/g) || []) {
    const name = nm.replace(/<\/?tool_name>/g, '').trim();
    const argsBlock = text.match(/<tool_args>([\s\S]*?)<\/tool_args>/);
    try { calls.push({ name, args: argsBlock ? JSON.parse(argsBlock[1]) : {} }); } catch { /* skip */ }
  }
  return calls.length ? calls : null;
}

export async function startDevRepl(modelOverride, chatId) {
  const cfg = JSON.parse(await import('fs/promises').then(fs => fs.readFile(os.homedir() + '/.config/openchat/config.json', 'utf8')));
  const { CostTracker } = await import('./cost-tracker.mjs');
  const costTracker = new CostTracker(cfg);

  // 构建 provider 降级链：current → openrouter → 其他已配置的
  let fallbacks = [];
  const currentProvider = cfg.current?.provider || 'minimax';
  const currentModel = modelOverride || cfg.current?.model || 'MiniMax-M3';
  fallbacks.push({ name: currentProvider, model: currentModel });
  for (const [name, pcfg] of Object.entries(cfg.providers || {})) {
    if (name !== currentProvider && pcfg.apiKey)
      fallbacks.push({ name, model: pcfg.defaultModel || 'openrouter/auto' });
  }

  const { diagnose } = await import('./provider-health.mjs');
  const { pickFirstAlive } = await import('./failover-picker.mjs');
  const picked = await pickFirstAlive(fallbacks, cfg, { silent: false });
  if (!picked.ok) {
    // picker 已逐项报告, 调 diagnose 拿 actionable fix
    const diag = await diagnose({ silent: false });
    for (const line of diag.lines) process.stdout.write(line + '\n');
    throw new Error(diag.fix ? `No available provider — ${diag.fix.split('\n')[0]}` : 'No available provider');
  }
  let provider = picked.provider;
  let providerLabel = picked.label;
  let MODEL = providerLabel.split('/')[1] || currentModel;
  const { tools, dispatch } = await loadAllTools();

  tools.push(
    { type: 'function', function: { name: 'multi_edit', description: 'Search/replace across files matching glob.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, search: { type: 'string' }, newStr: { type: 'string' }, force: { type: 'boolean' } }, required: ['pattern', 'search', 'newStr'] } } },
    { type: 'function', function: { name: 'ast_edit', description: 'AST rename/replace_body.', parameters: { type: 'object', properties: { path: { type: 'string' }, selector: { type: 'string' }, action: { type: 'string' }, newValue: { type: 'string' } }, required: ['path', 'selector', 'action', 'newValue'] } } },
    { type: 'function', function: { name: 'diff_review', description: 'Show git diff.', parameters: { type: 'object', properties: {}, required: [] } } },
  );

  // 5 件套 v2 件套 1 (动作级 tool): 5 个 raw API 工具默认隐藏, M3 在 39 工具下偏 build_run 浪费 round.
  // OPENCHAT_RAW_TOOLS=1 显式 opt-in 才暴露 (给"我就要 shell"的场景留口子).
  if (process.env.OPENCHAT_RAW_TOOLS !== '1') {
    const RAW_TOOLS = new Set(['build_run', 'lang_run', 'exec_command', 'docker_build', 'sql_parse']);
    for (let i = tools.length - 1; i >= 0; i--) {
      if (RAW_TOOLS.has(tools[i].function?.name)) tools.splice(i, 1);
    }
  }

  const { validateResponse } = await import('./response-validator.mjs');
  const { createStepEnforcer } = await import('./step-enforcer.mjs');
  const { createErrorTracker } = await import('./error-tracker.mjs');
  const enforcer = createStepEnforcer();
  const tracker = createErrorTracker();

  const toolList = tools.map(t => { const f = t.function || t; const p = f.parameters?.properties ? Object.keys(f.parameters.properties).join(', ') : ''; return `  ${f.name}(${p}): ${f.description || ''}`; }).join('\n');

  const systemMsg = {
    role: 'system',
    content: `You are a software development AI assistant on Windows. You have ${tools.length} tools.

Tools:\n${toolList}

When the user asks to explore/analyze the project, call tools immediately. Never describe — execute.

Notes:
- This is Windows. For directory listing, use exec_command(command="cmd /c dir /b") not ls.
- For reading files, use read_file(path="...") for short paths, or exec_command(command="cmd /c type ...") for long Windows paths (JSON may truncate).
- Windows paths in JSON arguments must use escaped backslashes: path="C:\\\\Users\\\\name\\\\file.txt".
- If a tool fails, try a different approach. For files outside the project root, use read_file with allowExternal=true.

Debug strategy (diagnostic tasks):
  Step 1 — Identify: Find entry point (main/src/index), handler (where messages are received), reply/send (where replies go out). Usually 3-4 key files.
  Step 2 — Read: Read those key files FULLY, understand the data flow. Take notes of relevant functions and their signatures.
  Step 3 — Analyze: Trace a message from receive → process → reply. Look for: single-use listeners (once), process.exit, session.clear, or one-shot reply patterns.
  Step 4 — Conclude: Summarize root cause in Chinese with code references. Propose fix only if confident.

Rules:
- No hard limit on tool calls. Keep exploring until you understand the ROOT CAUSE.
- But aim to read only KEY files (entry point + handler + reply), not every file in the project.
- For each key file you read, add a comment about what it does.
- Answer in Chinese, reference specific code lines, explain the flow.`,
  };

  console.log(`\n  openchat bridge — dev mode (${providerLabel})`);
  console.log(`  ${tools.length} tool(s) loaded · session ${sessionId.slice(0, 16)} · cwd ${process.cwd()}`);
  console.log(`  输入 /help 查看命令, /status 看状态, /exit 退出\n`);

  // 持久化 session（记录 chatId + cwd）
  const sessionId = chatId || `repl_${Date.now()}`;
  const { persistentStore } = await import('./persistent-store.js');
  const { loadHistory, appendMessage: histAppend, clearHistory: histClear, listSessions: histList } = await import('./repl-history.mjs');
  const histLoad = loadHistory; // alias
  persistentStore?.setSession(sessionId, { chatId: sessionId, cwd: process.cwd(), lastActivity: Date.now(), type: 'repl' });

  // 续接历史 (-c 模式)
  const resumedHistory = chatId ? loadHistory(sessionId) : [];
  let pendingTaskResult = null; // /task subagent 结果, 下一轮 user input 注入
  if (resumedHistory.length) process.stdout.write(`\x1b[32m[repl-history] load ${resumedHistory.length} msgs from last session\x1b[0m\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ', terminal: process.platform !== 'win32' });
  if (chatId && !resumedHistory.length) process.stdout.write(`\x1b[32m[continue session ${chatId.slice(0, 12)} (无历史)...]\x1b[0m\n`);
  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) { rl.prompt(); continue; }
    if (input === 'exit' || input === 'quit') break;

    // Slash command dispatch (opencode/claudecode 风格)
    if (input.startsWith('/')) {
      const { parseSlash, applySlash } = await import('./slash-commands.mjs');
      const { listSessions: histList } = await import('./repl-history.mjs');
      const parsed = parseSlash(input);
      if (parsed.handled) {
        if (parsed.cmd) {
          // 注入可续接的 session 列表 (合并历史文件 + persistentStore 时间戳)
          const histIds = new Set(histList());
          const sessions = persistentStore?.getAllSessions() || [];
          const availableSessions = sessions
            .filter(s => histIds.has(s.id) && s.type === 'repl')
            .map(s => ({ id: s.id, msgCount: histLoad(s.id).length, lastActivity: s.lastActivity || 0, cwd: s.cwd }))
            .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
            .slice(0, 20);
          const result = await applySlash({
            cmd: parsed.cmd,
            arg: parsed.arg,
            ctx: {
              cfg, providerName: providerLabel.split('/')[0], model: MODEL,
              sessionId, cwd: process.cwd(), toolCount: tools.length, historyRounds: 0,
              availableSessions,
              costSummary: costTracker.formatSummary(),
              onForget: async (cid) => {
                // 1. 删历史文件 (repl-history)
                histClear(cid);
                // 2. 删 persistentStore 元数据
                try { persistentStore?.deleteSession(cid); } catch {}
                return { ok: true };
              },
              onDiff: async () => {
                const ac = await import('./auto-commit.mjs');
                if (!ac.hasGitRepo(process.cwd())) {
                  return { error: '当前目录不是 git 仓库' };
                }
                const diff = ac.gitDiff(process.cwd());
                return { diff };
              },
              onCommit: async () => {
                // 动态 import (避免启动时强耦合 auto-commit)
                const ac = await import('./auto-commit.mjs');
                if (!ac.hasGitRepo(process.cwd())) {
                  return { ok: false, message: '当前目录不是 git 仓库' };
                }
                const diff = ac.gitDiff(process.cwd());
                if (!diff.trim()) {
                  return { ok: false, message: '无未提交的变更 (git diff 为空)' };
                }
                const msg = ac.generateMessage(diff, process.cwd());
                const result = await ac.autoCommit([], process.cwd()).catch(() => {
                  return { committed: false, message: msg, diff: diff.slice(0, 500) };
                });
                if (result.committed === false && result.diff) {
                  return { ok: true, committed: false, message: `建议 commit msg: ${msg}\n(未自动 commit, 请手动执行)`, diff: result.diff };
                }
                return { ok: true, committed: true, message: `已 commit: ${msg}` };
              },
              onTask: async (goal) => {
                // 派生子 agent 跑独立 session, 返回完整 result (由 slash 端再放进 sideEffect)
                const { runSubagent } = await import('./subagent.mjs');
                process.stdout.write(`\x1b[36m[/task] 派发 subagent: ${goal.slice(0, 80)}${goal.length > 80 ? '...' : ''}\x1b[0m\n`);
                // 5 件套第 2 条: 子任务用窄工具集 (4 read/edit + grep) → M3 不再偏 build_run, edit_file 命中率上升
                const SUBAGENT_TOOLS = ['read_file', 'write_file', 'edit_file', 'hash_edit', 'grep', 'list_directory', 'get_cwd'];
                const result = await runSubagent({
                  goal,
                  deps: {
                    provider, providerLabel, MODEL, cfg, fallbacks,
                    pickFirstAlive, loadTools: loadAllTools,
                  },
                  opts: { tools: SUBAGENT_TOOLS },
                });
                if (!result.ok) {
                  process.stdout.write(`\x1b[33m[/task] subagent 失败: ${result.error}\x1b[0m\n`);
                  return { ok: false, error: result.error };
                }
                process.stdout.write(`\x1b[32m[/task] subagent 完成: ${result.rounds} 轮, ${result.toolCalls} 工具调用, ${(result.durationMs / 1000).toFixed(1)}s, sessionId=${result.sessionId}\x1b[0m\n`);
                return {
                  ok: true,
                  sessionId: result.sessionId,
                  content: `[Subagent result from ${result.sessionId}]\nGoal: ${goal.slice(0, 200)}\n\nResult:\n${result.finalAnswer}`,
                  rounds: result.rounds,
                  toolCalls: result.toolCalls,
                  durationMs: result.durationMs,
                };
              },
            },
          });
          if (result.reply) process.stdout.write(result.reply + '\n');
          if (result.sideEffect?.exit) break;
          if (result.sideEffect?.setModel) {
            MODEL = result.sideEffect.setModel;
            providerLabel = providerLabel.split('/')[0] + '/' + MODEL;
          }
          if (result.sideEffect?.clearHistory) { histClear(sessionId); resumedHistory.length = 0; rl.prompt(); continue; }
          if (result.sideEffect?.resumeTo) {
            // 跳到指定 session: 重置 resumedHistory + 改 sessionId
            const newId = result.sideEffect.resumeTo;
            const newHist = histLoad(newId);
            resumedHistory.length = 0;
            for (const m of newHist) resumedHistory.push(m);
            process.stdout.write(`\x1b[32m[resumed ${newHist.length} msgs from ${newId}]\x1b[0m\n`);
            // 注意: sessionId 仍为原值, 后续 append 写入新 session 文件
            // (避免污染原 session 历史)
            // 若想"接着原 session 写", 改成: const oldId = sessionId; ... sessionId = newId
            // 当前选择: 读但不写, 保护原 session 完整
            rl.prompt();
            continue;
          }
          if (result.sideEffect?.taskResult) {
            // /task 结果: 暂存到 pendingTaskResult, 下一轮 user input 时注入 messages
            pendingTaskResult = result.sideEffect.taskResult;
            rl.prompt();
            continue;
          }
        }
        rl.prompt();
        continue;
      }
    }
    persistentStore?.setSession(sessionId, { chatId: sessionId, cwd: process.cwd(), lastActivity: Date.now(), type: 'repl' });

    // Memory context recall (via experiment 43)
    let memoryCtx = '';
    try {
      const mem = await import('../43-memory.mjs');
      const { outputs } = await mem.run({ inputs: { op: 'hybrid_search', query: input, embedding: [0], topK: 3 } });
      if (outputs?.results?.length) memoryCtx = `[Memory] Related context:\n${outputs.results.map(r => `- ${r.content?.slice(0, 200)}`).join('\n')}`;
    } catch {}

    // Auto goal detection: complex diagnostic tasks get step-by-step guidance
    const isComplex = input.length > 60 || /为什么|什么原因|debug|diagnose|investigate|分析|排查|项目|看看|怎么回事/.test(input);
    const goalGuide = isComplex
      ? { role: 'system', content: '[Goal] This is a multi-step diagnostic. Follow the Debug strategy from system prompt: identify 3-4 key files (entry, handler, reply), read them fully, trace the flow, then conclude. Do NOT read every file in the project — focus on the message/reply path.' }
      : null;

    const messages = [];
    // 灌入续接的历史 (跳过原 systemMsg, 避免被新 system 覆盖)
    for (const m of resumedHistory) {
      if (m.role === 'system') continue; // 旧 system 略过
      messages.push(m);
    }
    messages.push(systemMsg);
    if (memoryCtx) messages.push({ role: 'system', content: memoryCtx });
    if (goalGuide) messages.push(goalGuide);
    messages.push({ role: 'user', content: input });
    // 续接模式下: 本轮新 user 也追加到历史文件
    histAppend(sessionId, { role: 'user', content: input });
    let finalAnswer = '';
    let totalToolCalls = 0;
    let lastStreamed = false; // 末轮是否走了流式 (避免 console.log 重复打印)
    const toolCache = new Map(); // session-scoped: cacheKey → result

    for (let round = 0; round < MAX_ROUNDS; round++) {
      try {
        const t0 = Date.now();
        let content = '';
        let toolCalls = [];
        let firstChunk = true;
        if (typeof provider.chatStream === 'function') {
          lastStreamed = true;
          for await (const ev of provider.chatStream(MODEL, messages, { tools })) {
            if (ev.type === 'content' && ev.content) { content += ev.content; if (firstChunk) { firstChunk = false; } process.stdout.write(ev.content); }
            else if (ev.type === 'thinking' && ev.content) { /* 折叠, 不实时打 */ }
            else if (ev.type === 'tool_calls' && ev.toolCalls) { toolCalls = ev.toolCalls; }
            else if (ev.done || ev.type === 'done') break;
          }
          if (content) process.stdout.write('\n');
        } else {
          lastStreamed = false;
          const resp = await provider.chat(MODEL, messages, { tools });
          content = resp.content || '';
          toolCalls = resp.toolCalls || [];
        }
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        content = content.trim();

        // cost 累计 (非 fallback chat 路径, 算本轮)
        costTracker.recordUsage({
          messages,
          responseContent: content,
          model: MODEL,
          providerName: providerLabel.split('/')[0],
        });

        // Think stripping
        const tm = content.match(/<think>([\s\S]*?)<\/think>/);
        if (tm) { process.stdout.write(`\x1b[36m[think] ${tm[1].trim().split('\n')[0]}\x1b[0m\n`); content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }

        // XML fallback
        if (!toolCalls.length) {
          const parsed = parseToolCalls(content);
          if (parsed) {
            toolCalls = parsed.map(c => ({ function: { name: c.name, arguments: JSON.stringify(c.args) }, id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }));
            content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').replace(/<tool_name>[\s\S]*?<\/tool_name>/g, '').replace(/<tool_args>[\s\S]*?<\/tool_args>/g, '').trim();
          }
        }

          if (toolCalls.length) {
            if (content) process.stdout.write(`\x1b[90m[i] ${content.slice(0, 120)}${content.length > 120 ? '...' : ''} (${sec}s)\x1b[0m\n`);
            const validation = validateResponse({ toolCalls: toolCalls.map(tc => ({ id: tc.id, function: { name: tc.function?.name || tc.name, arguments: tc.function?.arguments || tc.arguments } })) }, tools);
            const validatedCalls = validation.toolCalls;
            if (!validatedCalls.length && validation.errors.length) {
              const nudge = `[GP] ${validation.errors.map(e => e.error).join('; ')}。请修正工具调用。`;
              process.stdout.write(`\x1b[31m${nudge}\x1b[0m\n`);
              messages.push({ role: 'system', content: nudge });
              const jsonFailRound = (messages.filter(m => m.role === 'system' && m.content?.includes('JSON 参数解析失败')).length);
              if (jsonFailRound >= 3) {
                messages.push({ role: 'system', content: '[GP] 连续 JSON 参数解析失败，请改用 exec_command(command="type <path>") 或 list_directory(path="...") 读取外部文件，避免在 JSON 中转义长 Windows 路径。' });
              }
              continue;
            }
            messages.push({ role: 'assistant', content: content || null, tool_calls: validatedCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) });
            for (const tc of validatedCalls) {
              totalToolCalls++;
              const n = tc.name;
              const a = Object.keys(tc.args || {}).map(k => `${k}=${String(tc.args[k]).slice(0, 40)}`).join(', ');
              process.stdout.write(`  \x1b[33m→ ${n}(${a})\x1b[0m `);
              const check = enforcer.check(n);
              if (!check.ok) {
                process.stdout.write(`\x1b[31m[dependency] ${n} 需要先: ${check.missing.join(', ')}\x1b[0m\n`);
                messages.push({ role: 'tool', tool_call_id: tc.id, content: `[dependency] ${n} needs: ${check.missing.join(', ')}` });
                continue;
              }
              let result;
              const cacheKey = `${n}:${JSON.stringify(tc.args)}`;
              if (toolCache.has(cacheKey)) {
                result = toolCache.get(cacheKey);
                process.stdout.write(`\x1b[32mcached\x1b[0m \x1b[90m(${result.length}B)\x1b[0m\n`);
                messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                continue;
              }
              try {
                result = await execTool({ function: { name: n, arguments: JSON.stringify(tc.args) }, id: tc.id }, dispatch);
                toolCache.set(cacheKey, result);
                enforcer.complete(n);
                // Store successful results in memory (via experiment 43)
                try {
                  const mem = await import('../43-memory.mjs');
                  await mem.run({ inputs: { op: 'store', id: `${Date.now()}_${n}`, embedding: [0], content: `[${n}] ${result.slice(0, 500)}`, metadata: { tool: n, args: tc.args }, type: 'tool_result' } });
                } catch {}
              } catch (e) {
                const msg = e.message || String(e);
                let guidance = '';
                if (msg.includes('ENOENT') || msg.includes('not found')) guidance = '文件/目录不存在，请检查路径。';
                else if (msg.includes('EACCES') || msg.includes('permission')) guidance = '权限不足，请检查文件权限或用 exec_command 替代。';
                else if (msg.includes('timeout') || msg.includes('TIMEOUT')) guidance = '工具超时，尝试缩小范围或重试。';
                else if (msg.includes('ENOBUFS') || msg.includes('too long')) guidance = '输出太长，尝试用 grep/glob 缩小搜索范围。';
                else if (msg.includes('Path traversal')) guidance = '外部路径需要 allowExternal=true。';
                result = `[Error] ${msg.slice(0, 200)}${guidance ? `\n[Guidance] ${guidance}` : ''}`;
                tracker.record(n, tc.args, msg, round);
              }
              process.stdout.write(`\x1b[32mdone\x1b[0m \x1b[90m(${result.length}B, ${sec}s)\x1b[0m\n`);
              messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
              histAppend(sessionId, { role: 'tool', tool_call_id: tc.id, content: result });

              // edit-quality-gate: 改文件后异步跑 lint (失败不阻塞, 写入 history 供下轮 LLM 看到)
              const { isEditTool, checkEditedFile } = await import('./edit-quality-gate.mjs');
              if (isEditTool(n) && tc.args?.path) {
                checkEditedFile(tc.args.path).then(gate => {
                  if (!gate.ok && gate.errors.length) {
                    const errSummary = gate.errors.slice(0, 5).map(e => `  ${e.line || '?'}:${e.column || '?'} ${e.message || e.text || ''}`).join('\n');
                    const gateMsg = `[lint-gate] ${gate.summary}\n${errSummary}`;
                    process.stdout.write(`\x1b[33m${gateMsg}\x1b[0m\n`);
                    messages.push({ role: 'system', content: gateMsg });
                    histAppend(sessionId, { role: 'system', content: gateMsg });
                  }
                }).catch(() => { /* swallow, gate 已保永不抛 */ });
              }
            }
            await new Promise(r => setTimeout(r, 500));
          } else {
            finalAnswer = content;
            // assistant 最终回答落盘
            if (content) histAppend(sessionId, { role: 'assistant', content });
            break;
          }
      } catch (e) {
        if (round < 1 && (e.message?.includes('500') || e.message?.includes('timeout'))) {
          process.stdout.write(`\x1b[90m[retry ${round + 1}: ${e.message.slice(0, 60)}]\x1b[0m\n`);
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        // 当前 provider 不可用，移除已尝试的全部 provider，用 picker 选下一个
        const currentName = providerLabel.split('/')[0];
        fallbacks = fallbacks.filter(fb => fb.name !== currentName);
        const nextPicked = await pickFirstAlive(fallbacks, cfg, { silent: false });
        if (nextPicked.ok) {
          provider = nextPicked.provider;
          providerLabel = nextPicked.label;
          MODEL = providerLabel.split('/')[1] || currentModel;
          totalToolCalls = 0; // 新 provider 从头计数
          round = -1;
          continue;
        }
        finalAnswer = `[Error] ${e.message}`;
        break;
      }
    }

    // Force final answer summarization if LLM ran out of rounds
    if (!finalAnswer) {
      try {
        messages.push({ role: 'system', content: '[STOP] You have gathered enough info. Give a final answer now in Chinese. Be concise.' });
        const resp = await provider.chat(MODEL, messages, { tools: [] });
        finalAnswer = resp.content?.trim() || '[max rounds]';
        lastStreamed = false; // fallback 走了非流式 chat, 允许 console.log 打印
      } catch { finalAnswer = '[max rounds]'; }
    }

    // finalAnswer: 流式分支已实时打印 content, 跳过; 非流式分支才补打
    if (finalAnswer && !lastStreamed) console.log(`\n${finalAnswer}\n`);
    try { rl.prompt(); } catch {}
  }

  rl.close();
  console.log('bye.');
}
