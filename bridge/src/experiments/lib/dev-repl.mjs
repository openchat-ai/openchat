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

// 5 件套 v2 件套 5: 执行边界 (execution boundary).
// 三层: (a) MAX_ROUNDS=30 兜底 (cap 总轮数, 防 subagent 卡死),
// (b) READ_BUDGET=3 软约束 (read-style tool 连续 N 次后注入 phase transition 提示, 防 exploration 链不切到 write),
// (c) 决断力 (decision under uncertainty) — systemMsg 显式禁止 surrender/ask user, 强制 unilateral decision.
// (d) 强倒计时 (diff proposal → must edit) — M3 produce diff 块后, N 轮内必须 emit edit_file, 不允许再问 a/b/c.
// v7 失败: exploration 链不切到 write 链. (b) 修.
// v8' 失败: M3 在 (b) 触发后给 plan + ask 2 确认. (c) 修 (改 surrender 为 propose diff).
// v9 失败: M3 produce diff 但 ask (a/b/c) 选哪个. (d) 修 (强倒计时逼 edit_file).
const MAX_ROUNDS = 30;
const READ_BUDGET = 3;
const DIFF_COUNTDOWN = 2; // 件 5 (d): produce diff 后给 N 轮机会 edit_file
const READ_TOOLS = new Set(['read_file', 'grep', 'list_directory', 'get_cwd', 'find_refs', 'list_refs', 'exec_command']);
const WRITE_TOOLS = new Set(['edit_file', 'write_file', 'hash_edit', 'multi_edit', 'ast_edit']);

function detectDiffProposal(text) {
  if (!text) return false;
  return /```(?:diff|patch)\b/.test(text) || /^@@\s+-/m.test(text);
}

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
  // Raw JSON fallback (v6 ac623ffb fix): M3 / 弱模型有时不包 XML envelope, 直接出 raw JSON.
  // 三层兜底, 依次试, 命中一个就 break. Append-only, 不破坏 XML match 路径.
  if (calls.length === 0 && text) {
    const trimmed = text.trim();
    // 兜底 1: 整段 content 是单个 raw JSON 对象 {"name":..., "args":...}
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj && obj.name && obj.args !== undefined) {
          calls.push({ name: String(obj.name), args: typeof obj.args === 'object' ? obj.args : {} });
        }
      } catch { /* fall through */ }
    }
    // 兜底 2: ```json code block 嵌入
    if (calls.length === 0) {
      const codeMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeMatch) {
        try {
          const obj = JSON.parse(codeMatch[1]);
          if (obj && obj.name && obj.args !== undefined) {
            calls.push({ name: String(obj.name), args: typeof obj.args === 'object' ? obj.args : {} });
          }
        } catch { /* fall through */ }
      }
    }
    // 兜底 3: 任意位置的 {"name": "...", "args": {...}} inline 匹配
    if (calls.length === 0) {
      const inlineMatch = trimmed.match(/\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*\}/);
      if (inlineMatch) {
        try {
          const args = JSON.parse(inlineMatch[2]);
          calls.push({ name: inlineMatch[1], args: typeof args === 'object' ? args : {} });
        } catch { /* fall through */ }
      }
    }
  }
  return calls.length ? calls : null;
}

