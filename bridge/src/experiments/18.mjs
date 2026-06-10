// Experiment: 40-guardrails-pipeline — Forge 式全栈 guardrails 效果比较
// Manifest id: guardrails-pipeline
// === invariants ===
// - MAX_ROUNDS=8, MAX_REPEAT=3, MAX_RETRIES=3 （与 skeleton-agent 一致）
// - dryRun: 两组 mock 序列相同（同 LLM），测组件正确性 + 开销
// - live: 两组同 prompt 调真实 LLM，测完成率 + token 差异
// - H0/H1 只 live 模式输出；dryRun 只输出组件测试结果

import { validateResponse } from './lib/response-validator.mjs';
import { createStepEnforcer } from './lib/step-enforcer.mjs';
import { createErrorTracker } from './lib/error-tracker.mjs';

export const META = {
  id: 'guardrails-pipeline',
  name: 'Guardrails Pipeline — 全栈守卫 vs 裸循环比较实验',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'compare | run_pipeline | run_baseline | test_components' },
    { name: 'scenario', type: 'object', required: false },
    { name: 'live', type: 'boolean', required: false, default: false },
    { name: 'repeats', type: 'number', required: false, default: 3 },
  ],
  outputs: [
    { name: 'baseline', type: 'object' },
    { name: 'treatment', type: 'object' },
    { name: 'delta', type: 'object' },
    { name: 'verdict', type: 'string', description: 'H0 | H1 | dryRun' },
  ],
  deps: [],
  tags: ['guardrails', 'pipeline', 'comparison', 'experiment'],
};

const MAX_ROUNDS = 8;
const MAX_REPEAT = 3;

