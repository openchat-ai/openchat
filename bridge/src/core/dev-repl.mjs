import { createInterface } from 'readline';
import os from 'os';

const MAX_ROUNDS = 100;

const toolModules = [
  { name: 'system_exec', import: () => import('../tools/system-exec.mjs'), toolsKey: 'TOOLS', execKey: 'executeTool' },
  { name: 'coding_tools', import: () => import('../tools/coding-tools.mjs'), toolsKey: 'TOOLS', execKey: 'executeTool' },
  { name: 'multi_edit', import: () => import('../tools/multi-edit.mjs'), toolsKey: null, execKey: 'executeTool' },
  { name: 'ast_edit', import: () => import('../tools/ast-edit.mjs'), toolsKey: null, execKey: 'executeTool' },
  { name: 'diff_review', import: () => import('../tools/diff-review.mjs'), toolsKey: null, execKey: 'executeTool' },
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

  // 构建 provider 降级链：current → openrouter → 其他已配置的
  let fallbacks = [];
  const currentProvider = cfg.current?.provider || 'minimax';
  const currentModel = modelOverride || cfg.current?.model || 'MiniMax-M3';
  fallbacks.push({ name: currentProvider, model: currentModel });
  for (const [name, pcfg] of Object.entries(cfg.providers || {})) {
    if (name !== currentProvider && pcfg.apiKey)
      fallbacks.push({ name, model: pcfg.defaultModel || 'openrouter/auto' });
  }

  const { createProvider } = await import('provider-kit');
  let provider = null;
  let providerLabel = '';
  for (const fb of fallbacks) {
    try {
      const p = createProvider(fb.name, cfg.providers[fb.name]?.apiKey);
      await p.connect(cfg.providers[fb.name]?.apiKey);
      provider = p;
      providerLabel = `${fb.name}/${fb.model}`;
      break;
    } catch (e) {
      process.stdout.write(`\x1b[90m[provider ${fb.name} failed: ${e.message.slice(0, 60)}]\x1b[0m\n`);
    }
  }
  if (!provider) throw new Error('No available provider');
  let MODEL = providerLabel.split('/')[1] || currentModel;
  const { tools, dispatch } = await loadAllTools();

  tools.push(
    { type: 'function', function: { name: 'multi_edit', description: 'Search/replace across files matching glob.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, search: { type: 'string' }, newStr: { type: 'string' }, force: { type: 'boolean' } }, required: ['pattern', 'search', 'newStr'] } } },
    { type: 'function', function: { name: 'ast_edit', description: 'AST rename/replace_body.', parameters: { type: 'object', properties: { path: { type: 'string' }, selector: { type: 'string' }, action: { type: 'string' }, newValue: { type: 'string' } }, required: ['path', 'selector', 'action', 'newValue'] } } },
    { type: 'function', function: { name: 'diff_review', description: 'Show git diff.', parameters: { type: 'object', properties: {}, required: [] } } },
  );

  const { validateResponse } = await import('../experiments/lib/response-validator.mjs');
  const { createStepEnforcer } = await import('../experiments/lib/step-enforcer.mjs');
  const { createErrorTracker } = await import('../experiments/lib/error-tracker.mjs');
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

  console.log(`\n  openchat bridge — dev mode (${MODEL})`);
  console.log(`  ${tools.length} tool(s) loaded\n`);

  // 持久化 session（记录 chatId + cwd）
  const sessionId = chatId || `repl_${Date.now()}`;
  const { persistentStore } = await import('./persistent-store.js');
  persistentStore?.setSession(sessionId, { chatId: sessionId, cwd: process.cwd(), lastActivity: Date.now(), type: 'repl' });

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ', terminal: process.platform !== 'win32' });
  if (chatId) process.stdout.write(`\x1b[32m[continue session ${chatId.slice(0, 12)}...]\x1b[0m\n`);
  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input || input === 'exit' || input === 'quit') { if (input === 'exit' || input === 'quit') break; rl.prompt(); continue; }
    persistentStore?.setSession(sessionId, { chatId: sessionId, cwd: process.cwd(), lastActivity: Date.now(), type: 'repl' });

    // Memory context recall (via experiment 43)
    let memoryCtx = '';
    try {
      const mem = await import('../experiments/43-memory.mjs');
      const { outputs } = await mem.run({ inputs: { op: 'hybrid_search', query: input, embedding: [0], topK: 3 } });
      if (outputs?.results?.length) memoryCtx = `[Memory] Related context:\n${outputs.results.map(r => `- ${r.content?.slice(0, 200)}`).join('\n')}`;
    } catch {}

    // Auto goal detection: complex diagnostic tasks get step-by-step guidance
    const isComplex = input.length > 60 || /为什么|什么原因|debug|diagnose|investigate|分析|排查|项目|看看|怎么回事/.test(input);
    const goalGuide = isComplex
      ? { role: 'system', content: '[Goal] This is a multi-step diagnostic. Follow the Debug strategy from system prompt: identify 3-4 key files (entry, handler, reply), read them fully, trace the flow, then conclude. Do NOT read every file in the project — focus on the message/reply path.' }
      : null;

    const messages = [];
    messages.push(systemMsg);
    if (memoryCtx) messages.push({ role: 'system', content: memoryCtx });
    if (goalGuide) messages.push(goalGuide);
    messages.push({ role: 'user', content: input });
    let finalAnswer = '';
    let totalToolCalls = 0;
    const toolCache = new Map(); // session-scoped: cacheKey → result

    for (let round = 0; round < MAX_ROUNDS; round++) {
      try {
        const t0 = Date.now();
        const resp = await provider.chat(MODEL, messages, { tools });
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        let content = resp.content?.trim() || '';
        let toolCalls = resp.toolCalls || [];

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
            const validation = validateResponse({ toolCalls: toolCalls.map(tc => ({ function: { name: tc.function?.name || tc.name, arguments: tc.function?.arguments || tc.arguments } })) }, tools);
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
                  const mem = await import('../experiments/43-memory.mjs');
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
            }
            await new Promise(r => setTimeout(r, 500));
          } else {
            finalAnswer = content;
            break;
          }
      } catch (e) {
        if (round < 1 && (e.message?.includes('500') || e.message?.includes('timeout'))) {
          process.stdout.write(`\x1b[90m[retry ${round + 1}: ${e.message.slice(0, 60)}]\x1b[0m\n`);
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        // 当前 provider 不可用，移除已尝试的全部 provider，取下一个
        const currentName = providerLabel.split('/')[0];
        fallbacks = fallbacks.filter(fb => fb.name !== currentName);
        const nextFb = fallbacks[0];
        if (nextFb) {
          process.stdout.write(`\x1b[33m[fallback to ${nextFb.name}]\x1b[0m\n`);
          provider = createProvider(nextFb.name, cfg.providers[nextFb.name]?.apiKey);
          await provider.connect(cfg.providers[nextFb.name]?.apiKey).catch(() => {});
          providerLabel = `${nextFb.name}/${nextFb.model}`;
          MODEL = nextFb.model || (cfg.providers[nextFb.name]?.defaultModel || 'openrouter/auto');
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
      } catch { finalAnswer = '[max rounds]'; }
    }

    console.log(`\n${finalAnswer}\n`);
    try { rl.prompt(); } catch {}
  }

  rl.close();
  console.log('bye.');
}
