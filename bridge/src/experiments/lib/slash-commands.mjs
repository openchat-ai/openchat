// === slash-commands.mjs ===
// dev-repl 的斜杠命令分发 (opencode /claudecode 风格):
//   /help    — 列出所有命令
//   /status  — 当前 session/provider/model/工具数/历史轮数
//   /clear   — 清屏 + 重置历史
//   /model <name|id> — 切换当前 model (写入 cfg.current.model)
//   /exit    — 退出 (alias: /quit)
//
// 故意不做 (留给后续 PR): /sessions /compact /cost /bug /init /memory
// 理由: 这些要新建 storage 子模块, 一次提交 diff 超 500 行 (违反 R4)
//
// I/O (compose 契约, 供实验 10 dev-aux 测试):
//   { input, ctx } → { handled: bool, reply?: string, sideEffect?: { setModel?: string, clearHistory?: bool, exit?: bool } }

export const COMMANDS = {
  help:    { arg: '',              desc: '列出所有 slash 命令' },
  status:  { arg: '',              desc: '显示 session/provider/model/工具数/历史轮数' },
  clear:   { arg: '',              desc: '清屏 + 重置对话历史 (不退出)' },
  model:   { arg: '<name|id>',     desc: '切换当前 model, 写到 cfg.current.model' },
  exit:    { arg: '',              desc: '退出 REPL (alias: /quit)' },
  quit:    { arg: '',              desc: '退出 REPL (alias: /exit)' },
};

export function listCommands() {
  return Object.entries(COMMANDS)
    .map(([k, v]) => `  /${k.padEnd(8)} ${v.arg.padEnd(14)} ${v.desc}`)
    .join('\n');
}

export function parseSlash(input) {
  if (typeof input !== 'string') return { handled: false };
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { handled: false };
  const spaceIdx = trimmed.indexOf(' ');
  const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).slice(1).toLowerCase();
  const arg = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  if (!COMMANDS[cmd]) return { handled: true, reply: `未知命令: /${cmd}\n输入 /help 查看可用命令。` };
  return { handled: true, cmd, arg };
}

export function applySlash({ cmd, arg, ctx }) {
  // ctx: { cfg, model, sessionId, historyRounds, toolCount, cCwd }
  switch (cmd) {
    case 'help':
      return { reply: `可用命令:\n${listCommands()}` };
    case 'status':
      return {
        reply: [
          `  session:    ${ctx.sessionId}`,
          `  provider:   ${ctx.providerName || '(none)'}/${ctx.model || '(default)'}`,
          `  cwd:        ${ctx.cwd || process.cwd()}`,
          `  tools:      ${ctx.toolCount}`,
          `  history:    ${ctx.historyRounds} 轮`,
        ].join('\n'),
      };
    case 'clear':
      return { reply: '\x1b[2J\x1b[H', sideEffect: { clearHistory: true } };
    case 'model': {
      if (!arg) return { reply: '用法: /model <name|id>\n  当前: ' + (ctx.model || '(default)') };
      return { reply: `已切换 model: ${arg}  (下次 LLM 调用生效)`, sideEffect: { setModel: arg } };
    }
    case 'exit':
    case 'quit':
      return { sideEffect: { exit: true } };
    default:
      return { reply: `未知命令: /${cmd}` };
  }
}

export const META = { id: 'slash-commands' };
