#!/usr/bin/env node

const args = process.argv.slice(2);
const isServerOnly = args[0] === 'server';
const isContinue = args.includes('-c') || args.includes('--continue');
const modelOverride = isServerOnly ? undefined : args.find(a => !a.startsWith('-'));

const { startBridge } = await import('../src/main.js');
await startBridge([], { headless: true });

if (!isServerOnly) {
  // CLI 模式下静默 chat-poller 后台日志
  const { setQuiet } = await import('../src/core/chat-poller.mjs').catch(() => ({ setQuiet: () => {} }));
  setQuiet(true);

  const { startDevRepl } = await import('../src/core/dev-repl.mjs');

  if (isContinue) {
    // 读取最近 session，恢复目录 + chatId
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