const MOCK_TOOLS = [
  { function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { function: { name: 'write_file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { function: { name: 'edit_file', parameters: { type: 'object', properties: { path: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'search', 'replace'] } } },
  { function: { name: 'glob', parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } } },
  { function: { name: 'grep', parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } } },
  { function: { name: 'execute_command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
];

// === 4 场景, 两组同一 mock 序列(含 LLM 常见错误) ===
const SCENARIOS = [
  {
    id: 'simple-read',
    text: '读取当前目录下的 package.json 文件，告诉我它的 name 字段',
    tools: MOCK_TOOLS,
    // LLM 做对: 一次 read_file, 然后回答
    mockSeq: [
      { toolCalls: [{ name: 'read_file', args: { path: 'package.json' } }] },
      { content: 'package.json 的 name 是 "my-project"' },
    ],
  },
  {
    id: 'multi-step-edit',
    text: '在项目中搜索含 "class" 的文件，读内容，将类名改为 AppClass',
    tools: MOCK_TOOLS,
    // LLM 常见错误: 跳过 grep 直接 edit → 搜错关键词 → 重复同调用 → 最后做对
    mockSeq: [
      { toolCalls: [{ name: 'edit_file', args: { path: 'src/App.js', search: 'class OldClass', replace: 'class AppClass' } }] },
      { toolCalls: [{ name: 'edit_file', args: { path: 'src/App.js', search: 'class OldClass', replace: 'class AppClass' } }] },
      { toolCalls: [{ name: 'grep', args: { pattern: 'class ' } }] },
      { toolCalls: [{ name: 'read_file', args: { path: 'src/App.js' } }] },
      { toolCalls: [{ name: 'edit_file', args: { path: 'src/App.js', search: 'class MyComponent', replace: 'class AppClass' } }] },
      { content: '已完成重命名' },
    ],
  },
  {
    id: 'error-recovery',
    text: '读取 /nonexistent/path/to/file.txt 的内容，看看里面写了什么',
    tools: MOCK_TOOLS,
    // LLM 常见错误: 同一路径重复尝试 4 次 → MAX_REPEAT 触发
    mockSeq: [
      { toolCalls: [{ name: 'read_file', args: { path: '/nonexistent/path/to/file.txt' } }] },
      { toolCalls: [{ name: 'read_file', args: { path: '/nonexistent/path/to/file.txt' } }] },
      { toolCalls: [{ name: 'read_file', args: { path: '/nonexistent/path/to/file.txt' } }] },
      { toolCalls: [{ name: 'read_file', args: { path: '/nonexistent/path/to/file.txt' } }] },
      { content: '文件不存在' },
    ],
  },
  {
    id: 'ambiguous-goal',
    text: '优化这个项目的构建配置（Node.js + webpack）',
    tools: MOCK_TOOLS,
    // LLM 常见错误: 先执行再读配置 → 乱改 → 最后正确
    mockSeq: [
      { toolCalls: [{ name: 'edit_file', args: { path: 'webpack.config.js', search: 'dev', replace: 'prod' } }] },
      { toolCalls: [{ name: 'execute_command', args: { command: 'npm run build' } }] },
      { toolCalls: [{ name: 'read_file', args: { path: 'webpack.config.js' } }] },
      { toolCalls: [{ name: 'edit_file', args: { path: 'webpack.config.js', search: 'development', replace: 'production' } }] },
      { content: '已将构建模式改为 production' },
    ],
  },
];

// === MockLLM 固定序列（不响应反馈，模拟"不会从错误中学习的 LLM"）===
function createMockLLM(seq) {
  let i = 0;
  return {
    chat: async () => seq[i] || { content: '[done]' },
    _advance() { const r = seq[i]; if (i < seq.length) i++; return r; },
    reset() { i = 0; },
  };
}

// === Mock Executor（edit_file 只有精确匹配才成功）===
async function mockExec(name, args) {
  if (name === 'read_file' && args.path?.startsWith('/nonexistent')) {
    throw new Error(`ENOENT: ${args.path} not found`);
  }
  if (name === 'edit_file') {
    const content = 'class MyComponent { }';
    if (!content.includes(args.search)) {
      throw new Error(`Search string "${args.search}" not found`);
    }
  }
  if (name === 'execute_command') return `[mock] ${args.command} OK`;
  if (name === 'grep') return '[mock] src/App.js: class MyComponent';
  if (name === 'glob') return '[mock] src/App.js, src/main.js';
  if (name === 'read_file') return `[mock] ${args.path} content`;
  if (name === 'write_file') return '[mock] written';
  return `[mock] ${name} OK`;
}

function estimateTokens(str) {
  if (!str) return 0;
  let t = 0;
  for (const ch of str) t += ch.charCodeAt(0) > 127 ? 4 : 3;
  return Math.ceil(t / 3);
}

// === 基线循环（原样执行，无校验） ===
async function runBaseline(llm, executor) {
  const callCount = new Map();
  let finalText = '';
  let totalToken = 0;
  const rounds = [];
  const errors = [];

  for (let r = 0; r < MAX_ROUNDS; r++) {
    const resp = await llm.chat();
    totalToken += estimateTokens(JSON.stringify(resp));
    const tcs = resp.toolCalls || [];

    if (tcs.length === 0) { finalText = resp.content || ''; rounds.push({ round: r, final: true }); break; }

    const executed = [];
    for (const tc of tcs) {
      const name = tc.name;
      const args = tc.args || {};
      const key = `${name}:${JSON.stringify(args)}`;
      const cnt = (callCount.get(key) || 0) + 1;
      callCount.set(key, cnt);
      if (cnt > MAX_REPEAT) {
        const err = `[loop abort: ${name} ×${cnt}]`;
        errors.push(err); executed.push({ name, error: err }); finalText = err; break;
      }
      try {
        const result = await executor(name, args);
        executed.push({ name, args, result });
        totalToken += estimateTokens(JSON.stringify(result));
      } catch (e) {
        errors.push(e.message);
        executed.push({ name, args, error: e.message });
        totalToken += estimateTokens(e.message);
      }
    }
    rounds.push({ round: r, executed, errorCount: executed.filter(e => e.error).length });
    if (finalText) break;
  }
  if (!finalText) finalText = '[max rounds]';

  return { rounds: rounds.length, completed: !finalText.includes('[loop abort]') && !finalText.includes('[max rounds]'), errorCount: errors.length, tokenEstimate: totalToken, finalText, errors, roundDetails: rounds };
}

// === 带 guardrails 的循环 ===
async function runPipeline(llm, executor) {
  const callCount = new Map();
  const enforcer = createStepEnforcer();
  const tracker = createErrorTracker();
  let finalText = '';
  let totalToken = 0;
  const rounds = [];
  const errors = [];

  // 注册步骤依赖: edit_file 依赖 grep/read_file
  enforcer.defineAll({
    edit_file: ['grep', 'read_file'],
    write_file: ['read_file'],
    execute_command: ['read_file'],
  });

  for (let r = 0; r < MAX_ROUNDS; r++) {
    const resp = await llm.chat();
    totalToken += estimateTokens(JSON.stringify(resp));

    const validation = validateResponse(resp, MOCK_TOOLS);
    const tcs = validation.toolCalls;

    if (tcs.length === 0) {
      if (validation.errors.length > 0) {
        // 全部工具调用非法，发 nudge 引导
        const nudge = `[GP] 校验失败: ${validation.errors.map(e => e.error).join('; ')}`;
        totalToken += estimateTokens(nudge);
        errors.push(nudge);
        rounds.push({ round: r, blocked: true, errorCount: validation.errors.length });
        continue;
      }
      finalText = resp.content || '';
      rounds.push({ round: r, final: true });
      break;
    }

    const executed = [];
    for (const tc of tcs) {
      // 步骤前提检查
      const check = enforcer.check(tc.name);
      if (!check.ok) {
        const err = `[GP 依赖缺失] ${tc.name} 需要: ${check.missing.join(', ')}`;
        errors.push(err);
        executed.push({ name: tc.name, error: err });
        totalToken += estimateTokens(err);
        continue;
      }

      const key = `${tc.name}:${JSON.stringify(tc.args)}`;
      const cnt = (callCount.get(key) || 0) + 1;
      callCount.set(key, cnt);
      if (cnt > MAX_REPEAT) {
        const err = `[GP abort: ${tc.name} ×${cnt}]`;
        errors.push(err); executed.push({ name: tc.name, error: err }); finalText = err; break;
      }

      try {
        const result = await executor(tc.name, tc.args);
        executed.push({ name: tc.name, args: tc.args, result });
        totalToken += estimateTokens(JSON.stringify(result));
        enforcer.complete(tc.name);
      } catch (e) {
        errors.push(e.message);
        executed.push({ name: tc.name, args: tc.args, error: e.message });
        totalToken += estimateTokens(e.message);
        tracker.record(tc.name, tc.args, e.message, r);
      }
    }
    rounds.push({ round: r, executed, errorCount: executed.filter(e => e.error).length });
    if (finalText) break;
  }
  if (!finalText) finalText = '[GP max rounds]';

  return { rounds: rounds.length, completed: !finalText.includes('[GP abort]') && !finalText.includes('[GP max rounds]'), errorCount: errors.length, tokenEstimate: totalToken, finalText, errors, roundDetails: rounds };
}

// === 组件级单元测试 ===
function testResponseValidator() {
  const r1 = validateResponse({ toolCalls: [{ name: 'read_file', function: { name: 'read_file', arguments: '{"path":"test"}' } }] }, MOCK_TOOLS);
  if (!r1.valid) return { ok: false, msg: `合法调用被拒: ${JSON.stringify(r1.errors)}` };

  const r2 = validateResponse({ toolCalls: [{ name: 'nonexistent', function: { name: 'nonexistent', arguments: '{}' } }] }, MOCK_TOOLS);
  if (r2.valid) return { ok: false, msg: '未知工具应报错' };

  const r3 = validateResponse({ toolCalls: [{ name: 'read_file', function: { name: 'read_file', arguments: 'not json' } }] }, MOCK_TOOLS);
  if (r3.valid) return { ok: false, msg: '坏 JSON 应报错' };

  return { ok: true, msg: `response-validator: 通过 (${r1.toolCalls.length}合法/${r2.errors.length}非法/${r3.errors.length}坏JSON)` };
}

function testStepEnforcer() {
  const e = createStepEnforcer();
  e.defineAll({ edit_file: ['read_file'], write_file: ['read_file'] });

  const c1 = e.check('edit_file');
  if (c1.ok) return { ok: false, msg: 'edit_file 应在 read_file 未完成时报错' };

  e.complete('read_file');
  const c2 = e.check('edit_file');
  if (!c2.ok) return { ok: false, msg: `read_file 完成后 edit_file 仍被拒: ${c2.missing}` };

  e.complete('edit_file');
  if (!e.isComplete('edit_file')) return { ok: false, msg: 'complete 标记未生效' };

  return { ok: true, msg: 'step-enforcer: 通过' };
}

function testErrorTracker() {
  const t = createErrorTracker();
  t.record('read_file', { path: '/x' }, 'ENOENT', 1);

  const s1 = t.shouldRetry('read_file', { path: '/x' }, 'ENOENT');
  if (!s1.retry) return { ok: false, msg: `首次重试应允许: ${s1.reason}` };
  if (s1.attempt !== 2) return { ok: false, msg: `attempt 应为 2: ${s1.attempt}` };

  t.record('read_file', { path: '/x' }, 'ENOENT', 2);
  t.record('read_file', { path: '/x' }, 'ENOENT', 3);

  const s2 = t.shouldRetry('read_file', { path: '/x' }, 'ENOENT');
  if (s2.retry) return { ok: false, msg: `超 3 次应拒: ${s2.reason}` };

  // 致命错误
  t.record('edit_file', {}, 'traversal denied', 1);
  const s3 = t.shouldRetry('edit_file', {}, 'traversal denied');
  if (s3.retry) return { ok: false, msg: '致命错误应拒' };

  return { ok: true, msg: 'error-tracker: 通过' };
}

// === 主入口 ===
export async function run({ inputs = {} } = {}) {
  const { op, scenario: rawSc, live = false, repeats = 3 } = inputs;
  if (!op) throw new Error('op required');

  if (op === 'test_components') {
    const results = [testResponseValidator(), testStepEnforcer(), testErrorTracker()];
    return { outputs: { componentTests: results, allPassed: results.every(r => r.ok) } };
  }

  if (op === 'run_pipeline') {
    const sc = rawSc || SCENARIOS[0];
    if (live) {
      const { persistentConfig } = await import('../core/persistent-config.js');
      const cfg = persistentConfig.config;
      const fallbacks = _buildFallbackChain(cfg);
      const TOOLS = sc.tools.map(t => ({ type: 'function', function: t.function }));
      const history = [{ role: 'system', content: '你是 AI 助手，可用工具完成任务。每次调一个工具。' }, { role: 'user', content: sc.text }];
      const result = await runPipelineLive(cfg, fallbacks, TOOLS, history);
      return { outputs: { ...result, scenario: sc.id } };
    }
    const llm = createMockLLM(sc.mockSeq);
    const result = await runPipeline(llm, mockExec);
    return { outputs: { ...result, scenario: sc.id } };
  }

  if (op === 'run_baseline') {
    const sc = rawSc || SCENARIOS[0];
    if (live) {
      const { persistentConfig } = await import('../core/persistent-config.js');
      const cfg = persistentConfig.config;
      const fallbacks = _buildFallbackChain(cfg);
      const TOOLS = sc.tools.map(t => ({ type: 'function', function: t.function }));
      const history = [{ role: 'system', content: '你是 AI 助手，可用工具完成任务。每次调一个工具。' }, { role: 'user', content: sc.text }];
      const result = await runBaselineLive(cfg, fallbacks, TOOLS, history);
      return { outputs: { ...result, scenario: sc.id } };
    }
    const llm = createMockLLM(sc.mockSeq);
    const result = await runBaseline(llm, mockExec);
    return { outputs: { ...result, scenario: sc.id } };
  }

  if (op === 'compare') {
    // 1) 先跑组件测试
    const ctResults = [testResponseValidator(), testStepEnforcer(), testErrorTracker()];
    const ctPass = ctResults.every(r => r.ok);

    if (!live) {
      // dryRun: 只跑开销测量 + 组件测试，不裁决 H0/H1
      const scs = rawSc ? [rawSc] : SCENARIOS;
      const rows = [];
      for (const sc of scs) {
        for (let r = 0; r < repeats; r++) {
          const bLlm = createMockLLM(sc.mockSeq);
          const tLlm = createMockLLM(sc.mockSeq);
          rows.push({
            scenario: sc.id, repeat: r,
            baseline: await runBaseline(bLlm, mockExec),
            treatment: await runPipeline(tLlm, mockExec),
          });
        }
      }
      const bySc = {};
      for (const row of rows) {
        if (!bySc[row.scenario]) bySc[row.scenario] = { b: [], t: [] };
        bySc[row.scenario].b.push(row.baseline);
        bySc[row.scenario].t.push(row.treatment);
      }
      const scenarios = {};
      for (const [sid, d] of Object.entries(bySc)) {
        const bTok = d.b.reduce((s, x) => s + x.tokenEstimate, 0) / d.b.length;
        const tTok = d.t.reduce((s, x) => s + x.tokenEstimate, 0) / d.t.length;
        const bErr = d.b.reduce((s, x) => s + x.errorCount, 0) / d.b.length;
        const tErr = d.t.reduce((s, x) => s + x.errorCount, 0) / d.t.length;
        const bRnd = d.b.reduce((s, x) => s + x.rounds, 0) / d.b.length;
        const tRnd = d.t.reduce((s, x) => s + x.rounds, 0) / d.t.length;
        scenarios[sid] = {
          baseline: { avgToken: +bTok.toFixed(0), avgErrors: +bErr.toFixed(1), avgRounds: +bRnd.toFixed(1) },
          treatment: { avgToken: +tTok.toFixed(0), avgErrors: +tErr.toFixed(1), avgRounds: +tRnd.toFixed(1) },
          delta: { token: +(tTok - bTok).toFixed(0), errors: +(tErr - bErr).toFixed(1), rounds: +(tRnd - bRnd).toFixed(1) },
        };
      }
      return { outputs: { mode: 'dryRun', scenarios, componentTests: ctResults, componentPass: ctPass, verdict: 'dryRun' } };
    }

    // live 模式: 需要 provider-kit
    const { createProvider } = await import('provider-kit');
    const { persistentConfig } = await import('../core/persistent-config.js');
    const cfg = persistentConfig.config;

    // 构建 fallback 链
    const currentProvider = cfg.current?.provider || 'minimax';
    const defaultModel = cfg.current?.model || 'MiniMax-M3';
    const fallbacks = [];
    fallbacks.push({ name: currentProvider, model: defaultModel });
    for (const [name, pcfg] of Object.entries(cfg.providers || {})) {
      if (name !== currentProvider && pcfg.apiKey)
        fallbacks.push({ name, model: pcfg.defaultModel || 'openrouter/auto' });
    }

    const TOOLS = MOCK_TOOLS.map(t => ({ type: 'function', function: t.function }));
    const systemMsg = { role: 'system', content: '你是 AI 助手，可以用工具完成任务。每次调用一个工具，获取结果后继续。完成后直接回答用户。' };

    const scs = rawSc ? [rawSc] : SCENARIOS;
    const rows = [];

    for (const sc of scs) {
      for (let r = 0; r < repeats; r++) {
        // baseline
        const bHistory = [{ ...systemMsg }, { role: 'user', content: sc.text }];
        const bResult = await runBaselineLive(cfg, fallbacks, TOOLS, bHistory);

        // treatment
        const tHistory = [{ ...systemMsg }, { role: 'user', content: sc.text }];
        const tResult = await runPipelineLive(cfg, fallbacks, TOOLS, tHistory);

        rows.push({ scenario: sc.id, repeat: r, baseline: bResult, treatment: tResult });
      }
    }

    const bySc = {};
    for (const row of rows) {
      if (!bySc[row.scenario]) bySc[row.scenario] = { b: [], t: [] };
      bySc[row.scenario].b.push(row.baseline);
      bySc[row.scenario].t.push(row.treatment);
    }

    const scenarios = {};
    for (const [sid, d] of Object.entries(bySc)) {
      const bComp = d.b.filter(x => x.completed).length / d.b.length;
      const tComp = d.t.filter(x => x.completed).length / d.t.length;
      const bTok = d.b.reduce((s, x) => s + x.tokenEstimate, 0) / d.b.length;
      const tTok = d.t.reduce((s, x) => s + x.tokenEstimate, 0) / d.t.length;
      const bErr = d.b.reduce((s, x) => s + x.errorCount, 0) / d.b.length;
      const tErr = d.t.reduce((s, x) => s + x.errorCount, 0) / d.t.length;
      const bRnd = d.b.reduce((s, x) => s + x.rounds, 0) / d.b.length;
      const tRnd = d.t.reduce((s, x) => s + x.rounds, 0) / d.t.length;
      scenarios[sid] = {
        baseline: { completionRate: bComp, avgToken: +bTok.toFixed(0), avgErrors: +bErr.toFixed(1), avgRounds: +bRnd.toFixed(1) },
        treatment: { completionRate: tComp, avgToken: +tTok.toFixed(0), avgErrors: +tErr.toFixed(1), avgRounds: +tRnd.toFixed(1) },
        delta: {
          completionRate: +(tComp - bComp).toFixed(2),
          token: +(tTok - bTok).toFixed(0),
          errors: +(tErr - bErr).toFixed(1),
          rounds: +(tRnd - bRnd).toFixed(1),
        },
      };
    }

    const allDeltas = Object.values(scenarios).map(s => s.delta);
    const totalSc = Object.keys(scenarios).length;
    const compUp = allDeltas.filter(d => d.completionRate > 0).length;
    const tokSaved = allDeltas.filter(d => d.token < -100).length; // token 节省 >100
    const rndSaved = allDeltas.filter(d => d.rounds < 0).length;
    const noCompLoss = allDeltas.filter(d => d.completionRate >= 0).length;
    // H1: 完成率不降 且 (token 省 >一半场景 或 轮次省 >一半场景 或 完成率升)
    const verdict = (noCompLoss === totalSc && (tokSaved > totalSc / 2 || rndSaved > totalSc / 2 || compUp > 0)) ? 'H1' : 'H0';
    const votes = `完成率↑${compUp}/${totalSc} token↓${tokSaved}/${totalSc} 轮次↓${rndSaved}/${totalSc}`;

    return { outputs: { mode: 'live', scenarios, verdict, votes, totalRuns: rows.length } };
  }

  throw new Error(`unknown op: "${op}"`);
}

function _buildFallbackChain(cfg) {
  const currentProvider = cfg.current?.provider || 'minimax';
  const defaultModel = cfg.current?.model || 'MiniMax-M3';
  const fb = [];
  fb.push({ name: currentProvider, model: defaultModel });
  for (const [name, pcfg] of Object.entries(cfg.providers || {})) {
    if (name !== currentProvider && pcfg.apiKey)
      fb.push({ name, model: pcfg.defaultModel || 'openrouter/auto' });
  }
  return fb;
}

// === live 模式：带 retry+fallback 的 LLM 调用 ===
async function _callLLM(provider, model, tools, history) {
  const resp = await provider.chat(model, history, { tools });
  const p = (await import('../core/epc-pipeline.mjs')).runPipeline(resp);
  return { content: p.content || '', toolCalls: p.toolCalls || [] };
}

async function _callLLMWithFallback(cfg, fallbacks, provider, model, tools, history, label) {
  for (let retry = 0; retry < 2; retry++) {
    try {
      return { ...(await _callLLM(provider, model, tools, history)), provider, model, fallbacks };
    } catch (e) {
      if (retry === 0 && (e.message?.includes('500') || e.message?.includes('timeout'))) {
        process.stdout.write(`\x1b[90m[retry ${retry + 1}: ${e.message.slice(0, 60)}]\x1b[0m\n`);
        continue;
      }
      const currentName = (label || model).split('/')[0];
      fallbacks = fallbacks.filter(fb => fb.name !== currentName);
      const nextFb = fallbacks[0];
      if (!nextFb) throw e;
      process.stdout.write(`\x1b[33m[fallback to ${nextFb.name}]\x1b[0m\n`);
      const { createProvider } = await import('provider-kit');
      provider = createProvider(nextFb.name, cfg.providers[nextFb.name]?.apiKey);
      await provider.connect(cfg.providers[nextFb.name]?.apiKey).catch(() => {});
      model = nextFb.model || 'openrouter/auto';
    }
  }
  throw new Error('All providers exhausted');
}

async function runBaselineLive(cfg, fallbacks, tools, history) {
  const callCount = new Map();
  let finalText = '';
  let totalToken = 0;
  const errors = [];
  const { createProvider } = await import('provider-kit');
  let provider = createProvider(fallbacks[0].name, cfg.providers[fallbacks[0].name]?.apiKey);
  await provider.connect(cfg.providers[fallbacks[0].name]?.apiKey).catch(() => {});
  let model = fallbacks[0].model;

  for (let r = 0; r < MAX_ROUNDS; r++) {
    const resp = await _callLLMWithFallback(cfg, fallbacks, provider, model, tools, history, fallbacks[0].name);
    ({ provider, model, fallbacks } = resp);
    totalToken += estimateTokens(resp.content);
    const tcs = resp.toolCalls || [];

    if (tcs.length === 0) { finalText = resp.content; break; }

    const asst = { role: 'assistant', content: resp.content || null, tool_calls: tcs.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.args || {}) } })) };
    history.push(asst);

    for (const tc of tcs) {
      const name = tc.name;
      const rawArgs = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.args || {});
      const key = `${name}:${rawArgs}`;
      const cnt = (callCount.get(key) || 0) + 1;
      callCount.set(key, cnt);
      if (cnt > MAX_REPEAT) { finalText = `[loop abort: ${name} ×${cnt}]`; break; }

      try {
        const result = await realExec(name, JSON.parse(rawArgs));
        totalToken += estimateTokens(JSON.stringify(result));
        history.push({ role: 'tool', tool_call_id: tc.id, content: result });
      } catch (e) {
        errors.push(e.message);
        totalToken += estimateTokens(e.message);
        history.push({ role: 'tool', tool_call_id: tc.id, content: `[Error] ${e.message}` });
      }
    }
    if (finalText) break;
  }
  if (!finalText) finalText = '[max rounds]';
  history.push({ role: 'assistant', content: finalText });

  return { rounds: Math.min(history.filter(m => m.role === 'assistant' && m.tool_calls).length + 1, MAX_ROUNDS), completed: !finalText.includes('[loop abort]') && !finalText.includes('[max rounds]'), errorCount: errors.length, tokenEstimate: totalToken, finalText, errors };
}