export async function startDevRepl(modelOverride, chatId, initialMessage) {
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
  // 5 件套 v2 件 4: try-once-then-skip. pickFirstAlive 内部不抛 (line 13 invariant),
  // 但外层加 try-catch 兜底, 防止任何未来回归 (例如 import 失败 / cfg 异常) 把 crash 传进 bridge boot.
  let picked;
  try {
    picked = await pickFirstAlive(fallbacks, cfg, { silent: false, timeoutMs: 8000 });
  } catch (e) {
    process.stdout.write(`\x1b[33m[bridge] pickFirstAlive 异常: ${e.message?.slice(0, 100)} → 降级 diagnose\x1b[0m\n`);
    picked = { ok: false, error: e.message, tried: [] };
  }
  if (!picked.ok) {
    // picker 已逐项报告, 调 diagnose 拿 actionable fix
    let diag;
    try { diag = await diagnose({ silent: false }); } catch (e2) {
      diag = { lines: ['[bridge] diagnose 异常: ' + (e2.message?.slice(0, 100) || 'unknown')], fix: '运行 `openchat config` 检查 provider/key 配置' };
    }
    for (const line of diag.lines) process.stdout.write(line + '\n');
    process.stdout.write(`\x1b[33m[bridge] No available provider — pre-flight 失败, REPL 启动中止. 修好后重试.\x1b[0m\n`);
    // 不 throw: 避免 crash 污染 bridge boot 阶段. 直接返回 (让 CLI 干净退出)
    return;
  }
  let provider = picked.provider;
  let providerLabel = picked.label;
  // Bug fix: providerLabel = "<provider>/<model>" 但 model 可能含斜杠 (openrouter "deepseek/deepseek-chat"),
  // split('/')[1] 拿错的. 用 cfg.current.model 拿, fallback 到 label 的剩余部分.
  const labelParts = providerLabel.split('/');
  let MODEL = cfg.current?.model || (labelParts.length > 2 ? labelParts.slice(1).join('/') : labelParts[1]) || currentModel;
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

Slash commands (user may type):
- 用户可输入 /workflow <name> 触发 step-workflow (17.mjs), 顺序跑预定义的多步实验, 必要步骤失败会中止.

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

Error → Self-Heal Cheat Sheet (你看到的错误信号, 含义, 你该做什么):

[GP] 参数/JSON 错 (连续 3 次) — 含义: 你输出截断/转义崩. 立刻改用 exec_command(command="type <path>") 或 list_directory(path="...") 读外部文件, 避开 JSON 转义.
[GP] enum 越界 / 缺参数 / 未知参数 / 类型错 — 含义: 你瞎填. 看错误里说的 "应为 X, 实际为 Y", 严格照改.
[GP] Unknown tool: <name> — 含义: 你编造了工具. 系统只暴露已注册的 tools, 别发明.

[lint-gate] <file> lint 失败 — 含义: 你改完的代码 lint 没过. 修对应错, 不要 force=true 跳过.
[Edit failed at lint: ...] — 同上, 改 search 重写, 不调 force=true.
[Edit failed at test: ...] — quality gate test 拦. 修测试; 实在不行 test=false (lint 仍跑).

ENOENT / Path traversal / EACCES — read_file 路径错. ENOENT→list_directory 父目录; traversal→改用相对路径或 allowExternal=true (只读).
Search string not found / appears N times — edit_file 失败. 先 read_file 重读, 不唯一就在 search 前后各加 1 行 anchor.
Hash anchor not found — hash_edit 失败. 重新 read_file 拿 md5(line).slice(0,8), 别凭记忆.
Command rejected by safety check — exec_command 命中 rm/mv/重定向. 改用工具原语: 写文件 write_file, "删" 用 write_file 空内容覆盖.
timeout (工具 10s) — 加 timeout=60000; 拆步骤; 大输出加 compress=true.
ENOBUFS / too long / Output truncated — 输出超 100KB 或 8000 字. grep 加 include="*.js" 缩 ext; 分段读; 改用 grep 精确定位.

[dependency] <tool> needs: <missing> — 步骤前提未满足 (例: edit_file 前没 read_file). 别调它, 先补前提.
[MAX_ROUNDS 30 撞] / [STOP] — 任务太复杂/太久. 立即收尾给中文最终回答, 别再调 tool.
[/task] subagent ok:false — /task 子 agent 失败. 换需求重派, 或自己干, 别无限重试.
当前目录不是 git 仓库 / 无未提交的变更 — git_commit 错. 先 git_log 验证, 空 diff 就告诉用户没必要 commit.
pre-commit hook failed — 钩子挂. 返 stderr 给用户, 别强 commit.

5 高频工具自救速查:
- read_file 失败 → list_directory 父目录 或 exec_command("type <path>") 绕 JSON 转义
- edit_file search 拼错 → read_file 重读, 重新对齐 search 字符串
- edit_file 不唯一 → search 前后各加 1 行 anchor
- exec_command safety 拒 → 改用工具原语 (write_file 替代 echo>)
- grep 0 命中 → 去 ^, 改 case-insensitive, 加 include="*.ext"
- grep ENOBUFS → 必带 include, 缩到具体 ext
- git_commit 空 diff → 没必要, 告诉用户

何时换工具 vs 何时收手:
- 换工具: read_file 失败→exec_command("type"); grep 0→find_refs 语义级; edit_file search 错→read_file 重读; edit_file lint 拦→lint_run 看错
- 收手: error-tracker 累计 ≥ 3 相似错就换思路; 5+ 不同 tool 全挂就回退给用户 ("我需要您介入: <原因>. 您能否: a/b/c?")

原则: 撞墙先自救 (换工具/换参数/换路径), 自救 3 次还挂就坦白, 别在 [Error] 上反复横跳.

Rules:
- No hard limit on tool calls. Keep exploring until you understand the ROOT CAUSE.
- But aim to read only KEY files (entry point + handler + reply), not every file in the project.
- For each key file you read, add a comment about what it does.
- Answer in Chinese, reference specific code lines, explain the flow.

DECISION UNDER UNCERTAINTY (决断力, 件 5 c):
- 你是自主 agent, 任务来了就做, 默认 make unilateral decision.
- 禁止 ask user 确认 ("请确认" / "请贴出" / "需要您" / "allow me to read again" 等都是 surrender 信号).
- 不确定时: 选 best guess → 直接 emit write tool (edit_file/write_file/hash_edit/multi_edit/ast_edit) → 改完报告 diff 让 user review.
- 实在无 info: 在 final answer 里贴 proposed patch (\`\`\`diff 块), 而不是 ask user. 让 user 看到你的判断, 不是看到你问问题.
- 例外: 删数据 / rm 命令 / 推 commit 仍需 confirm (safety critical, 见下面 Decision Cheat Sheet). 代码 edit 全部 unilateral.

FIRST-TURN TOOL CALL CONTRACT (硬约束):
- 第一轮 (用户消息刚到时) 的回复必须是直接的 tool call, 不能先输出任何说明文字/中文分析/<think>.
- 必须输出严格的 JSON: {"name": "<tool_name>", "args": {...}}, 不要包在 markdown 代码块里, 不要前缀解释.
- 如果用了 XML 格式, 必须是 <tool_call><invoke name="..."><arg>val</arg></invoke></tool_call> 格式 (parser 在 line 408-414 处理).
- Tool calls may be issued as raw JSON {"name": "...", "args": {...}} or XML <tool_call><invoke name="..."/></tool_call>. Both are valid (parser 兜底 raw JSON, line 110-149).
- 不要先说"好的我来分析", 不要"<think>...</think>" 后空 call, 不要在 tool call 前后夹杂任何非 JSON/XML 的解释文字.
- 唯一例外: 用户消息本身是非技术寒暄 (例如 "/help"、问天气) 时, 可以纯文本回复.`,
  };

  console.log(`\n  openchat bridge — dev mode (${providerLabel})`);
  console.log(`  ${tools.length} tool(s) loaded · cwd ${process.cwd()}`);
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

  // CLI initial message 注入: 跟 stdin 输入走相同路径
  const initialLines = initialMessage ? [initialMessage] : [];
  const lineIter = (async function* () { for (const l of initialLines) yield l; for await (const l of rl) yield l; })();
  for await (const line of lineIter) {
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
              onCompact: async () => {
                costTracker.reset();
                return { ok: true };
              },
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
              onWorkflow: async (workflowName) => {
                // /workflow 派发: 用 17.mjs 跑预定义 step-workflow, 每步走 subagent
                const { run: runStepWorkflow } = await import('../../experiments/17.mjs');
                const { runSubagent } = await import('./subagent.mjs');
                process.stdout.write(`\x1b[36m[/workflow] 派发: ${workflowName}\x1b[0m\n`);
                const SUBAGENT_TOOLS = ['read_file', 'write_file', 'edit_file', 'hash_edit', 'grep', 'list_directory', 'get_cwd'];
                const composeRun = async (expId, inputs) => {
                  const sub = await runSubagent({
                    goal: `[Experiment ${expId}] ${JSON.stringify(inputs).slice(0, 200)}`,
                    deps: { provider, providerLabel, MODEL, cfg, fallbacks, pickFirstAlive, loadTools: loadAllTools },
                    opts: { tools: SUBAGENT_TOOLS },
                  });
                  if (!sub.ok) throw new Error(sub.error || 'subagent failed');
                  return { outputs: { sessionId: sub.sessionId, finalAnswer: sub.finalAnswer, rounds: sub.rounds, toolCalls: sub.toolCalls } };
                };
                const wfRes = await runStepWorkflow({ inputs: { op: 'run', workflowName, composeRun } });
                process.stdout.write(`\x1b[32m[/workflow] 完成: status=${wfRes.outputs.status}${wfRes.outputs.failedStep ? `, failedStep=${wfRes.outputs.failedStep}` : ''}, ${wfRes.outputs.results?.length || 0} 步\x1b[0m\n`);
                return {
                  ok: true,
                  workflowName,
                  status: wfRes.outputs.status,
                  failedStep: wfRes.outputs.failedStep,
                  results: wfRes.outputs.results,
                  content: `[Workflow "${workflowName}" result]\nStatus: ${wfRes.outputs.status}\nSteps: ${wfRes.outputs.results?.length || 0}\n${wfRes.outputs.failedStep ? `Failed at: ${wfRes.outputs.failedStep}\n` : ''}${wfRes.outputs.error ? `Error: ${wfRes.outputs.error}\n` : ''}\nDetails:\n${JSON.stringify(wfRes.outputs.results, null, 2).slice(0, 4000)}`,
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
          if (result.sideEffect?.workflowResult) {
            // /workflow 结果: 共用 pendingTaskResult 注入槽, 下一轮 user input 时注入 messages
            pendingTaskResult = result.sideEffect.workflowResult;
            rl.prompt();
            continue;
          }
        }
        rl.prompt();
        continue;
      }
    }
    persistentStore?.setSession(sessionId, { chatId: sessionId, cwd: process.cwd(), lastActivity: Date.now(), type: 'repl' });

    // Memory context recall (via experiment 43) — 死代码, mem 模块在 line 456 也是死代码, 一并删除
    let memoryCtx = '';
    try {
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
    let transportHintInjected = false; // Tier 1: round 0 user-prompt 改写已注入
    let tier2RetriesLeft = 2; // Tier 2: server-side retry 硬上限 2 次
    let readCount = 0; // 件 5 (b): read-style tool 累计, 触发 phase transition 后 reset
    let writeHappened = false; // 件 5 (b): write-style tool 发生过则短路, 不再 nudge
    let diffCountdown = 0; // 件 5 (d): diff proposal 倒计时 (0=未触发, >0=还剩 N 轮必须 emit edit_file)

    for (let round = 0; round < MAX_ROUNDS; round++) {
      // 件 5 (b): read budget 软约束 — 连续 N 次 read-style tool 后, 强制 phase transition nudge
      // 件 5 (c): decision under uncertainty — 禁止 surrender / ask user, 强制 unilateral decision
      if (readCount >= READ_BUDGET && !writeHappened) {
        const phaseMsg = `[Execution boundary] You have used ${readCount} read-style tool calls (read_file/grep/list_directory/exec_command) without an edit. You are a self-directed agent — DO NOT ask user for confirmation, DO NOT say "请贴出" / "请确认" / "allow me to read again". Either: (a) emit a write tool (edit_file/write_file/hash_edit/multi_edit/ast_edit) NOW with your best-guess concrete args, OR (b) give a final answer with a proposed \`\`\`diff patch\`\`\` block. Do NOT issue another read tool.`;
        messages.push({ role: 'system', content: phaseMsg });
        process.stdout.write(`\x1b[33m[件5] read budget hit (${readCount} reads), injecting phase transition nudge (决断力 强制)\x1b[0m\n`);
        readCount = 0; // 触发后 reset, 防止每轮重复; 模型若仍只 read, 下一轮再 nudge
      }
      // 件 5 (d): diff proposal 强倒计时 — produce diff 后 N 轮内必须 emit edit_file, 不允许再问 a/b/c
      if (diffCountdown > 0 && !writeHappened) {
        const isFinalChance = diffCountdown === 1;
        const diffMsg = isFinalChance
          ? `[Diff countdown — FINAL CHANCE] You proposed a diff in a previous response. This is your LAST round to call edit_file. If you emit anything other than edit_file, the loop ends with "uncompleted diff proposal". Use edit_file with the search/replace pair from your diff.`
          : `[Diff countdown ${DIFF_COUNTDOWN - diffCountdown + 1}/${DIFF_COUNTDOWN}] You proposed a diff in a previous response. You MUST call edit_file in this round using that exact diff — no more questions, no more options (a/b/c). Use edit_file with the search/replace pair from your diff.`;
        messages.push({ role: 'system', content: diffMsg });
        process.stdout.write(`\x1b[33m[件5d] diff countdown ${DIFF_COUNTDOWN - diffCountdown + 1}/${DIFF_COUNTDOWN}, forcing edit_file${isFinalChance ? ' (FINAL CHANCE)' : ''}\x1b[0m\n`);
        diffCountdown--;
      }
      try {
        const t0 = Date.now();
        let content = '';
        let toolCalls = [];
        let firstChunk = true;
        // Tier 1 transport-layer tool-call force (round 0 only): 在 user 消息**前面**拼 transport 提示,
        // 强制 LLM 在 tool_call 或显式拒绝之间二选一, 禁止 preamble/thinking 绕过去.
        // 方案 A 实验: round 0 同时在 provider 协议层传 tool_choice="required", API 强制必须 tool_call.
        if (round === 0 && !transportHintInjected) {
          const last = messages[messages.length - 1];
          if (last && last.role === 'user') {
            last.content = '[TRANSPORT] Your first reply MUST be exactly one tool call. Output ONLY this JSON: {"name": "<tool_name>", "args": {...}}. Do NOT write any explanation, thinking, or preamble. If you cannot or will not, output {"error": "no_tool_call"} to indicate refusal.\n\n' + last.content;
          }
          transportHintInjected = true;
        }
        const roundOptions = (round === 0) ? { tools, tool_choice: 'required' } : { tools };
        if (typeof provider.chatStream === 'function') {
          lastStreamed = true;
          for await (const ev of provider.chatStream(MODEL, messages, roundOptions)) {
            if (ev.type === 'content' && ev.content) { content += ev.content; if (firstChunk) { firstChunk = false; } process.stdout.write(ev.content); }
            else if (ev.type === 'thinking' && ev.content) { /* 折叠, 不实时打 */ }
            else if (ev.type === 'tool_calls' && ev.toolCalls) { toolCalls = ev.toolCalls; }
            else if (ev.done || ev.type === 'done') break;
          }
          if (content) process.stdout.write('\n');
        } else {
          lastStreamed = false;
          const resp = await provider.chat(MODEL, messages, roundOptions);
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
          // Strip hallucinated system-reminder 防御: M3 在 narrative 约束下会用 "system-reminder" 当 escape hatch,
          // 在 parse 之前剪掉, 防止 LLM 假装被"系统提醒"中断/中止任务.
          const beforeStrip = content;
          content = content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/\bsystem-reminder\b/gi, '').trim();
          if (beforeStrip !== content) process.stdout.write(`\x1b[90m[strip] hallucinated system-reminder removed (${beforeStrip.length - content.length} chars)\x1b[0m\n`);
          const parsed = parseToolCalls(content);
          if (parsed) {
            // v6 ac623ffb: detect raw JSON fallback path (XML match 0 命中 → 走兜底 1/2/3)
            const xmlMatched = /<tool_call>[\s\S]*?<\/tool_call>|<tool_name>[\s\S]*?<\/tool_name>/.test(content);
            if (!xmlMatched && parsed.length) process.stdout.write(`\x1b[36m[parser] raw JSON fallback matched (${parsed.length} tool call(s))\x1b[0m\n`);
            try {
              toolCalls = parsed.map(c => ({ function: { name: c.name, arguments: JSON.stringify(c.args) }, id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }));
              content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').replace(/<tool_name>[\s\S]*?<\/tool_name>/g, '').replace(/<tool_args>[\s\S]*?<\/tool_args>/g, '').trim();
            } catch (jsonErr) {
              // stringify 失败 (循环引用等) → 走 failover 路径
              process.stdout.write(`\x1b[33m[XML-fallback] JSON.stringify 失败: ${jsonErr.message?.slice(0, 80)} → failover\x1b[0m\n`);
              throw new Error(`XML fallback JSON.stringify failed: ${jsonErr.message}`);
            }
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
              // 件 5 (b): read-style tool 累计, write-style tool 触发 reset
              if (READ_TOOLS.has(n)) readCount++;
              if (WRITE_TOOLS.has(n)) { writeHappened = true; readCount = 0; }
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
                // Store successful results in memory (via experiment 43) — 死代码, mem 模块未注册
                try {
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
            // Tier 2 server-side retry: round 0 LLM 出了纯文本, 没 tool_call, 改写更狠的 prompt 重发.
            // 硬上限 2 次 (tier2RetriesLeft), 失败后走 normal finalAnswer 路径.
            if (round === 0 && tier2RetriesLeft > 0) {
              tier2RetriesLeft--;
              const prevSnippet = content.slice(0, 200);
              const retryHint = `[RETRY ${2 - tier2RetriesLeft}/2] You failed to emit a tool call. Your output was: ${prevSnippet}${content.length > 200 ? '...' : ''}. Now output ONLY the JSON tool call, no other text.`;
              process.stdout.write(`\x1b[33m[tier2-retry] round 0 no tool call, retrying (${2 - tier2RetriesLeft}/2)\x1b[0m\n`);
              // 移掉 round 0 的 assistant content, 替换成更强的 user 提示
              const lastUserIdx = messages.findLastIndex(m => m.role === 'user');
              if (lastUserIdx >= 0) {
                const orig = messages[lastUserIdx];
                orig.content = retryHint + '\n\n[Original user request]\n' + (orig.content.replace(/^\[TRANSPORT\][\s\S]*?\n\n/, '') || '');
              } else {
                messages.push({ role: 'user', content: retryHint });
              }
              // 强制 round 0 重跑: 把 round 改回 0 (for 循环 round++ 会变 1, 所以手动重置)
              round = -1;
              continue;
            }
            // 件 5 (d): 检测 diff proposal — 如果 M3 出了 ```diff 块但没 emit edit_file,
            // 启动倒计时, 下一轮强制要求 edit_file, 不允许再 break.
            if (detectDiffProposal(content) && diffCountdown === 0) {
              diffCountdown = DIFF_COUNTDOWN;
              process.stdout.write(`\x1b[33m[件5d] diff proposal detected in final answer, starting ${DIFF_COUNTDOWN}-round countdown to force edit_file\x1b[0m\n`);
              // 把 M3 的 diff proposal 加入 messages 当作 assistant message
              messages.push({ role: 'assistant', content: content || null });
              if (content) histAppend(sessionId, { role: 'assistant', content });
              continue; // 不 break, 让下一轮 (件 5 (d) 倒计时) 逼 edit_file
            }
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
          toolCache.clear(); // 清 cache, 防跨 provider 污染 (B 报告 P0 Bug4)
          messages.length = 0; // 清 messages, 防跨 provider 污染
          messages.push(systemMsg); // 重灌 system msg
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
