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
//   /help                  — 列出所有命令
//   /status                — 当前 session/provider/model/工具数/历史轮数
//   /clear                 — 清屏 + 重置历史
//   /history-clear         — 清空当前 session 的对话历史 (不退出, 不清屏)
//   /model <name|id>       — 切换当前 model (运行中, 写到 ctx.model)
//   /resume [chatId]       — 列有历史的 session (无参) 或 跳到指定 session (有参)
//   /forget [chatId]       — 列有历史的 session; 或 /forget <id> --force 删除
//   /diff                  — 显示未提交的 git diff
//   /commit                — 一键 git add + 自动 commit msg (基于 git diff)
//   /task <goal>           — 派生子 agent 跑任务 (独立 session)
//   /workflow <name>       — 运行已定义的工作流
//   /exit                  — 退出 (alias: /quit)
//
// 故意不做 (留给后续 PR): /sessions /compact /cost /bug /init /memory
// 理由: 这些要新建 storage 子模块, 一次提交 diff 超 500 行 (违反 R4)
//
// I/O (compose 契约, 供实验 10 dev-aux 测试):
//   { input, ctx } → { handled: bool, reply?: string, sideEffect?: { setModel?, clearHistory?, resumeTo?: string, exit? } }
//   ctx 扩展: availableSessions?: [{ id, msgCount, lastActivity, cwd? }]
//     (由 dev-repl 注入, slash-commands 不硬耦合 repl-history)
//
// COMMANDS 字段约定 (供 help/autocomplete/validate 共用):
//   { name: { arg, desc, permission? } }
//     - arg:      用法占位符 ('', '<...>', '[...]'), 喂给 /help 文本
//     - desc:     一行中文说明
//     - permission: 'self' = 仅影响当前 session (无权限闸); 默认同 'self'
//                  'git'  = 需要 cwd 在 git 仓库内 (e.g. /commit /diff)
//   unknown/permission-gate 命令由 applySlash 在运行时判定, 静态注册表只声明元数据

export const COMMANDS = {
  help:    { arg: '',              desc: '列出所有 slash 命令' },
  status:  { arg: '',              desc: '显示 session/provider/model/工具数/历史轮数' },
  clear:         { arg: '',         desc: '清屏 + 重置对话历史 (不退出)' },
  'history-clear':{ arg: '',         desc: '清空当前 session 的对话历史 (不退出, 不清屏)', permission: 'self' },
  model:   { arg: '<name|id>',     desc: '切换当前 model, 写到 cfg.current.model' },
  resume:  { arg: '[chatId]',      desc: '列有历史的 session; 或 /resume <id> 跳到指定' },
  forget:  { arg: '[chatId]',      desc: '列有历史的 session; 或 /forget <id> 删除指定' },
  commit:  { arg: '',              desc: '一键 git add + 自动 commit msg (基于 git diff)' },
  diff:    { arg: '',              desc: '显示未提交的 git diff (基于 cwd)' },
  task:    { arg: '<goal>',        desc: '派生子 agent 跑任务 (独立 session, 不污染主历史)' },
  workflow:{ arg: '<workflowName>', desc: '运行已定义的工作流 (从上下文对话生成)' },
  exit:    { arg: '',              desc: '退出 REPL (alias: /quit)' },
  quit:    { arg: '',              desc: '退出 REPL (alias: /exit)' },
};

export function listCommands() {
  return Object.entries(COMMANDS)
    .map(([k, v]) => `  /${k.padEnd(8)} ${v.arg.padEnd(14)} ${v.desc}`)
    .join('\n');
}

// === 供 autocomplete / 校验 用的只读视图 ===
// 返回全部已注册命令名 (按插入顺序) — 喂给 readline completer
export function listCommandNames() {
  return Object.keys(COMMANDS);
}