async function runPipelineLive(cfg, fallbacks, tools, history) {
  const callCount = new Map();
  const enforcer = createStepEnforcer();
  const tracker = createErrorTracker();
  let finalText = '';
  let totalToken = 0;
  const errors = [];
  const { createProvider } = await import('provider-kit');
  let provider = createProvider(fallbacks[0].name, cfg.providers[fallbacks[0].name]?.apiKey);
  await provider.connect(cfg.providers[fallbacks[0].name]?.apiKey).catch(() => {});
  let model = fallbacks[0].model;

  enforcer.defineAll({ edit_file: ['grep', 'read_file'], write_file: ['read_file'], execute_command: ['read_file'] });

  for (let r = 0; r < MAX_ROUNDS; r++) {
    const resp = await _callLLMWithFallback(cfg, fallbacks, provider, model, tools, history, fallbacks[0].name);
    ({ provider, model, fallbacks } = resp);
    totalToken += estimateTokens(resp.content);

    const validation = validateResponse({ toolCalls: resp.toolCalls }, tools);
    const tcs = validation.toolCalls;

    if (tcs.length === 0) {
      if (validation.errors.length > 0) {
        const nudge = `[GP] 校验失败: ${validation.errors.map(e => e.error).join('; ')}。请修正工具调用。`;
        totalToken += estimateTokens(nudge);
        errors.push(nudge);
        continue;
      }
      finalText = resp.content;
      break;
    }

    const asstCalls = tcs.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } }));
    history.push({ role: 'assistant', content: resp.content || null, tool_calls: asstCalls });

    for (const tc of tcs) {
      const check = enforcer.check(tc.name);
      if (!check.ok) {
        const err = `[GP 依赖缺失] ${tc.name} 需要先: ${check.missing.join(', ')}`;
        errors.push(err);
        totalToken += estimateTokens(err);
        history.push({ role: 'tool', tool_call_id: tc.id, content: err });
        continue;
      }

      const key = `${tc.name}:${JSON.stringify(tc.args)}`;
      const cnt = (callCount.get(key) || 0) + 1;
      callCount.set(key, cnt);
      if (cnt > MAX_REPEAT) { finalText = `[GP abort: ${tc.name} ×${cnt}]`; break; }

      try {
        const result = await realExec(tc.name, tc.args);
        totalToken += estimateTokens(JSON.stringify(result));
        history.push({ role: 'tool', tool_call_id: tc.id, content: result });
        enforcer.complete(tc.name);
      } catch (e) {
        errors.push(e.message);
        totalToken += estimateTokens(e.message);
        history.push({ role: 'tool', tool_call_id: tc.id, content: `[Error] ${e.message}` });
        tracker.record(tc.name, tc.args, e.message, r);
      }
    }
    if (finalText) break;
  }
  if (!finalText) finalText = '[GP max rounds]';
  history.push({ role: 'assistant', content: finalText });

  return { rounds: Math.min(history.filter(m => m.role === 'assistant' && m.tool_calls).length + 1, MAX_ROUNDS), completed: !finalText.includes('[GP abort]') && !finalText.includes('[GP max rounds]'), errorCount: errors.length, tokenEstimate: totalToken, finalText, errors };
}

