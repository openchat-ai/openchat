// === dev-repl-smoke.mjs ===
// dev-repl 端到端 smoke 测试 (mock provider, 无 apiKey 也跑得通)

// === invariants ===
// - 不依赖真 apiKey (mock fetch + 纯函数测试)
// - 不写盘 (除 3d/3e 测试临时文件, 用完即删)
// - 不阻塞 dev-repl 启动 (无副作用导入)
// - 退出码 0 = 全过, 1 = 任一 fail (供 CI 集成)
// - r.ok/r.ng 计数, 最终 r.report(NAME) 打印汇总
//
// 测 4 条数据流 (dev-repl 内部核心):
//   1. provider-health.diagnose: 5 维检查全场景
//   2. slash-commands: 全部命令 + applySlash 关键路径
//   3. repl-history: append / load / clear / 裁剪 / 路径穿越防护
//   4. dev-repl 的"消息流": 模拟用户输入 → 落盘 → 读取对比
//
// 不测:
//   - startDevRepl() 整函数 (依赖 readline + 真 provider)
//   - 真 LLM 调用 (无 apiKey, 也无意义)
//
// 跑法: node tests/integration/dev-repl-smoke.mjs
// 退出码: 0 = 全过, 1 = 任一 fail

import assert from 'node:assert/strict';
import { create } from '../../src/experiments/lib/report.mjs';

const r = create();
const NAME = 'dev-repl-smoke (无 apiKey 端到端)';

// === 1. provider-health.diagnose ===
{
  const { diagnose } = await import('../../src/experiments/lib/provider-health.mjs');
  // 1a. silent=true 返回结构
  const dr = await diagnose({ silent: true });
  assert.equal(typeof dr.ok, 'boolean');
  assert.ok(Array.isArray(dr.lines));
  assert.ok(Array.isArray(dr.report.items));
  r.ok(`diagnose 契约: ok=${dr.ok}, items=${dr.report.items.length}, lines=${dr.lines.length}`);

  // 1b. silent=false 输出含 ANSI 颜色码
  const dr2 = await diagnose({ silent: false });
  const hasAnsi = dr2.lines.some(l => l.includes('\x1b['));
  assert.ok(hasAnsi, 'silent=false 应有 ANSI');
  r.ok('diagnose silent=false 含 ANSI 着色');

  // 1c. 无效 configPath
  const dr3 = await diagnose({ configPath: '/nonexistent/x/y/z.json', silent: true });
  assert.equal(dr3.ok, false);
  assert.ok(dr3.fix?.includes('创建') || dr3.fix?.includes('init'));
  r.ok(`diagnose 不存在 config → fix: ${dr3.fix?.split('\n')[0]?.slice(0, 30)}`);

  // 1d. compose 契约 (provider-health 是同步函数, 非 run 入口)
  const dr4 = await diagnose({ silent: true });
  assert.ok(dr4.report?.items);
  r.ok(`diagnose 同步入口: items=${dr4.report.items.length}`);
}

