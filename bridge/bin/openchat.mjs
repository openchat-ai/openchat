#!/usr/bin/env node
// openchat — interactive REPL: tool dispatch + LLM dev-repl
// === invariants ===
// - No args → interactive REPL (loop prompt)
// - First arg matching tool name → single-shot executeTool
// - First arg = free text → start dev-repl (persistent)
// - Flags: --goal, -c/--continue, server

import { TOOLS, executeTool } from '../src/tools/coding-tools.mjs';
import { createInterface } from 'node:readline/promises';

const rawArgs = process.argv.slice(2);
const isServerOnly = rawArgs[0] === 'server';
const isHelp = rawArgs[0] === 'help' || rawArgs[0] === '--help' || rawArgs[0] === '-h';
const isContinue = rawArgs.includes('-c') || rawArgs.includes('--continue');
const goalIdx = rawArgs.findIndex(a => a === '--goal' || a === '-g');
const goalDesc = goalIdx !== -1 ? rawArgs[goalIdx + 1] : null;

const toolNames = TOOLS.map(t => t.function.name);
const firstTool = rawArgs.find(a => toolNames.includes(a));
const hasToolCmd = !isServerOnly && !isHelp && !goalDesc && firstTool !== undefined;
const hasFreeText = !isServerOnly && !isHelp && !goalDesc && !hasToolCmd && rawArgs.length > 0;

// ─── Help ───
function showHelp() {
  console.log(`Usage: openchat [options] [<tool> <args...> | <message>]

Options:
  --help, -h          Show this help
  server              Start bridge only (no REPL)
  -c, --continue      Continue last session
  --goal, -g <desc>   Run goal mode

Tools (${TOOLS.length}):`);
  for (const t of TOOLS) {
    const f = t.function;
    const params = Object.keys(f.parameters?.properties || {}).join(', ');
    console.log(`  ${f.name.padEnd(25)} ${(f.description || '').slice(0, 55)}${params ? ' [' + params + ']' : ''}`);
  }
  console.log(`
Interactive mode (no args):
  openchat              Start interactive REPL
  <tool> <args>         Run tool directly
  <message>             Start LLM dev-repl

In REPL:
  <message>             LLM multi-round chat
  /<tool> <args>        Run tool directly
  /help                 Show tools
  /exit                 Quit`);
}

// ─── Init bridge ───
async function initBridge() {
  const { startBridge } = await import('../src/main.js');
  await startBridge([], { headless: true });
  const { setQuiet } = await import('../src/core/chat-poller.mjs').catch(() => ({ setQuiet: () => {} }));
  setQuiet(true);
}

// ─── Execute tool ───
async function runTool(cmd, args) {
  const toolDef = TOOLS.find(t => t.function.name === cmd);
  if (!toolDef) { console.error(`Unknown tool: ${cmd}`); return; }
  const params = toolDef.function.parameters?.properties || {};
  const paramKeys = Object.keys(params);
  const callArgs = {};
  const posArgs = args.filter(a => !a.startsWith('-'));
  if (paramKeys.length === 0) {
    // no args
  } else if (paramKeys.length === 1 && posArgs.length >= 1) {
    callArgs[paramKeys[0]] = posArgs[0];
  } else if (posArgs.length >= 2 && posArgs.length === paramKeys.length) {
    paramKeys.forEach((k, i) => { callArgs[k] = posArgs[i]; });
  } else if (posArgs.length === 1 && posArgs[0].startsWith('{')) {
    Object.assign(callArgs, JSON.parse(posArgs[0]));
  } else {
    for (const a of posArgs) {
      const eq = a.indexOf('=');
      if (eq > 0) callArgs[a.slice(0, eq)] = a.slice(eq + 1);
      else if (paramKeys.length === 1) callArgs[paramKeys[0]] = a;
    }
  }
  const result = await executeTool(cmd, callArgs);
  console.log(JSON.stringify(result, null, 2));
}

// ─── Interactive REPL ───
async function repl() {
  await initBridge();
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'openchat> ' });
  console.log('openchat REPL. Type /help for tools, /exit to quit.\n');
  rl.prompt();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); continue; }
    if (trimmed === '/exit') { break; }
    if (trimmed === '/help') { showHelp(); rl.prompt(); continue; }
    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/);
      const cmd = parts[0];
      if (toolNames.includes(cmd)) {
        await runTool(cmd, parts.slice(1));
      } else {
        console.error(`Unknown tool: ${cmd}`);
      }
      rl.prompt();
      continue;
    }
    const { startDevRepl } = await import('../src/core/dev-repl.mjs');
    await startDevRepl(trimmed);
    rl.prompt();
  }
  rl.close();
}

// ─── Main ───
async function main() {
  if (isHelp || (!isServerOnly && !goalDesc && !hasToolCmd && !hasFreeText && !rawArgs.length)) {
    if (rawArgs.length === 0) {
      await repl();
    } else {
      showHelp();
    }
    return;
  }

  if (isServerOnly) {
    await initBridge();
    console.log('Bridge running. Ctrl+C to stop.');
    process.stdin.resume();
    process.on('SIGINT', () => process.exit(0));
    await new Promise(() => {}); // keep alive
    return;
  }

  if (goalDesc) {
    await initBridge();
    const { run } = await import('../src/experiments/18-goal.mjs');
    const result = await run({ inputs: { description: goalDesc } });
    if (result.outputs) console.log(JSON.stringify(result.outputs, null, 2));
    return;
  }

  if (hasToolCmd) {
    const cmd = rawArgs.find(a => toolNames.includes(a));
    const cmdIdx = rawArgs.indexOf(cmd);
    await runTool(cmd, rawArgs.slice(cmdIdx + 1));
    return;
  }

  if (hasFreeText) {
    await initBridge();
    const { startDevRepl } = await import('../src/core/dev-repl.mjs');
    const msg = rawArgs.find(a => !a.startsWith('-'));
    if (isContinue) {
      const { persistentStore } = await import('../src/core/persistent-store.js');
      const sessions = persistentStore.getAllSessions();
      const last = sessions.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))[0];
      if (last?.cwd) try { process.chdir(last.cwd); } catch {}
      await startDevRepl(msg, last?.chatId || 'default');
    } else {
      await startDevRepl(msg);
    }
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
