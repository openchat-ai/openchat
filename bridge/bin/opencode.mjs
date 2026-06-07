#!/usr/bin/env node
// opencode — CLI demo for all 34 development tools
// === invariants ===
// - No REPL; single-shot commands
// - All output to stdout as JSON or formatted text

import { TOOLS, executeTool } from '../src/tools/coding-tools.mjs';

const [,, cmd, ...args] = process.argv;

function showHelp() {
  console.log('Usage: opencode <tool> [args...]');
  console.log('\nAvailable tools (' + TOOLS.length + '):');
  const rows = TOOLS.map(t => {
    const f = t.function;
    const params = Object.keys(f.parameters?.properties || {}).join(', ');
    return `  ${f.name.padEnd(25)} ${f.description.slice(0, 60)}${params ? ' [' + params + ']' : ''}`;
  });
  console.log(rows.join('\n'));
  console.log('\nExample: opencode lang_parse dart "class Foo {}"');
}

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    showHelp();
    return;
  }

  // Collect positional args into keyed args
  const toolDef = TOOLS.find(t => t.function.name === cmd);
  if (!toolDef) {
    console.error(`Unknown tool: ${cmd}`);
    showHelp();
    process.exit(1);
  }

  const params = toolDef.function.parameters?.properties || {};
  const paramKeys = Object.keys(params);
  const callArgs = {};

  if (paramKeys.length === 0) {
    // no args needed
  } else if (paramKeys.length === 1 && args.length >= 1) {
    callArgs[paramKeys[0]] = args[0];
  } else if (paramKeys.length >= 1 && args.length >= 2 && args.length === paramKeys.length) {
    paramKeys.forEach((k, i) => { callArgs[k] = args[i]; });
  } else if (args.length === 1 && args[0].startsWith('{')) {
    Object.assign(callArgs, JSON.parse(args[0]));
  } else {
    // try key=value pairs
    for (const a of args) {
      const eq = a.indexOf('=');
      if (eq > 0) callArgs[a.slice(0, eq)] = a.slice(eq + 1);
      else if (paramKeys.length === 1) callArgs[paramKeys[0]] = a;
    }
  }

  const result = await executeTool(cmd, callArgs);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
