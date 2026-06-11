// === slash-commands.mjs ===
// dev-repl 的斜杠命令分发 (opencode /claudecode 风格):

// === invariants ===
// - COMMANDS 是单例, 不在运行时变更 (P0 命令集)
// - parseSlash 是纯函数, 不读 cfg 不写盘
// - applySlash 整体 async (commit 路径要 await onCommit), 其他 case 直接返同步值包成 Promise
// - 不直接操作 readline / process.exit, 全部通过 sideEffect 通知 dev-repl
// - 不持久化 model 切换 (运行中内存态, 退出生效)
// - /resume 接受 id 或序号, 找不到返 "找不到" 不抛
// - /commit 必依赖 ctx.onCommit, 缺失返 "未注入" 不抛
//   /help             — 列出所有命令
//   /status           — 当前 session/provider/model/工具数/历史轮数
//   /clear            — 清屏 + 重置历史
//   /model <name|id>  — 切换当前 model (运行中, 写到 ctx.model)
//   /resume [chatId]  — 列有历史的 session (无参) 或 跳到指定 session (有参)
//   /exit             — 退出 (alias: /quit)
//
// 故意不做 (留给后续 PR): /sessions /compact /cost /bug /init /memory
// 理由: 这些要新建 storage 子模块, 一次提交 diff 超 500 行 (违反 R4)
//
// I/O (compose 契约, 供实验 10 dev-aux 测试):
//   { input, ctx } → { handled: bool, reply?: string, sideEffect?: { setModel?, clearHistory?, resumeTo?: string, exit? } }
//   ctx 扩展: availableSessions?: [{ id, msgCount, lastActivity, cwd? }]
//     (由 dev-repl 注入, slash-commands 不硬耦合 repl-history)

export const COMMANDS = {
  help:    { arg: '',              desc: '列出所有 slash 命令' },
  status:  { arg: '',              desc: '显示 session/provider/model/工具数/历史轮数' },
  clear:   { arg: '',              desc: '清屏 + 重置对话历史 (不退出)' },
  model:   { arg: '<name|id>',     desc: '切换当前 model, 写到 cfg.current.model' },
  resume:  { arg: '[chatId]',      desc: '列有历史的 session; 或 /resume <id> 跳到指定' },
  commit:  { arg: '',              desc: '一键 git add + 自动 commit msg (基于 git diff)' },
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

function formatRelativeTime(ts) {
  if (!ts || typeof ts !== 'number') return 'unknown';
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`;
  return new Date(ts).toISOString().slice(0, 10);
}

export async function applySlash({ cmd, arg, ctx }) {
  // ctx: { cfg, model, sessionId, historyRounds, toolCount, cCwd, availableSessions? }
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
          '', // 空行
          typeof ctx.costSummary === 'string' ? ctx.costSummary : '  cost: 暂无记录',
        ].join('\n'),
      };
    case 'clear':
      return { reply: '\x1b[2J\x1b[H', sideEffect: { clearHistory: true } };
    case 'model': {
      if (!arg) return { reply: '用法: /model <name|id>\n  当前: ' + (ctx.model || '(default)') };
      return { reply: `已切换 model: ${arg}  (下次 LLM 调用生效)`, sideEffect: { setModel: arg } };
    }
    case 'resume': {
      const list = ctx.availableSessions || [];
      if (!arg) {
        if (!list.length) return { reply: '没有可续接的历史 session。' };
        const lines = ['可续接的 session (按最近活跃排序):'];
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          const tag = s.id === ctx.sessionId ? ' ← 当前' : '';
          lines.push(`  ${String(i + 1).padStart(2)}. ${s.id} · ${s.msgCount} msgs · ${formatRelativeTime(s.lastActivity)}${tag}`);
        }
        lines.push('用法: /resume <id|序号>  跳到指定 session');
        return { reply: lines.join('\n') };
      }
      // 有参: 接受 id 或 序号
      const target = list.find(s => s.id === arg) || list[parseInt(arg, 10) - 1];
      if (!target) return { reply: `找不到 session: ${arg}\n输入 /resume 查看列表。` };
      if (target.id === ctx.sessionId) return { reply: `已经在 session ${arg} 中。` };
      return { reply: `切换到 session: ${target.id} (${target.msgCount} msgs)`, sideEffect: { resumeTo: target.id } };
    }
    case 'commit': {
      if (typeof ctx.onCommit !== 'function') {
        return { reply: '/commit 不可用: dev-repl 未注入 onCommit 回调' };
      }
      // 调 ctx.onCommit() (async), 把结果作为 reply 返回
      try {
        const r = await ctx.onCommit();
        if (!r.ok) return { reply: `✗ ${r.message}` };
        if (r.committed === false) {
          return { reply: `📝 ${r.message}\n${r.diff ? `  diff 预览: ${r.diff.slice(0, 100)}...` : ''}` };
        }
        return { reply: `✓ ${r.message}` };
      } catch (e) {
        return { reply: `✗ /commit 失败: ${e.message?.slice(0, 100)}` };
      }
    }
    case 'exit':
    case 'quit':
      return { sideEffect: { exit: true } };
    default:
      return { reply: `未知命令: /${cmd}` };
  }
}

export const META = { id: 'slash-commands' };

