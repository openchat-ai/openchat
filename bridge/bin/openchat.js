#!/usr/bin/env node

const args = process.argv.slice(2);
const isServerOnly = args[0] === 'server';
const modelOverride = isServerOnly ? undefined : args[0];

const { startBridge } = await import('../src/main.js');
await startBridge([], { headless: true });

if (!isServerOnly) {
  const { startDevRepl } = await import('../src/core/dev-repl.mjs');
  await startDevRepl(modelOverride);
}
