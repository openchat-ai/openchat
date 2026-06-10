// === dev-repl-smoke.mjs ===
// dev-repl 端到端 smoke 测试 (mock provider, 无 apiKey 也跑得通)
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
