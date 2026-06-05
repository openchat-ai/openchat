// Dev REPL — opencode-like development CLI mode for the bridge.
// Invoked by: node src/main.js --cli
// === invariants ===
// - All file paths relative to process.cwd()
// - Reads API key from openchat config (getRuntimeApiKey)
// - Default model: gpt-4o (overridable via --model arg or OPENCHAT_DEV_MODEL env)
// - REPL loop: user input → LLM(tools) → execute → feed back → final answer → repeat

import { createInterface } from 'readline';
import { createProvider } from '../providers/ai-provider.js';
import { persistentConfig } from './persistent-config.js';

const MAX_TOOL_ROUNDS = 8;

/** 从非 FC 模型的文本输出中解析 ACTION: toolName { ... } 调用 */
function extractToolCall(text) {
  const match = text.match(/ACTION:\s*(\w+)\s*({[\s\S]*?})/);
  if (!match) return null;
  try {
    return { toolName: match[1], args: JSON.parse(match[2]) };
  } catch {
    return { toolName: match[1], args: {} };
  }
}

const toolModules = [
  { name: 'system_exec', import: () => import('../tools/system-exec.mjs'), toolsKey: 'TOOLS', execKey: 'executeTool' },
  { name: 'coding_tools', import: () => import('../tools/coding-tools.mjs'), toolsKey: 'TOOLS', execKey: 'executeTool' },
  { name: 'multi_edit', import: () => import('../tools/multi-edit.mjs'), toolsKey: null, execKey: 'executeTool' },
  { name: 'ast_edit', import: () => import('../tools/ast-edit.mjs'), toolsKey: null, execKey: 'executeTool' },
  { name: 'diff_review', import: () => import('../tools/diff-review.mjs'), toolsKey: null, execKey: 'getGitDiff' },
];

export async function loadAllTools() {
  const tools = [];
  const dispatch = {};
  for (const mod of toolModules) {
    try {
      const m = await mod.import();
      const modTools = m[mod.toolsKey];
      if (Array.isArray(modTools)) tools.push(...modTools);
      dispatch[mod.name] = m[mod.execKey];
    } catch (e) {
      console.error(`[dev] Warning: ${mod.name} load failed:`, e.message);
    }
  }
  return { tools, dispatch };
}

export async function executeToolCall(tc, dispatch) {
  const name = tc.function?.name || tc.name;
  const rawArgs = tc.function?.arguments || tc.arguments || '{}';
  let args;
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
  } catch {
    return `[Error] Invalid JSON in tool arguments: ${rawArgs}`;
  }
  for (const execFn of Object.values(dispatch)) {
    try {
      const result = await execFn(name, args);
      const str = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const lines = str.split('\n');
      if (lines.length > 80) return lines.slice(0, 60).join('\n') + `\n... (${lines.length - 60} more lines truncated)`;
      return str.length > 8000 ? str.substring(0, 8000) + '\n... (truncated)' : str;
    } catch { /* try next */ }
  }
  return `[Error] Tool "${name}" not found`;
}

