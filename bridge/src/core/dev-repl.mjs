import { createInterface } from 'readline';
import os from 'os';

const MAX_ROUNDS = 8;
const MAX_REPEAT = 3;

const toolModules = [
  { name: 'system_exec', import: () => import('../tools/system-exec.mjs'), toolsKey: 'TOOLS', execKey: 'executeTool' },
  { name: 'coding_tools', import: () => import('../tools/coding-tools.mjs'), toolsKey: 'TOOLS', execKey: 'executeTool' },
  { name: 'multi_edit', import: () => import('../tools/multi-edit.mjs'), toolsKey: null, execKey: 'executeTool' },
  { name: 'ast_edit', import: () => import('../tools/ast-edit.mjs'), toolsKey: null, execKey: 'executeTool' },
  { name: 'diff_review', import: () => import('../tools/diff-review.mjs'), toolsKey: null, execKey: 'getGitDiff' },
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

async function execTool(tc, dispatch) {
  const name = tc.function?.name || tc.name;
  const rawArgs = tc.function?.arguments || tc.arguments || '{}';
  let args;
  try { args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs; } catch { return `[Error] Invalid JSON: ${rawArgs.slice(0, 80)}`; }
  for (const fn of Object.values(dispatch)) {
    try {
      const r = await fn(name, args);
      const s = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
      const lines = s.split('\n');
      if (lines.length > 80) return lines.slice(0, 60).join('\n') + `\n... (${lines.length - 60} more lines)`;
      return s.length > 8000 ? s.slice(0, 8000) + '\n... (truncated)' : s;
    } catch { /* try next */ }
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
  const providerName = cfg.current?.provider || 'minimax';
  const MODEL = modelOverride || cfg.current?.model || 'MiniMax-M3';
  const apiKey = cfg.providers?.[providerName]?.apiKey;
  if (!apiKey) throw new Error(`No apiKey for "${providerName}"`);

  const { createProvider } = await import('provider-kit');
  const provider = createProvider(providerName, apiKey);
  await provider.connect(apiKey);
  const { tools, dispatch } = await loadAllTools();

  tools.push(
    { type: 'function', function: { name: 'multi_edit', description: 'Search/replace across files matching glob.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, search: { type: 'string' }, newStr: { type: 'string' }, force: { type: 'boolean' } }, required: ['pattern', 'search', 'newStr'] } } },
    { type: 'function', function: { name: 'ast_edit', description: 'AST rename/replace_body.', parameters: { type: 'object', properties: { path: { type: 'string' }, selector: { type: 'string' }, action: { type: 'string' }, newValue: { type: 'string' } }, required: ['path', 'selector', 'action', 'newValue'] } } },
    { type: 'function', function: { name: 'diff_review', description: 'Show git diff.', parameters: { type: 'object', properties: {}, required: [] } } },
  );

  const toolList = tools.map(t => { const f = t.function || t; const p = f.parameters?.properties ? Object.keys(f.parameters.properties).join(', ') : ''; return `  ${f.name}(${p}): ${f.description || ''}`; }).join('\n');

  const systemMsg = {
    role: 'system',
    content: `You are a software development AI assistant on Windows. You have ${tools.length} tools.

Tools:\n${toolList}

When the user asks to explore/analyze the project, call tools immediately. Never describe — execute.

Notes:
- This is Windows. For directory listing, use exec_command(command="cmd /c dir /b") not ls.
- For reading files, use read_file(path="...").
- For searching files, use glob(pattern="**/*.json").
- If a tool fails, try a different approach.

Call tools one at a time. After results, either call more tools or answer the user.`,
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

    const messages = [systemMsg, { role: 'user', content: input }];
    let finalAnswer = '';
    const callCount = new Map();

    for (let round = 0; round < MAX_ROUNDS; round++) {
      try {
        const t0 = Date.now();
        const resp = await provider.chat(MODEL, messages, { tools });
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        let content = resp.content?.trim() || '';
        let toolCalls = resp.toolCalls || [];

        // Think stripping
        const tm = content.match(/<think>([\s\S]*?)<\/think>/);
        if (tm) { process.stdout.write(`\x1b[90m[think] ${tm[1].trim().split('\n')[0]}\x1b[0m\n`); content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }

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
          messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
          for (const tc of toolCalls) {
            const n = tc.function?.name || tc.name;
            const key = `${n}:${tc.function?.arguments || tc.arguments || '{}'}`;
            const count = (callCount.get(key) || 0) + 1;
            callCount.set(key, count);
            if (count > MAX_REPEAT) {
              const abortMsg = `[loop aborted: ${n} called ${count} times with same args]`;
              process.stdout.write(`\x1b[31m${abortMsg}\x1b[0m\n`);
              messages.push({ role: 'tool', tool_call_id: tc.id, content: abortMsg });
              continue;
            }
            let a = '';
            try { const p = JSON.parse(tc.function?.arguments || tc.arguments || '{}'); a = Object.keys(p).map(k => `${k}=${String(p[k]).slice(0, 40)}`).join(', '); } catch { a = (tc.function?.arguments || tc.arguments || '').slice(0, 40); }
            process.stdout.write(`  \x1b[33m→ ${n}(${a})\x1b[0m `);
            const result = await execTool(tc, dispatch);
            process.stdout.write(`\x1b[32mdone\x1b[0m \x1b[90m(${result.length}B, ${sec}s)\x1b[0m\n`);
            if (result.length < 1000) process.stdout.write(`${result}\n`);
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          }
        } else {
          finalAnswer = content;
          break;
        }
      } catch (e) {
        finalAnswer = `[Error] ${e.message}`;
        break;
      }
    }

    console.log(`\n${finalAnswer || '[max rounds]'}\n`);
    rl.prompt();
  }

  rl.close();
  console.log('bye.');
}