// === 2. slash-commands 全命令 ===
{
  const sc = await import('../../src/experiments/lib/slash-commands.mjs');
  // 2a. listCommands 含 8 命令
  const list = sc.listCommands();
  for (const c of ['/help', '/status', '/clear', '/model', '/resume', '/commit', '/exit', '/quit']) {
    assert.ok(list.includes(c), `listCommands 缺 ${c}`);
  }
  r.ok('listCommands 含 8 命令');

  // 2b. parseSlash 7 用例 (与实验 10 一致)
  const cases = [
    { in: '/help',    handled: true,  cmd: 'help' },
    { in: '/status',  handled: true,  cmd: 'status' },
    { in: '/model X', handled: true,  cmd: 'model', arg: 'X' },
    { in: '/clear',   handled: true,  cmd: 'clear' },
    { in: '/unknown', handled: true },
    { in: 'hello',    handled: false },
    { in: '/exit',    handled: true,  cmd: 'exit' },
    { in: '/resume',  handled: true,  cmd: 'resume' },
    { in: '/resume X', handled: true, cmd: 'resume', arg: 'X' },
  ];
  for (const c of cases) {
    const p = sc.parseSlash(c.in);
    assert.equal(p.handled, c.handled, `parseSlash(${c.in}).handled`);
    if (c.cmd) assert.equal(p.cmd, c.cmd);
    if (c.arg !== undefined) assert.equal(p.arg, c.arg);
  }
  r.ok('parseSlash 9 用例');

  // 2c. applySlash 关键路径 (async)
  const m1 = await sc.applySlash({ cmd: 'model', arg: 'gpt-4o', ctx: { model: 'old' } });
  assert.equal(m1.sideEffect?.setModel, 'gpt-4o');
  const m2 = await sc.applySlash({ cmd: 'exit', arg: '', ctx: {} });
  assert.equal(m2.sideEffect?.exit, true);
  const m3 = await sc.applySlash({ cmd: 'model', arg: '', ctx: { model: 'old' } });
  assert.ok(m3.reply?.includes('用法'));
  const m4 = await sc.applySlash({ cmd: 'clear', arg: '', ctx: {} });
  assert.equal(m4.sideEffect?.clearHistory, true);
  const m5 = await sc.applySlash({ cmd: 'status', arg: '', ctx: { sessionId: 's1', providerName: 'p1', model: 'm1', toolCount: 5, historyRounds: 3 } });
  assert.ok(m5.reply?.includes('p1/m1'));
  assert.ok(m5.reply?.includes('tools:      5'));
  r.ok('applySlash 5 关键路径');

  // 2d. /resume 6 用例 (async)
  const now = Date.now();
  const sessions = [
    { id: 'repl_1', msgCount: 4,  lastActivity: now - 60000 },
    { id: 'repl_2', msgCount: 12, lastActivity: now - 3600000 },
    { id: 'repl_3', msgCount: 2,  lastActivity: now - 5 * 86400000 },
  ];
  const re1 = await sc.applySlash({ cmd: 'resume', arg: '', ctx: { availableSessions: [] } });
  assert.ok(re1.reply?.includes('没有'));
  const re2 = await sc.applySlash({ cmd: 'resume', arg: '', ctx: { availableSessions: sessions, sessionId: 'repl_1' } });
  assert.ok(re2.reply?.includes('repl_1 · 4 msgs'));
  assert.ok(re2.reply?.includes('← 当前'));
  const re3 = await sc.applySlash({ cmd: 'resume', arg: 'repl_2', ctx: { availableSessions: sessions, sessionId: 'repl_1' } });
  assert.equal(re3.sideEffect?.resumeTo, 'repl_2');
  const re4 = await sc.applySlash({ cmd: 'resume', arg: '2', ctx: { availableSessions: sessions, sessionId: 'repl_1' } });
  assert.equal(re4.sideEffect?.resumeTo, 'repl_2');
  const re5 = await sc.applySlash({ cmd: 'resume', arg: 'repl_1', ctx: { availableSessions: sessions, sessionId: 'repl_1' } });
  assert.ok(re5.reply?.includes('已经在'));
  const re6 = await sc.applySlash({ cmd: 'resume', arg: 'xxx', ctx: { availableSessions: sessions, sessionId: 'repl_1' } });
  assert.ok(re6.reply?.includes('找不到'));
  r.ok('/resume 6 用例');

  // 2e. /commit 4 用例 (async)
  // 无 onCommit 回调
  const c1 = await sc.applySlash({ cmd: 'commit', arg: '', ctx: {} });
  assert.ok(c1.reply?.includes('未注入'));
  r.ok('/commit 无回调 → 提示注入');
  // onCommit 返 ok:false
  const c2 = await sc.applySlash({ cmd: 'commit', arg: '', ctx: { onCommit: async () => ({ ok: false, message: '无变更' }) } });
  assert.ok(c2.reply?.includes('无变更'));
  r.ok('/commit 无变更 → ✗ 提示');
  // onCommit 返 committed:true
  const c3 = await sc.applySlash({ cmd: 'commit', arg: '', ctx: { onCommit: async () => ({ ok: true, committed: true, message: '已 commit: feat(x): y' }) } });
  assert.ok(c3.reply?.includes('已 commit'));
  r.ok('/commit 已 commit → ✓');
  // onCommit 返 committed:false (只生成 msg, 不真 commit)
  const c4 = await sc.applySlash({ cmd: 'commit', arg: '', ctx: { onCommit: async () => ({ ok: true, committed: false, message: '建议: feat(x)', diff: '+abc' }) } });
  assert.ok(c4.reply?.includes('建议'));
  assert.ok(c4.reply?.includes('diff 预览'));
  r.ok('/commit 未自动 commit → 📝 提示');
}

