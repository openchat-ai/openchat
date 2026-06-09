#!/usr/bin/env node

const args = process.argv.slice(2);
const isServerOnly = args[0] === 'server';
const isContinue = args.includes('-c') || args.includes('--continue');
const goalIdx = args.findIndex(a => a === '--goal' || a === '-g');
const goalDesc = goalIdx !== -1 ? args[goalIdx + 1] : null;
const modelOverride = isServerOnly ? undefined : args.find(a => !a.startsWith('-') && a !== goalDesc);

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

  if (isContinue) {
    const { persistentStore } = await import('../src/core/persistent-store.js');
    const sessions = persistentStore.getAllSessions();
    const last = sessions.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))[0];
    if (last?.cwd) {
      try { process.chdir(last.cwd); } catch {}
    }
    await startDevRepl(modelOverride, last?.chatId || 'default');
  } else {
    await startDevRepl(modelOverride);
  }
}