export async function startDevRepl(modelOverride) {
  const providerName = persistentConfig.getCurrentProvider() || 'openai';
  const MODEL = modelOverride || process.env.OPENCHAT_DEV_MODEL || persistentConfig.getPreference('currentModel') || 'gpt-4o';
  const provider = createProvider(providerName);

  // 设置 API key + endpoint 无需 connect（不验证）
  const apiKey = persistentConfig.getApiKey(providerName);
  if (apiKey) {
    provider.apiKey = apiKey;
    provider.connected = true;
  }
  const baseUrl = persistentConfig.getPreference('baseUrl');
  if (baseUrl) provider.endpoint = baseUrl;
  const { tools, dispatch } = await loadAllTools();

  // Add FC schemas for tools without TOOLS array
  tools.push(
    { type: 'function', function: { name: 'multi_edit', description: 'Apply search/replace across files matching glob.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, search: { type: 'string' }, newStr: { type: 'string' }, force: { type: 'boolean' } }, required: ['pattern', 'search', 'newStr'] } } },
    { type: 'function', function: { name: 'ast_edit', description: 'Syntax-aware edit using AST. Actions: rename, replace_body.', parameters: { type: 'object', properties: { path: { type: 'string' }, selector: { type: 'string' }, action: { type: 'string' }, newValue: { type: 'string' } }, required: ['path', 'selector', 'action', 'newValue'] } } },
    { type: 'function', function: { name: 'diff_review', description: 'Show current git diff.', parameters: { type: 'object', properties: {}, required: [] } } },
  );

  console.log(`\n  openchat bridge — dev mode (${MODEL})`);
  console.log(`  ${tools.length} tool(s) loaded`);
  console.log('  Type your request, or "exit" to quit.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });

  const toolList = tools.map(t => {
    const fn = t.function || t;
    const params = fn.parameters?.properties ? Object.keys(fn.parameters.properties).join(', ') : '';
    return `  ${fn.name}(${params}): ${fn.description || ''}`;
  }).join('\n');

  const systemMsg = {
    role: 'system',
    content: `You are a software development AI running in a project directory.\n\nAvailable tools:\n${toolList}\n\nWhen the user asks about code, use tools. If just chatting, answer directly. You can call multiple tools across rounds.`,
  };

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) { rl.prompt(); continue; }
    if (input === 'exit' || input === 'quit') break;

    const messages = [systemMsg, { role: 'user', content: input }];
    let finalAnswer = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let response;
      try {
        const start = Date.now();
        response = await provider.chat(MODEL, messages, tools);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const content = response.content || '';
        let toolCalls = response.toolCalls || [];

        // 非 FC 模型：文本工具调用 fallback
        let thinkText = content;
        if (thinkText) {
          // 剥离 <think> 标签用于显示
          const thinkMatch = thinkText.match(/<think>([\s\S]*?)<\/think>/);
          if (thinkMatch) {
            process.stdout.write(`\x1b[90m[think] ${thinkMatch[1].trim().split('\n')[0]}\x1b[0m\n`);
            thinkText = thinkText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
          }
          if (thinkText && thinkText.length > 0) {
            process.stdout.write(`\x1b[90m[i] ${thinkText.substring(0, 120)}${thinkText.length > 120 ? '...' : ''}\x1b[0m\n`);
          }
        }

        // 非 FC 模型：文本工具调用 fallback
        if (toolCalls.length === 0) {
          const textTc = extractToolCall(response.content || '');
          if (textTc) {
            toolCalls = [{ function: { name: textTc.toolName, arguments: JSON.stringify(textTc.args) }, id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }];
          }
        }

        if (toolCalls.length === 0) { finalAnswer = content; break; }

        messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });

        for (const tc of toolCalls) {
          const name = tc.function?.name || tc.name;
          const rawArgs = tc.function?.arguments || tc.arguments || '{}';
          let args = '{}';
          try { const p = JSON.parse(rawArgs); args = Object.keys(p).map(k => `${k}=${String(p[k]).substring(0, 40)}`).join(', '); } catch {}
          process.stdout.write(`  \x1b[33m→ ${name}(${args})\x1b[0m `);
          const result = await executeToolCall(tc, dispatch);
          const lines = result.split('\n');
          const preview = lines.length > 3 ? lines.slice(0, 3).join('\n') + `\x1b[90m... (${lines.length - 3} more lines)\x1b[0m` : result;
          console.log(`\x1b[32mdone\x1b[0m \x1b[90m(${result.length}B)\x1b[0m`);
          if (result.length < 500) {
            process.stdout.write(`${preview}\n`);
          }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
      } catch (e) {
        finalAnswer = `[Error] ${e.message}`;
        break;
      }
    }

    if (!finalAnswer) finalAnswer = '[Max rounds reached]';
    console.log(`\n${finalAnswer}\n`);
    rl.prompt();
  }

  rl.close();
  console.log('bye.');
}