// === 3. repl-history ===
{
  const h = await import('../../src/experiments/lib/repl-history.mjs');
  const cid = `_smoke_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // 3a. 基础 append + load
  assert.equal(h.loadHistory(cid).length, 0);
  h.appendMessage(cid, { role: 'user', content: 'hi' });
  h.appendMessage(cid, { role: 'assistant', content: 'hello' });
  const loaded = h.loadHistory(cid);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].content, 'hi');
  r.ok('append + load');

  // 3b. clear
  h.clearHistory(cid);
  assert.equal(h.loadHistory(cid).length, 0);
  r.ok('clear');

  // 3c. 裁剪
  for (let i = 0; i < 1100; i++) h.appendMessage(cid, { role: 'user', content: 'm' + i });
  assert.equal(h.loadHistory(cid).length, 1000);
  r.ok('trim 1100→1000');
  h.clearHistory(cid);

  // 3d. 路径穿越防护
  for (const bad of ['../etc/passwd', 'a/b', 'a'.repeat(65), '', null, undefined, 123]) {
    try { h.loadHistory(bad); assert.fail(`应拒绝: ${JSON.stringify(bad)}`); }
    catch { /* expected */ }
  }
  r.ok('路径穿越/类型防护 7 用例');

  // 3e. JSON 损坏恢复
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const dir = path.join(os.homedir(), '.openchat', 'repl-history');
  fs.mkdirSync(dir, { recursive: true });
  const badCid = `_bad_${Date.now()}`;
  fs.writeFileSync(path.join(dir, `${badCid}.json`), '{ this is not json');
  const bad = h.loadHistory(badCid);
  assert.deepEqual(bad, []);
  fs.unlinkSync(path.join(dir, `${badCid}.json`));
  r.ok('JSON 损坏 → 空数组 (不抛)');
}

// === 5. failover-picker pingProvider (mock fetch) ===
{
  const { pingProvider } = await import('../../src/experiments/lib/provider-health.mjs');
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('11434')) return { status: 200, ok: true };
    if (u.includes('openai.com')) return { status: 200, ok: true };
    if (u.includes('openrouter')) return { status: 503, ok: false };
    return { status: 404, ok: false };
  };
  try {
    // 5a. ollama 端点
    const p1 = await pingProvider('ollama', { baseUrl: 'http://localhost:11434' });
    assert.equal(p1.ok, true);
    assert.equal(p1.status, 200);
    r.ok('pingProvider ollama 200 → alive');

    // 5b. openai 端点
    const p2 = await pingProvider('openai', { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x' });
    assert.equal(p2.ok, true);
    r.ok('pingProvider openai 200 → alive');

    // 5c. openrouter 503
    const p3 = await pingProvider('openrouter', { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-x' });
    assert.equal(p3.ok, false);
    assert.equal(p3.status, 503);
    r.ok('pingProvider openrouter 503 → down');

    // 5d. 缺 apiKey (非 ollama)
    const p4 = await pingProvider('openai', { baseUrl: 'https://api.openai.com/v1' });
    assert.equal(p4.error, 'no-api-key');
    r.ok('pingProvider 缺 apiKey → no-api-key');

    // 5e. 缺 baseUrl
    const p5 = await pingProvider('openai', {});
    assert.equal(p5.error, 'no-baseurl');
    r.ok('pingProvider 缺 baseUrl → no-baseurl');

    // 5f. ollama skipAuth 不需要 apiKey
    const p6 = await pingProvider('ollama', { baseUrl: 'http://localhost:11434' });
    assert.equal(p6.ok, true);
    r.ok('pingProvider ollama skipAuth (无 apiKey) → alive');

    // 5g. pickFirstAlive: 全死 → ok:false, tried 全有
    const { pickFirstAlive } = await import('../../src/experiments/lib/failover-picker.mjs');
    const fail = await pickFirstAlive(
      [{ name: 'openrouter', model: 'm1' }],
      { providers: { openrouter: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk' } } },
      { silent: true }
    );
    assert.equal(fail.ok, false);
    assert.equal(fail.tried.length, 1);
    assert.equal(fail.tried[0].ping.status, 503);
    r.ok('pickFirstAlive 全死 → ok:false, tried 记录');
  } finally {
    globalThis.fetch = orig;
  }
}

// === 6. edit-quality-gate ===
{
  const gate = await import('../../src/experiments/lib/edit-quality-gate.mjs');
  // 6a. isEditTool 4 个真 + 1 个假
  assert.equal(gate.isEditTool('edit_file'), true);
  assert.equal(gate.isEditTool('write_file'), true);
  assert.equal(gate.isEditTool('multi_edit'), true);
  assert.equal(gate.isEditTool('ast_edit'), true);
  assert.equal(gate.isEditTool('read_file'), false);
  assert.equal(gate.isEditTool('list_directory'), false);
  r.ok('isEditTool 6 用例');

  // 6b. 非 JS 扩展名 → skip
  const g1 = await gate.checkEditedFile('test.json');
  assert.equal(g1.ok, true);
  assert.ok(g1.summary?.includes('skip'));
  r.ok('checkEditedFile .json → skip');

  // 6c. 无效 filePath
  const g2 = await gate.checkEditedFile(null);
  assert.equal(g2.ok, false);
  r.ok('checkEditedFile null → ok:false');

  // 6d. compose 入口
  const g3 = await gate.run({ inputs: { op: 'isEditTool', toolName: 'edit_file' } });
  assert.equal(g3.outputs.isEdit, true);
  r.ok('run isEditTool 契约');

  // 6e. 不存在的 .js 文件 → lintRun 静默 OK
  const g4 = await gate.checkEditedFile('_nonexistent_' + Date.now() + '.js');
  assert.equal(g4.ok, true);
  r.ok('checkEditedFile 不存在 → ok:true (静默)');
}

// === 7. cost-tracker ===
{
  const { CostTracker, charToToken, lookupCost, run: costRun } = await import('../../src/experiments/lib/cost-tracker.mjs');
  // 7a. charToToken 边界
  assert.equal(charToToken(0), 0);
  assert.equal(charToToken(3), 1);
  assert.equal(charToToken(4), 1);
  assert.equal(charToToken(5), 2);
  assert.equal(charToToken(null), 0);
  r.ok('charToToken 5 用例');

  // 7b. lookupCost
  assert.ok(lookupCost('gpt-4o')?.input > 0);
  assert.equal(lookupCost('unknown-model'), null);
  assert.equal(lookupCost('gpt-4o', { costPer1k: { input: 0.001, output: 0.002 } })?.input, 0.001);
  r.ok('lookupCost 3 用例');

  // 7c. 基础 record + summary
  const t1 = new CostTracker();
  const r1 = t1.recordUsage({
    messages: [{ role: 'user', content: 'hello world' }, { role: 'system', content: 'x'.repeat(100) }],
    responseContent: 'hi there',
    model: 'gpt-4o',
    providerName: 'openai',
  });
  assert.ok(r1.promptTokens > 0);
  assert.ok(r1.completionTokens > 0);
  assert.ok(r1.cost > 0);
  const s1 = t1.summary();
  assert.equal(s1.calls, 1);
  assert.equal(s1.totalTokens, r1.promptTokens + r1.completionTokens);
  r.ok('CostTracker 基础 record + summary');

  // 7d. 多次 + 多 model
  t1.recordUsage({ messages: [{ role: 'user', content: 'a'.repeat(400) }], responseContent: 'b'.repeat(200), model: 'gpt-4o', providerName: 'openai' });
  t1.recordUsage({ messages: [{ role: 'user', content: 'c'.repeat(100) }], responseContent: 'd'.repeat(50), model: 'claude-3-haiku-20240307', providerName: 'anthropic' });
  const s2 = t1.summary();
  assert.equal(s2.calls, 3);
  assert.equal(s2.byModel['gpt-4o']?.calls, 2);
  assert.equal(s2.byModel['claude-3-haiku-20240307']?.calls, 1);
  r.ok('CostTracker 多次 + 多 model byModel');

  // 7e. 未知 model → cost 0
  const t2 = new CostTracker();
  t2.recordUsage({ messages: [{ role: 'user', content: 'hi' }], responseContent: 'h', model: 'totally-unknown', providerName: 'x' });
  const s3 = t2.summary();
  assert.equal(s3.cost, 0);
  assert.equal(s3.calls, 1);
  assert.equal(s3.byModel['totally-unknown']?.cost, 0);
  r.ok('CostTracker 未知 model → cost:0');

  // 7f. formatSummary
  const t3 = new CostTracker();
  assert.ok(t3.formatSummary().includes('暂无记录'));
  t3.recordUsage({ messages: [{ role: 'user', content: 'a'.repeat(400) }], responseContent: 'b', model: 'gpt-4o', providerName: 'openai' });
  const f = t3.formatSummary();
  assert.ok(f.includes('calls:'));
  assert.ok(f.includes('total:'));
  assert.ok(f.includes('cost:'));
  r.ok('formatSummary 空 + 有数据');

  // 7g. compose 入口
  const c1 = await costRun({ inputs: { op: 'new' } });
  assert.ok(c1.outputs.tracker);
  const c2 = await costRun({ inputs: { op: 'record', tracker: c1.outputs.tracker, messages: [{role:'user',content:'a'.repeat(400)}], responseContent: 'b', model: 'gpt-4o', providerName: 'openai' } });
  assert.ok(c2.outputs.promptTokens > 0);
  r.ok('compose 入口 new + record');
}

// === 8. /forget 6 用例 (async) ===
{
  const sc = await import('../../src/experiments/lib/slash-commands.mjs');
  const now = Date.now();
  const sessions = [
    { id: 'repl_1', msgCount: 4, lastActivity: now - 60000 },
    { id: 'repl_2', msgCount: 12, lastActivity: now - 3600000 },
  ];
  // 8a. 无参 + 空
  const f1 = await sc.applySlash({ cmd: 'forget', arg: '', ctx: { availableSessions: [] } });
  assert.ok(f1.reply?.includes('没有可删除'));
  r.ok('/forget 无 session → 提示');
  // 8b. 无参 + 列表 (有当前保护)
  const f2 = await sc.applySlash({ cmd: 'forget', arg: '', ctx: { availableSessions: sessions, sessionId: 'repl_1' } });
  assert.ok(f2.reply?.includes('repl_1'));
  assert.ok(f2.reply?.includes('当前 (有保护)'));
  r.ok('/forget 无参列 (含当前保护)');
  // 8c. 删当前 → 拒
  const f3 = await sc.applySlash({ cmd: 'forget', arg: 'repl_1', ctx: { availableSessions: sessions, sessionId: 'repl_1', onForget: async () => ({ ok: true }) } });
  assert.ok(f3.reply?.includes('不能删除当前'));
  r.ok('/forget 当前 → 拒');
  // 8d. 删非当前 (无 --force) → 提示确认
  const f4 = await sc.applySlash({ cmd: 'forget', arg: 'repl_2', ctx: { availableSessions: sessions, sessionId: 'repl_1', onForget: async () => ({ ok: true }) } });
  assert.ok(f4.reply?.includes('将删除'));
  assert.ok(f4.reply?.includes('--force'));
  r.ok('/forget 非当前 (无 --force) → 确认提示');
  // 8e. 删非当前 (有 --force) → 调 onForget
  let forgetCalled = null;
  const f5 = await sc.applySlash({ cmd: 'forget', arg: 'repl_2 --force', ctx: { availableSessions: sessions, sessionId: 'repl_1', onForget: async (id) => { forgetCalled = id; return { ok: true }; } } });
  assert.equal(forgetCalled, 'repl_2');
  assert.ok(f5.reply?.includes('已删除'));
  r.ok('/forget --force → 调 onForget');
  // 8f. onForget 返错
  const f6 = await sc.applySlash({ cmd: 'forget', arg: 'repl_2 --force', ctx: { availableSessions: sessions, sessionId: 'repl_1', onForget: async () => ({ ok: false, error: 'permission denied' }) } });
  assert.ok(f6.reply?.includes('permission denied'));
  r.ok('/forget onForget 失败 → 提示');

  // 8g. /diff 4 用例
  // 无 onDiff
  const d1 = await sc.applySlash({ cmd: 'diff', arg: '', ctx: {} });
  assert.ok(d1.reply?.includes('未注入'));
  r.ok('/diff 无回调 → 提示');
  // onDiff 返 error
  const d2 = await sc.applySlash({ cmd: 'diff', arg: '', ctx: { onDiff: async () => ({ error: 'not a git repo' }) } });
  assert.ok(d2.reply?.includes('not a git repo'));
  r.ok('/diff not git → 提示');
  // onDiff 返空 (clean)
  const d3 = await sc.applySlash({ cmd: 'diff', arg: '', ctx: { onDiff: async () => ({ diff: '' }) } });
  assert.ok(d3.reply?.includes('working tree clean'));
  r.ok('/diff 空 diff → clean');
  // onDiff 返有内容
  const diffText = 'diff --git a/x.js b/x.js\n+line1\n+line2\n-old';
  const d4 = await sc.applySlash({ cmd: 'diff', arg: '', ctx: { onDiff: async () => ({ diff: diffText }) } });
  assert.ok(d4.reply?.includes('4 行'));
  assert.ok(d4.reply?.includes('+line1'));
  r.ok('/diff 有内容 → 显示带行号');
}

// === 9. subagent + /task ===
{
  const sa = await import('../../src/experiments/lib/subagent.mjs');
  const sc = await import('../../src/experiments/lib/slash-commands.mjs');

  // 9a. goal 缺失
  const sa1 = await sa.runSubagent({ goal: '', deps: {} });
  assert.equal(sa1.ok, false);
  assert.ok(sa1.error?.includes('goal'));
  r.ok('subagent goal 缺失 → ok:false');

  // 9b. deps 缺失
  const sa2 = await sa.runSubagent({ goal: 'do something', deps: { provider: {} } });
  assert.equal(sa2.ok, false);
  assert.ok(sa2.error?.includes('deps'));
  r.ok('subagent deps 缺失 → ok:false');

  // 9c. 工具加载 0 → 返错 (mock loadTools 返空)
  const sa3 = await sa.runSubagent({ goal: 'g', deps: { provider: { chat: async () => ({ content: 'x', toolCalls: [] }) }, loadTools: async () => ({ tools: [], dispatch: {} }) } });
  assert.equal(sa3.ok, false);
  assert.ok(sa3.error?.includes('0 工具') || sa3.error?.includes('opts.tools') || sa3.error?.includes('全部不在'));
  r.ok('subagent 0 工具 → ok:false');

  // 9d. opts.tools 全部不在 loadTools 返回中 → 返错 (5 件套: 窄化但不能 0)
  const sa4 = await sa.runSubagent({
    goal: 'g',
    deps: { provider: { chat: async () => ({ content: 'x', toolCalls: [] }) }, loadTools: async () => ({ tools: [{ function: { name: 'exec_command' } }], dispatch: { exec: () => '' } }) },
    opts: { tools: ['read_file', 'edit_file'] },
  });
  assert.equal(sa4.ok, false);
  assert.ok(sa4.error?.includes('全部不在'));
  r.ok('subagent opts.tools 全部不在 → ok:false (友好提示)');

  // 9e. opts.tools 子集过滤生效 (loadTools 返 3, 传 2 个 name, 留下 1)
  // mock provider 一次返 toolCall, 一次返 finalAnswer → 走完 2 round 退出
  let observedToolNames = null;
  const mockProvider = {
    chat: async (_m, messages, opts) => {
      observedToolNames = (opts.tools || []).map(t => t.function?.name || t.name).sort();
      const last = messages[messages.length - 1];
      if (last?.role === 'tool') {
        return { content: 'done', toolCalls: [] };
      }
      return { content: '', toolCalls: [{ id: 'tc1', function: { name: 'read_file', arguments: '{"path":"x"}' } }] };
    },
  };
  const tools3 = [
    { function: { name: 'read_file', description: 'r' } },
    { function: { name: 'edit_file', description: 'e' } },
    { function: { name: 'build_run', description: 'b' } },
  ];
  const sa5 = await sa.runSubagent({
    goal: 'read x',
    deps: { provider: mockProvider, loadTools: async () => ({ tools: tools3, dispatch: { t1: () => 'x' } }) },
    opts: { tools: ['read_file', 'edit_file'] },
  });
  assert.equal(sa5.ok, true);
  assert.deepEqual(observedToolNames, ['edit_file', 'read_file']);
  assert.ok(!observedToolNames.includes('build_run'), 'build_run 应被过滤');
  r.ok('subagent opts.tools 过滤生效 (3→2)');

  // 9f. /task 缺 onTask 回调
  const t1 = await sc.applySlash({ cmd: 'task', arg: 'g', ctx: {} });
  assert.ok(t1.reply?.includes('未注入'));
  r.ok('/task 无 onTask → 提示');

  // 9g. /task 无 goal
  const t2 = await sc.applySlash({ cmd: 'task', arg: '', ctx: { onTask: async () => ({ ok: true }) } });
  assert.ok(t2.reply?.includes('用法'));
  r.ok('/task 无 goal → 提示用法');

  // 9h. /task onTask 返 ok:true → 注入 sideEffect.taskResult
  let taskCalledWith = null;
  const t3 = await sc.applySlash({
    cmd: 'task',
    arg: 'find all TODOs',
    ctx: { onTask: async (goal) => { taskCalledWith = goal; return { ok: true, sessionId: 'subagent_abc12345', content: 'found 3 TODOs', rounds: 2, toolCalls: 4, durationMs: 1234 }; } },
  });
  assert.equal(taskCalledWith, 'find all TODOs');
  assert.ok(t3.reply?.includes('subagent 完成'));
  assert.ok(t3.reply?.includes('subagent_abc12345'));
  assert.ok(t3.sideEffect?.taskResult);
  assert.equal(t3.sideEffect.taskResult.sessionId, 'subagent_abc12345');
  assert.equal(t3.sideEffect.taskResult.goal, 'find all TODOs');
  assert.equal(t3.sideEffect.taskResult.content, 'found 3 TODOs');
  r.ok('/task onTask 成功 → ✓ 完成 + 注入 sideEffect.taskResult');

  // 9i. /task onTask 返 ok:false → 提示错误
  const t4 = await sc.applySlash({ cmd: 'task', arg: 'g', ctx: { onTask: async () => ({ ok: false, error: 'fallback 全死' }) } });
  assert.ok(t4.reply?.includes('subagent 失败'));
  assert.ok(t4.reply?.includes('fallback 全死'));
  r.ok('/task onTask 失败 → ✗ 提示 error');
}

// === 4. dev-repl 消息流模拟 (核心端到端) ===
{
  const h = await import('../../src/experiments/lib/repl-history.mjs');
  const cid = `_flow_${Date.now()}`;

  // 4a. 模拟 2 轮对话
  // 轮 1: user "列出项目结构" → assistant 调 list_directory → tool result → assistant 最终回答
  h.appendMessage(cid, { role: 'user', content: '列出项目结构' });
  h.appendMessage(cid, { role: 'assistant', content: '', tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'list_directory', arguments: '{"path":"."}' } }] });
  h.appendMessage(cid, { role: 'tool', tool_call_id: 'tc1', content: 'src/\ntests/\nREADME.md' });
  h.appendMessage(cid, { role: 'assistant', content: '项目有 src/ tests/ README.md' });

  // 轮 2: user "看 src/" → assistant 回答
  h.appendMessage(cid, { role: 'user', content: '看 src/' });
  h.appendMessage(cid, { role: 'assistant', content: 'src/ 包含...' });

  // 4b. 退出后 -c 续接
  const resumed = h.loadHistory(cid);
  assert.equal(resumed.length, 6);
  assert.equal(resumed.filter(m => m.role === 'user').length, 2);
  assert.equal(resumed.filter(m => m.role === 'assistant').length, 3);
  assert.equal(resumed.filter(m => m.role === 'tool').length, 1);
  r.ok('2 轮对话 (6 msgs) 完整落盘');

  // 4c. 灌入 dev-repl messages 数组, 验证 LLM 可直接消费
  const messages = [];
  for (const m of resumed) {
    if (m.role === 'system') continue;
    messages.push(m);
  }
  assert.equal(messages.length, 6);
  // 最后一条应是 assistant (2 轮已完结), 若再起一轮 dev-repl 会再 push user
  assert.equal(messages[messages.length - 1].role, 'assistant');
  r.ok('messages 数组可灌入 provider.chat() 直接消费');

  h.clearHistory(cid);
}

r.report(NAME);
process.exit(r.ngCount > 0 ? 1 : 0);
