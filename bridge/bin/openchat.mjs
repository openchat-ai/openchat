#!/usr/bin/env node
// openchat — CLI unified entry: tool dispatch + LLM multi-round
// === invariants ===
// - First non-flag arg matching a tool name → single-shot executeTool
// - Otherwise → dev-repl (multi-round LLM chat)
// - Flags: --goal, -c/--continue, server, help

import { TOOLS, executeTool } from '../src/tools/coding-tools.mjs';

const rawArgs = process.argv.slice(2);
const isServerOnly = rawArgs[0] === 'server';
const isHelp = rawArgs[0] === 'help' || rawArgs[0] === '--help' || rawArgs[0] === '-h';
const isContinue = rawArgs.includes('-c') || rawArgs.includes('--continue');
const goalIdx = rawArgs.findIndex(a => a === '--goal' || a === '-g');
const goalDesc = goalIdx !== -1 ? rawArgs[goalIdx + 1] : null;

const toolNames = TOOLS.map(t => t.function.name);
const firstTool = rawArgs.find(a => toolNames.includes(a));
const isToolCmd = !isServerOnly && !isHelp && !goalDesc && (firstTool !== undefined);

function showAllTools() {
  console.log('Available tools (' + TOOLS.length + '):');
  for (const t of TOOLS) {
    const f = t.function;
    const params = Object.keys(f.parameters?.properties || {}).join(', ');
    console.log(`  ${f.name.padEnd(25)} ${(f.description || '').slice(0, 60)}${params ? ' [' + params + ']' : ''}`);
  }
}

function showHelp() {
  console.log('Usage: openchat <tool> [args...]');
  console.log('       openchat <chat message>');
  console.log('       openchat --goal "description"');
  console.log('       openchat -c');
  console.log('       openchat server');
  console.log('');
  showAllTools();
}

if (isHelp || (!isServerOnly && !goalDesc && !isToolCmd && !rawArgs.length)) {
  showHelp();
  process.exit(0);
}

if (isToolCmd) {
  const cmd = rawArgs.find(a => toolNames.includes(a));
  const toolDef = TOOLS.find(t => t.function.name === cmd);
  const cmdIdx = rawArgs.indexOf(cmd);
  const posArgs = rawArgs.slice(cmdIdx + 1).filter(a => !a.startsWith('-'));
  const params = toolDef.function.parameters?.properties || {};
  const paramKeys = Object.keys(params);
  const callArgs = {};

  if (paramKeys.length === 0) {
    // no args
  } else if (paramKeys.length === 1 && posArgs.length >= 1) {
    callArgs[paramKeys[0]] = posArgs[0];
  } else if (paramKeys.length >= 1 && posArgs.length >= 2 && posArgs.length === paramKeys.length) {
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
  process.exit(0);
}

const { startBridge } = await import('../src/main.js');
await startBridge([], { headless: true });
const { setQuiet } = await import('../src/core/chat-poller.mjs').catch(() => ({ setQuiet: () => {} }));
setQuiet(true);

if (goalDesc) {
  const { run } = await import('../src/experiments/18-goal.mjs');
  const result = await run({ inputs: { description: goalDesc } });
  if (result.outputs) console.log(JSON.stringify(result.outputs, null, 2));
  process.exit(0);
}

if (!isServerOnly) {
  const { startDevRepl } = await import('../src/core/dev-repl.mjs');
  const modelOverride = rawArgs.find(a => !a.startsWith('-') && a !== goalDesc && !toolNames.includes(a));
  if (isContinue) {
    const { persistentStore } = await import('../src/core/persistent-store.js');
    const sessions = persistentStore.getAllSessions();
    const last = sessions.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))[0];
    if (last?.cwd) try { process.chdir(last.cwd); } catch {}
    await startDevRepl(modelOverride, last?.chatId || 'default');
  } else {
    await startDevRepl(modelOverride);
  }
}