// realExec 在 live 模式用 coding-tools
let _realExec = null;
export function setRealExecutor(fn) { _realExec = fn; }
async function realExec(name, args) {
  if (_realExec) return _realExec(name, args);
  const { executeTool } = await import('../tools/coding-tools.mjs');
  const r = await executeTool(name, args);
  return typeof r === 'string' ? r : JSON.stringify(r, null, 2);
}

// === test() — dryRun 组件测试 + 开销报告 ===
import { create } from './lib/report.mjs';
const { ok, ng, report } = create();
const NAME = 'Guardrails Pipeline';

async function test() {
  // 1. 组件级单元测试
  const rv = testResponseValidator();
  if (rv.ok) ok(rv.msg);
  else ng(rv.msg);

  const se = testStepEnforcer();
  if (se.ok) ok(se.msg);
  else ng(se.msg);

  const et = testErrorTracker();
  if (et.ok) ok(et.msg);
  else ng(et.msg);

  // 2. dryRun 开销测量
  const result = await run({ inputs: { op: 'compare', repeats: 3 } });
  const { scenarios, componentPass, verdict } = result.outputs;

  for (const [sid, data] of Object.entries(scenarios)) {
    const { baseline: b, treatment: t, delta: d } = data;
    const tokStr = `${d.token > 0 ? '+' : ''}${d.token}`;
    const errStr = `${d.errors > 0 ? '+' : ''}${d.errors.toFixed(1)}`;
    const rndStr = `${d.rounds > 0 ? '+' : ''}${d.rounds.toFixed(1)}`;
    console.log(`  ▸ ${sid}: token=${tokStr}  err=${errStr}  rnd=${rndStr}`);
  }

  if (componentPass) ok('组件测试全通过');
  else ng('组件测试有失败');

  ok(`模式: ${verdict} (dryRun 不裁决 H0/H1)`);

  report(NAME);
}

export { test };