// 校验输入是否是合法命令名 (大小写不敏感)
// 返回 { ok: true, cmd } 或 { ok: false, suggestion?: string }
// 供 dev-repl 在 tab 补全 / 拼写纠错时调用
export function validateCommandName(input) {
  if (typeof input !== 'string' || !input) return { ok: false };
  const lower = input.toLowerCase();
  if (COMMANDS[lower]) return { ok: true, cmd: lower };
  // 拼写提示: 取 Levenshtein 距离最小的邻居, 距离 ≤ 2 才返回
  // (放宽到 2 是因为长名 (如 history-clear) 漏 1-2 字符仍属常见 typo)
  const names = Object.keys(COMMANDS);
  let best = null, bestDist = Infinity;
  for (const n of names) {
    const d = levenshtein(n, lower);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return { ok: false, suggestion: best && bestDist <= 2 ? `/${best}` : null };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = i;
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + cost);
      prevDiag = tmp;
      prev[j] = cur;
    }
  }
  return prev[n];
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
    case 'history-clear':
      return { reply: '已清空当前 session 的对话历史。', sideEffect: { clearHistory: true } };
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
    case 'forget': {
      const list = ctx.availableSessions || [];
      if (!arg) {
        if (!list.length) return { reply: '没有可删除的历史 session。' };
        const lines = ['可删除的 session (按最近活跃排序):'];
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          const tag = s.id === ctx.sessionId ? ' ← 当前 (有保护)' : '';
          lines.push(`  ${String(i + 1).padStart(2)}. ${s.id} · ${s.msgCount} msgs · ${formatRelativeTime(s.lastActivity)}${tag}`);
        }
        lines.push('用法: /forget <id|序号> --force  删除 (--force 跳过确认)');
        return { reply: lines.join('\n') };
      }
      // 形如: "/forget repl_x" → 先确认; "/forget repl_x --force" → 直接删
      const parts = arg.split(/\s+/);
      const targetArg = parts[0];
      const isForce = parts.includes('--force');
      if (typeof ctx.onForget !== 'function') {
        return { reply: '/forget 不可用: dev-repl 未注入 onForget 回调' };
      }
      const target = list.find(s => s.id === targetArg) || list[parseInt(targetArg, 10) - 1];
      if (!target) return { reply: `找不到 session: ${targetArg}\n输入 /forget 查看列表。` };
      if (target.id === ctx.sessionId) {
        return { reply: `✗ 不能删除当前 session (避免误操作, 退出后用 -c 模式再删)` };
      }
      if (!isForce) {
        return { reply: `⚠ 将删除 session: ${target.id} (${target.msgCount} msgs)\n  再次执行 /forget ${targetArg} --force 确认` };
      }
      // --force 走回调
      try {
        const r = await ctx.onForget(target.id);
        if (!r.ok) return { reply: `✗ 删除失败: ${r.error || '未知'}` };
        return { reply: `✓ 已删除 session: ${target.id}` };
      } catch (e) {
        return { reply: `✗ 删除异常: ${e.message?.slice(0, 100)}` };
      }
    }
    case 'diff': {
      if (typeof ctx.onDiff !== 'function') {
        return { reply: '/diff 不可用: dev-repl 未注入 onDiff 回调' };
      }
      try {
        const r = await ctx.onDiff();
        if (r.error) return { reply: `✗ ${r.error}` };
        if (!r.diff) return { reply: '✓ 无未提交变更 (working tree clean)' };
        const lines = r.diff.split('\n');
        const max = 80;
        const truncated = lines.length > max;
        const display = lines.slice(0, max).map((l, i) => `  ${i + 1}${i < 9 ? ' ' : ''}  ${l}`).join('\n');
        const summary = `📝 ${lines.length} 行 (${r.diff.length} 字节)${truncated ? ` · 显示前 ${max} 行` : ''}`;
        return { reply: `${summary}\n${display}` };
      } catch (e) {
        return { reply: `✗ /diff 失败: ${e.message?.slice(0, 100)}` };
      }
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
    case 'task': {
      if (!arg) return { reply: '用法: /task <goal>\n  派生子 agent 跑任务 (独立 session, 不污染主历史)' };
      if (typeof ctx.onTask !== 'function') {
        return { reply: '/task 不可用: dev-repl 未注入 onTask 回调' };
      }
      // 同步调 ctx.onTask(goal) (async), 由 dev-repl 跑 subagent 并把结果存到 sideEffect
      // dev-repl 在下一轮 LLM 入口前把 taskResult.content 注入 messages
      try {
        const r = await ctx.onTask(arg);
        if (!r.ok) {
          return { reply: `✗ subagent 失败: ${r.error?.slice(0, 150) || '未知'}` };
        }
        return {
          reply: `✓ subagent 完成: ${r.rounds} 轮, ${r.toolCalls} 工具调用, ${(r.durationMs / 1000).toFixed(1)}s\n  sessionId: ${r.sessionId}\n  结果将作为 system 消息注入下一轮 LLM 输入`,
          sideEffect: {
            taskResult: { sessionId: r.sessionId, content: r.content, goal: arg, rounds: r.rounds, toolCalls: r.toolCalls, durationMs: r.durationMs },
          },
        };
      } catch (e) {
        return { reply: `✗ /task 派发失败: ${e.message?.slice(0, 100)}` };
      }
    }
    case 'workflow': {
      if (!arg) return { reply: '用法: /workflow <workflowName>\n  运行已定义的工作流 (从上下文对话生成), 必要步骤失败会中止' };
      if (typeof ctx.onWorkflow !== 'function') {
        return { reply: '/workflow 不可用: dev-repl 未注入 onWorkflow 回调' };
      }
      // 同步调 ctx.onWorkflow(name) (async), 由 dev-repl 跑 step-workflow 并把结果存到 sideEffect
      // dev-repl 在下一轮 LLM 入口前把 workflowResult.content 注入 messages
      try {
        const r = await ctx.onWorkflow(arg);
        if (!r.ok) {
          return { reply: `✗ workflow 失败: ${r.error?.slice(0, 150) || '未知'}` };
        }
        return {
          reply: `✓ workflow "${r.workflowName}" 完成: status=${r.status}${r.failedStep ? `, 失败步骤=${r.failedStep}` : ''}, ${r.results?.length || 0} 步\n  结果将作为 system 消息注入下一轮 LLM 输入`,
          sideEffect: {
            workflowResult: { workflowName: r.workflowName, status: r.status, failedStep: r.failedStep, results: r.results, content: r.content },
          },
        };
      } catch (e) {
        return { reply: `✗ /workflow 派发失败: ${e.message?.slice(0, 100)}` };
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

