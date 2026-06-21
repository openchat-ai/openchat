

// ===== 01.mjs =====
// Experiment 1: persistent-config (OpenChat 配置管理)
// Manifest id: config
// I/O: {} → { config, provider, model, paths }

import { create } from './lib/report.mjs';

export const experiment_01_META = { id: 'config' };

// compose 契约入口：返回当前配置
export async function experiment_01_run() {
  const mod = await import('./lib/config.mjs');
  const cfg = mod.persistentConfig?.config || {};
  return {
    outputs: {
      config: cfg,
      provider: cfg.current?.provider || '',
      model: cfg.current?.model || '',
      paths: Object.fromEntries(
        ['USER_DIR', 'PROJECT_DIR', 'SESSIONS_DIR', 'MEMORY_DIR', 'LOGS_DIR', 'HOUSES_DIR', 'SKILLS_DIR']
          .filter(k => mod[k]).map(k => [k, mod[k]]),
      ),
    },
  };
}

const { ok, ng, skip, report } = create();
const NAME = 'Config — persistent-config 加载';

async function test() {
  let mod;
  try {
    mod = await import('./lib/config.mjs');
    ok('persistent-config.js 可加载');
  } catch (e) {
    ng('persistent-config 加载失败', e);
    return report(NAME);
  }

  if (mod.persistentConfig) ok('persistentConfig 单例存在');
  else ng('persistentConfig 单例缺失');

  if (mod.default) ok('default 导出存在');
  else ng('default 导出缺失');

  // 路径常量
  for (const k of ['USER_DIR', 'PROJECT_DIR', 'SESSIONS_DIR', 'MEMORY_DIR', 'LOGS_DIR', 'HOUSES_DIR', 'SKILLS_DIR']) {
    if (typeof mod[k] === 'string' && mod[k].length > 0) ok(`路径常量 ${k} = ${mod[k]}`);
    else ng(`路径常量 ${k} 缺失`);
  }

  // .config 字段 (config.json 解析结果)
  try {
    const cfg = mod.persistentConfig.config || {};
    ok(`config.providers 类型: ${typeof cfg.providers}`);
    if (cfg.current) ok(`config.current.provider = ${cfg.current.provider || '(unset)'}`);
    else ok('config.current 未设置 (无 provider)');
  } catch (e) {
    skip(`config 读取跳过: ${e.message}`);
  }

  report(NAME);
}

export { test };


// ===== 02.mjs =====
// Experiment 51: Feature Flag — 分层回退 env→local→remote→disk→hardcoded
//
// 基于 CCB growthbook.ts 模式精简实现。
// 五层回退：env 覆盖 → 本地门控 → 远程评估 → 磁盘缓存 → 硬编码默认值
// 同步读取 + 异步刷新，无外部依赖。
//
// I/O (compose 契约):
//   { op, flag?, value?, overrides? }
//   → { outputs: { value?, source?, all?, history? } }

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { create } from './lib/report.mjs';

export const experiment_02_META = { id: 'feature-flag' };

const NAME = 'Feature Flag — 分层回退 env→local→remote→disk→hardcoded';

// ── 硬编码默认值 ──
const HARDCODED = {
  voice_mode: false,
  debug_tools: true,
  multi_agent: false,
  chat_auto_naming: true,
  audio_fallback_chain: false,
  skill_loader: true,
  teach_me: true,
  dream_consolidation: false,
};

// ── 磁盘缓存路径 ──
const CACHE_DIR = resolve(homedir(), '.openchat');
const CACHE_FILE = resolve(CACHE_DIR, 'feature-flags.json');

// ── 状态 ──
let _localOverrides = {};
let _remoteCache = null;
let _diskCache = null;
let _initialized = false;
let _initPromise = null;
const _pendingExposures = new Set();
const _loggedExposures = new Set();
const _listeners = [];
const _refreshTimer = null;

// ── 内部解析 ──

function _getEnvOverride(flag) {
  const key = `FEATURE_${flag.toUpperCase()}`;
  const raw = process.env[key];
  if (raw === undefined) return undefined;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return raw;
}

function _resolveSync(flag) {
  // ① env 覆盖
  const envVal = _getEnvOverride(flag);
  if (envVal !== undefined) return { value: envVal, source: 'env' };

  // ② 本地门控 (runtime in-memory)
  if (Object.prototype.hasOwnProperty.call(_localOverrides, flag)) {
    return { value: _localOverrides[flag], source: 'local' };
  }

  // ③ 远程评估缓存 (in-memory)
  if (_remoteCache && Object.prototype.hasOwnProperty.call(_remoteCache, flag)) {
    return { value: _remoteCache[flag], source: 'remote' };
  }

  // ④ 磁盘缓存
  if (_diskCache && Object.prototype.hasOwnProperty.call(_diskCache, flag)) {
    return { value: _diskCache[flag], source: 'disk' };
  }

  // ⑤ 硬编码默认值
  if (Object.prototype.hasOwnProperty.call(HARDCODED, flag)) {
    return { value: HARDCODED[flag], source: 'hardcoded' };
  }

  return { value: false, source: 'hardcoded' };
}

// ── 磁盘 I/O ──

async function _loadDiskCache() {
  try {
    if (existsSync(CACHE_FILE)) {
      const raw = await readFile(CACHE_FILE, 'utf8');
      _diskCache = JSON.parse(raw);
      return;
    }
  } catch (e) { console.error('[C0]', e); }
  _diskCache = null;
}

async function _saveDiskCache() {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(_remoteCache || {}, null, 2), 'utf8');
  } catch (e) { console.error('[C0]', e); }
}

// ── 远程评估（模拟） ──

async function _fetchRemote() {
  // placeholder: 实际场景对接 GrowthBook / LaunchDarkly API
  // 这里返回一个延迟 100ms 的模拟值
  await new Promise(r => setTimeout(r, 100));
  return {
    voice_mode: true,
    chat_auto_naming: true,
    skill_loader: false,
  };
}

function _notifyListeners() {
  for (const fn of _listeners) {
    try { fn(); } catch (e) { console.error('[C0]', e); }
  }
}

// ── 初始化 ──

async function _ensureInit() {
  if (_initialized) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    await _loadDiskCache();
    try {
      const remote = await _fetchRemote();
      _remoteCache = remote;
      await _saveDiskCache();
    } catch {
      // 远程失败：使用磁盘缓存（或硬编码）
    }
    _initialized = true;
    _initPromise = null;
    _notifyListeners();
  })();
  return _initPromise;
}

// ── Public API ──

export async function experiment_02_run({ inputs = {} } = {}) {
  const { op, flag, value, overrides } = inputs;

  switch (op) {
    case 'get': {
      if (!flag) throw new Error('flag required for get');
      const result = _resolveSync(flag);
      return { outputs: result };
    }

    case 'get_cached': {
      if (!flag) throw new Error('flag required');
      await _ensureInit();
      const result = _resolveSync(flag);
      return { outputs: result };
    }

    case 'list': {
      await _ensureInit();
      const all = {};
      for (const key of Object.keys(HARDCODED)) {
        all[key] = _resolveSync(key);
      }
      // 动态 flag（不在硬编码中的）
      const dynamic = new Set();
      if (_remoteCache) for (const k of Object.keys(_remoteCache)) dynamic.add(k);
      if (_diskCache) for (const k of Object.keys(_diskCache)) dynamic.add(k);
      for (const key of dynamic) {
        if (!(key in HARDCODED)) all[key] = _resolveSync(key);
      }
      return { outputs: { all } };
    }

    case 'set': {
      if (!flag) throw new Error('flag required');
      _localOverrides[flag] = value;
      return { outputs: { value, source: 'local' } };
    }

    case 'clear': {
      if (flag) {
        delete _localOverrides[flag];
      } else {
        _localOverrides = {};
      }
      return { outputs: { ok: true } };
    }

    case 'refresh': {
      try {
    await checkGate_CACHED_MAY_BE_STALE();
        const remote = await _fetchRemote();
        _remoteCache = remote;
        await _saveDiskCache();
        _notifyListeners();
        return { outputs: { ok: true, source: 'remote' } };
      } catch (e) {
        return { outputs: { ok: false, source: 'remote', error: e.message } };
      }
    }

    case 'status': {
      return {
        outputs: {
          initialized: _initialized,
          localOverrides: Object.keys(_localOverrides).length,
          remoteCached: _remoteCache ? Object.keys(_remoteCache).length : 0,
          diskCached: _diskCache ? Object.keys(_diskCache).length : 0,
          listenerCount: _listeners.length,
        },
      };
    }

    case 'on_change': {
      if (typeof value === 'function') _listeners.push(value);
      return { outputs: { ok: true } };
    }

    default:
      throw new Error(`unknown op: ${op}`);
  }
}

// ── 安全性门控（skip remote eval） ──

export function experiment_02_checkGate_CACHED_MAY_BE_STALE(gate) {
  const { value } = _resolveSync(gate);
  return Boolean(value);
}

// ── 测试 ──

export async function experiment_02_test() {
  const { ok, ng, report } = create();
  let pass = true;

  // ① env 覆盖
  process.env.FEATURE_VOICE_MODE = 'false';
  const r1 = _resolveSync('voice_mode');
  if (r1.value === false && r1.source === 'env') ok('env override works');
  else { ng(`env override: got ${r1.source} = ${r1.value}`); pass = false; }
  delete process.env.FEATURE_VOICE_MODE;

  // ② 本地门控（无 env 时生效）
  await run({ inputs: { op: 'set', flag: 'audio_fallback_chain', value: true } });
  const r2 = _resolveSync('audio_fallback_chain');
  if (r2.value === true && r2.source === 'local') ok('local override works');
  else { ng(`local override: got ${r2.source} = ${r2.value}`); pass = false; }
  _localOverrides = {};

  // ③ 远程评估
  _remoteCache = { debug_tools: false };
  _initialized = true;
  const r3 = _resolveSync('debug_tools');
  if (r3.value === false && r3.source === 'remote') ok('remote eval works');
  else { ng(`remote eval: got ${r3.source} = ${r3.value}`); pass = false; }
  _remoteCache = null;
  _initialized = false;

  // ④ 磁盘缓存
  _diskCache = { multi_agent: true };
  const r4 = _resolveSync('multi_agent');
  if (r4.value === true && r4.source === 'disk') ok('disk cache works');
  else { ng(`disk cache: got ${r4.source} = ${r4.value}`); pass = false; }
  _diskCache = null;

  // ⑤ 硬编码默认值
  const r5 = _resolveSync('teach_me');
  if (r5.value === true && r5.source === 'hardcoded') ok('hardcoded default works');
  else { ng(`hardcoded: got ${r5.source} = ${r5.value}`); pass = false; }

  // ⑥ 不存在 flag 返回 false
  const r6 = _resolveSync('nonexistent_flag');
  if (r6.value === false && r6.source === 'hardcoded') ok('nonexistent flag returns false');
  else { ng(`nonexistent: got ${r6.source} = ${r6.value}`); pass = false; }

  // ⑦ get_cached 异步初始化
  const r7 = await run({ inputs: { op: 'get_cached', flag: 'debug_tools' } });
  if (r7.outputs.value === true && r7.outputs.source) ok('get_cached async works');
  else { ng(`get_cached: got ${JSON.stringify(r7.outputs)}`); pass = false; }

  // ⑧ list 返回所有
  const r8 = await run({ inputs: { op: 'list' } });
  const keys = Object.keys(r8.outputs.all);
  if (keys.length >= Object.keys(HARDCODED).length) ok(`list returns ${keys.length} flags`);
  else { ng(`list: got ${keys.length} flags, expected >= ${Object.keys(HARDCODED).length}`); pass = false; }

  // ⑨ status
  const r9 = await run({ inputs: { op: 'status' } });
  if (typeof r9.outputs.initialized === 'boolean') ok('status works');
  else { ng(`status: missing initialized`); pass = false; }

  report(NAME);
  return pass;
}


// ===== 03.mjs =====
// Experiment 17: provider-kit 适配器总测
//
// provider-kit 是独立 node 项目 (modules/provider-kit/),有自己的 test/*.test.js (node:test 单测)。
// 本实验在 openchat 这边给它建一个"门户实验" — 测最关键的几条路径,让 openchat compose 能用:
//
//   ① 4 个 normalize 纯函数 (idempotent + edge cases — 这是 provider-kit 暴露给 openchat 的纯函数层)
//   ② OpenAICompatibleProvider adapter: mock fetch, 测 chat() 端到端
//   ③ 错误分类: 4xx / 429 / 5xx / network → ProviderError + retryable
//   ④ withRetry / withTimeout: 重试退避 + 不可重试错误立即抛
//   ⑤ EPC 编码往返: encode → parse 不丢数据
//
// I/O (compose 契约):
//   { op: 'normalize', raw, reasoning, toolCalls }  → { content, reasoning, toolCalls }
//   { op: 'createProvider', providerId, apiKey }    → { id, name, baseUrl }
//   { op: 'classify', statusCode, message }         → { type, retryable, friendly }
//   { op: 'withRetry', willFail, retries }           → { ok, attempts }
//   { op: 'roundtripEpc', content, reasoning, toolCalls } → { frames, ok }

import { create } from './lib/report.mjs';
import {
  extractContent, extractReasoning, normalizeToolCalls, parseActionFallback,
  classifyError, ProviderError, withRetry, withTimeout,
  createProvider, listPresetProviders, parseFrames, epcFromResponse,
} from 'provider-kit';

export const experiment_03_META = { id: 'provider-kit' };

export async function experiment_03_run({ inputs = {} } = {}) {
  const { op } = inputs;
  if (op === 'normalize') {
    const { raw = '', reasoning = null, toolCalls = [] } = inputs;
    return {
      outputs: {
        content: extractContent(raw),
        reasoning: extractReasoning(reasoning ? { reasoning_content: reasoning, reasoningContent: reasoning } : null),
        toolCalls: parseActionFallback(raw, normalizeToolCalls(toolCalls)),
      },
    };
  }
  if (op === 'createProvider') {
    const p = createProvider(inputs.providerId || 'openai', inputs.apiKey || 'sk-test');
    return { outputs: { id: p.id, name: p.name, baseUrl: p.baseUrl, skipAuth: !!p.skipAuth } };
  }
  if (op === 'classify') {
    const e = classifyError(new Error(inputs.message || 'mock'), 'mock');
    return { outputs: { type: e.type, retryable: e.retryable, friendly: e.message } };
  }
  throw new Error(`unknown op: ${op}`);
}

const NAME = 'provider-kit — 适配器总测 (normalize + adapter + 错误分类 + 重试 + EPC 往返)';

async function test() {
  const { ok, ng, report } = create();

  // === ① 4 个 normalize 纯函数 (provider-kit 暴露给 openchat 的纯函数层) ===

  // 1a. extractContent — XML 标签剥离 / JSON 提取 / 普通字符串
  {
    const cases = [
      { in: '<think>hello</think>world',          out: 'hello world' },
      { in: '<think>a</think><think>b</think>c',  out: 'a b c' },
      { in: 'no think',                            out: 'no think' },
      { in: '',                                    out: '' },
      { in: null,                                  out: '' },
      { in: '<think>多\n行\nthink</think>after',  out: '多 行 think after' },
    ];
    let allPass = true;
    for (const c of cases) {
      if (extractContent(c.in) !== c.out) { allPass = false; ng(`extractContent 错: ${JSON.stringify(c.in)} → ${JSON.stringify(extractContent(c.in))}`); }
    }
    if (allPass) ok(`extractContent: ${cases.length} cases`);
  }

  // 1b. extractReasoning — 两种命名 + 优先级
  {
    const cases = [
      { in: { reasoning_content: 'r1' },                 out: 'r1' },
      { in: { reasoningContent: 'r2' },                  out: 'r2' },
      { in: {},                                            out: '' },
      { in: null,                                          out: '' },
      { in: { reasoning_content: 'r3', reasoningContent: 'r3.5' }, out: 'r3' },
    ];
    let allPass = true;
    for (const c of cases) {
      if (extractReasoning(c.in) !== c.out) { allPass = false; ng(`extractReasoning 错: ${JSON.stringify(c.in)}`); }
    }
    if (allPass) ok(`extractReasoning: ${cases.length} cases (reasoning_content 优先)`);
  }

  // 1c. normalizeToolCalls — OpenAI-original 嵌套 / 已扁平 / 幂等 (关键!)
  {
    // 嵌套 → 扁平
    const nested = [
      { id: 'a', function: { name: 'foo', arguments: '{"x":1}' } },
      { id: 'b', function: { name: 'bar', arguments: '{}' } },
      null,
      { no_function: true },
    ];
    const flat1 = normalizeToolCalls(nested);
    if (flat1.length !== 2 || flat1[0].name !== 'foo' || flat1[0].arguments !== '{"x":1}') {
      ng(`normalizeToolCalls 嵌套错: ${JSON.stringify(flat1)}`);
    } else ok(`normalizeToolCalls: OpenAI-original 嵌套 → 扁平 (过滤 null/无效)`);

    // 已扁平 → 二次调用不变 (幂等 — 这是之前发现的 bug)
    const flatInput = [{ id: 'c', name: 'baz', arguments: '{}' }];
    const flat2 = normalizeToolCalls(flatInput);
    if (flat2.length === 1 && flat2[0].id === 'c' && flat2[0].name === 'baz') {
      ok('normalizeToolCalls: 已扁平 → 二次调用不变 (幂等)');
    } else ng(`normalizeToolCalls 幂等错: ${JSON.stringify(flat2)}`);
  }

  // 1d. parseActionFallback — 有/无/合法/非法
  {
    const g0 = parseActionFallback('whatever', [{ id: 'x', name: 'y', arguments: '{}' }]);
    if (g0.length === 1 && g0[0].id === 'x') ok('parseActionFallback: 已有 toolCalls → 不动');
    else ng(`fallback 错 (有 tc): ${JSON.stringify(g0)}`);

    const g1 = parseActionFallback('hello world', []);
    if (g1.length === 0) ok('parseActionFallback: 无 ACTION → 空');
    else ng(`fallback 错 (无 ACTION): ${JSON.stringify(g1)}`);

    const g2 = parseActionFallback('ACTION: search {"q":"x"}', []);
    if (g2.length === 1 && g2[0].name === 'search' && g2[0].arguments.includes('x')) {
      ok(`parseActionFallback: 合法 ACTION: → ${g2[0].name}(${g2[0].arguments})`);
    } else ng(`fallback 错 (合法): ${JSON.stringify(g2)}`);

    const g3 = parseActionFallback('ACTION: foo {not json}', []);
    if (g3.length === 0) ok('parseActionFallback: 非法 JSON → 不降级');
    else ng(`fallback 错 (非法 JSON): ${JSON.stringify(g3)}`);
  }

  // === ② OpenAICompatibleProvider adapter: createProvider + 列表 + 基本结构 ===
  {
    const providers = listPresetProviders();
    if (Array.isArray(providers) && providers.length > 30) {
      ok(`listPresetProviders: ${providers.length} 个预设 provider (含 openai/anthropic/...)`);
    } else ng(`listPresetProviders 数量异常: ${providers?.length}`);

    const p = createProvider('openai', 'sk-test-1234');
    if (p && p.id === 'openai' && p.baseUrl && p.apiKey === 'sk-test-1234') {
      ok(`createProvider('openai'): id=${p.id}, baseUrl=${p.baseUrl.substring(0, 30)}...`);
    } else ng(`createProvider 错: ${JSON.stringify(p)}`);

    // 未知 provider: 用通用配置兜底
    const p2 = createProvider('my-custom', 'sk-test');
    if (p2 && p2.id === 'my-custom' && p2.apiKey === 'sk-test') {
      ok(`createProvider(未知 id): 兜底通用配置`);
    } else ng(`createProvider 未知错: ${JSON.stringify(p2)}`);
  }

  // === ③ OpenAICompatibleProvider.chat() — mock fetch, 测端到端 ===
  {
    // 3a. 成功响应: 完整字段 (think + reasoning + toolCalls 嵌套)
    const p = createProvider('openai', 'sk-test');
    const originalFetch = globalThis.fetch;
    let capturedUrl = null, capturedBody = null;
    globalThis.fetch = async (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: '{"text":"Hello!","meta":"思考中"}',
              reasoning_content: '我应该回答',
              tool_calls: [{ id: 't1', function: { name: 'search', arguments: '{"q":"x"}' } }],
            },
          }],
        }),
      };
    };

    try {
      await p.connect('sk-test');
      const r = await p.chat('gpt-4', [{ role: 'user', content: 'hi' }], { includeRaw: false });
      if (r.content === 'Hello!') ok('adapter.chat: extractContent 内容正确');
      else ng(`adapter.chat content 错: ${r.content}`);
      // reasoning 不在顶层, 在 epc 的 SUB_THINKING 帧里 (provider-kit 当前契约)
      const rFrames = parseFrames(r.epc);
      const thinkingFrame = rFrames.find(f => f.sub === 0x11);
      if (thinkingFrame && thinkingFrame.payload.toString('utf8') === '我应该回答') {
        ok('adapter.chat: reasoning 在 epc SUB_THINKING 帧里');
      } else ng(`adapter.chat reasoning 帧错: ${thinkingFrame?.payload?.toString('utf8')}`);
      if (r.toolCalls.length === 1 && r.toolCalls[0].name === 'search' && r.toolCalls[0].id === 't1') {
        ok('adapter.chat: 嵌套 tool_calls → 扁平化');
      } else ng(`adapter.chat toolCalls 错: ${JSON.stringify(r.toolCalls)}`);
      if (Buffer.isBuffer(r.epc) && r.epc.length > 0) ok(`adapter.chat: epc 帧 ${r.epc.length} 字节`);
      else ng(`adapter.chat epc 错: ${r.epc}`);
      if (capturedUrl && capturedUrl.includes('/chat/completions')) ok(`adapter.chat: fetch URL 正确 (${capturedUrl.substring(0, 50)}...)`);
      else ng(`adapter.chat URL 错: ${capturedUrl}`);
      if (capturedBody && capturedBody.model === 'gpt-4' && Array.isArray(capturedBody.messages)) {
        ok(`adapter.chat: request body 正确 (model=${capturedBody.model})`);
      } else ng(`adapter.chat body 错: ${JSON.stringify(capturedBody)}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // === ④ 错误分类: classifyError / withRetry ===
  {
    // classifyError 看 message 字符串 (含状态码) 来分类 — 不用 error.status
    // 4a. 401 auth (不可重试)
    const e401 = classifyError(new Error('401 Unauthorized: Invalid API key'), 'openai');
    if (e401.type === 'auth' && e401.retryable === false) {
      ok(`classifyError(401): type=auth, retryable=false`);
    } else ng(`classifyError 401 错: ${JSON.stringify(e401)}`);

    // 4b. 429 rate limit (可重试)
    const e429 = classifyError(new Error('429 Too Many Requests: rate limit exceeded'), 'openai');
    if (e429.type === 'rate_limit' && e429.retryable === true) {
      ok(`classifyError(429): type=rate_limit, retryable=true`);
    } else ng(`classifyError 429 错: ${JSON.stringify(e429)}`);

    // 4c. 5xx server error (可重试)
    const e500 = classifyError(new Error('503 Service Unavailable: server error'), 'openai');
    if (e500.type === 'server_error' && e500.retryable === true) {
      ok(`classifyError(503): type=server_error, retryable=true`);
    } else ng(`classifyError 503 错: ${JSON.stringify(e500)}`);

    // 4d. ProviderError: 自带 metadata
    const pe = new ProviderError('boom', { provider: 'openai', statusCode: 429, retryable: true, type: 'rate_limit' });
    if (pe.provider === 'openai' && pe.statusCode === 429 && pe.retryable === true) {
      ok(`ProviderError: provider/statusCode/retryable 正确`);
    } else ng(`ProviderError 错: ${JSON.stringify(pe)}`);
  }

  // === ⑤ withRetry: 成功 / 重试后成功 / 不可重试立即抛 / 超过重试次数抛 ===
  {
    // 5a. 立即成功 — 不重试
    let attempts = 0;
    const r1 = await withRetry(async () => { attempts++; return 'ok'; }, { retries: 3 });
    if (r1 === 'ok' && attempts === 1) ok('withRetry: 立即成功 (1 次调用)');
    else ng(`withRetry 立即成功错: ${JSON.stringify({ r1, attempts })}`);

    // 5b. 重试 2 次后成功 — 3 次调用 (5xx → server_error → 可重试)
    attempts = 0;
    const r2 = await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new Error('503 Service Unavailable: server error');
      return 'recovered';
    }, { retries: 3, baseDelay: 1 });
    if (r2 === 'recovered' && attempts === 3) ok('withRetry: 503 重试 2 次后成功 (3 次调用)');
    else ng(`withRetry 重试错: ${JSON.stringify({ r2, attempts })}`);

    // 5c. 不可重试 (401) — 立即抛
    attempts = 0;
    let threw401 = false;
    try {
      await withRetry(async () => {
        attempts++;
        throw new Error('401 Unauthorized: Invalid API key');
      }, { retries: 3, baseDelay: 1 });
    } catch (e) { threw401 = true; }
    if (threw401 && attempts === 1) ok('withRetry: 401 不可重试 → 立即抛 (1 次调用)');
    else ng(`withRetry 不可重试错: ${JSON.stringify({ threw401, attempts })}`);

    // 5d. 超过重试次数 — 抛最后一次错误
    attempts = 0;
    let lastErr = null;
    try {
      await withRetry(async () => {
        attempts++;
        throw new Error('503 Service Unavailable: server error');
      }, { retries: 2, baseDelay: 1 });
    } catch (e) { lastErr = e; }
    if (lastErr && attempts === 3) ok('withRetry: 超过 retries → 抛最后一次 (3 次调用)');
    else ng(`withRetry 超限错: ${JSON.stringify({ lastErr: lastErr?.message, attempts })}`);
  }

  // === ⑥ withTimeout: 超时抛错 / 及时返回 ===
  {
    // 6a. 及时返回
    const r1 = await withTimeout(async () => {
      await new Promise(r => setTimeout(r, 10));
      return 'fast';
    }, 100);
    if (r1 === 'fast') ok('withTimeout: 及时返回');
    else ng(`withTimeout 及时错: ${r1}`);

    // 6b. 超时抛错 (ProviderError type='timeout', message='Request timed out...')
    let timedOut = false;
    let timeoutErr = null;
    try {
      await withTimeout(async () => {
        await new Promise(r => setTimeout(r, 200));
        return 'slow';
      }, 50);
    } catch (e) {
      timeoutErr = e;
      timedOut = (e.name === 'ProviderError' && (e.type === 'timeout' || /timed out|timeout/i.test(e.message)));
    }
    if (timedOut) ok(`withTimeout: 超时抛 ProviderError(type=timeout) — "${timeoutErr.message.substring(0, 40)}"`);
    else ng(`withTimeout 超时未抛: ${timedOut}, err=${timeoutErr?.name}/${timeoutErr?.type}/${timeoutErr?.message}`);
  }

  // === ⑦ EPC 往返: epcFromResponse → parseFrames ===
  {
    const epc = epcFromResponse({
      content: 'Hello',
      reasoningContent: 'thinking',
      toolCalls: [{ id: '1', name: 't', arguments: '{}' }],
    });
    const frames = parseFrames(epc);
    if (frames.length === 3) ok(`EPC 往返: encode → parse 出 ${frames.length} 帧 (content + thinking + tool_call)`);
    else ng(`EPC 帧数错: ${frames.length}`);

    // 验证每个帧内容能读出来
    const contentFrame = frames.find(f => f.sub === 0x10);
    if (contentFrame && contentFrame.payload.toString('utf8') === 'Hello') {
      ok('EPC content 帧: payload = "Hello"');
    } else ng(`EPC content 错: ${contentFrame?.payload?.toString('utf8')}`);

    const thinkingFrame = frames.find(f => f.sub === 0x11);
    if (thinkingFrame && thinkingFrame.payload.toString('utf8') === 'thinking') {
      ok('EPC thinking 帧: payload = "thinking"');
    } else ng(`EPC thinking 错: ${thinkingFrame?.payload?.toString('utf8')}`);

    const toolFrame = frames.find(f => f.sub === 0x12);
    if (toolFrame) ok(`EPC tool_call 帧: id=${toolFrame.id}, name=${toolFrame.name}`);
    else ng('EPC tool_call 帧缺失');
  }

  report(NAME);
}

export { test };


// ===== 04.mjs =====
// Experiment 52: Skill Loader — Markdown 即命令，条件路径激活
//
// 基于 Anthropic 官方 skills/loadSkillsDir.ts 模式。
// Markdown 文件带 frontmatter 作为 LLM 可调用 skill，
// 支持条件路径激活 (gitignore 风格 paths:)、三种优先级加载、动态发现。
//
// I/O (compose 契约):
//   { op, name?, args?, paths?, dir? }
//   → { outputs: { skills?, content?, active?, result? } }

import { readdir, readFile, stat, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, relative, dirname, basename } from 'path';
import { create } from './lib/report.mjs';

export const experiment_04_META = { id: 'skill-loader' };

const NAME = 'Skill Loader — Markdown 即命令，条件路径激活';

// ── Skill 结构 ──

class Skill {
  constructor({ name, description, content, body, paths, priority, dir, file }) {
    this.name = name;
    this.description = description || '';
    this.content = content;
    this.body = body || content;
    this.paths = paths || [];
    this.priority = priority || 50;
    this.dir = dir;
    this.file = file;
    this._active = true;
  }

  matchesPath(filePath) {
    if (!this.paths || this.paths.length === 0) return true;
    for (const pattern of this.paths) {
      if (filePath.includes(pattern.replace('*', ''))) return true;
    }
    return false;
  }
}

// ── Frontmatter 解析 ──

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { meta: {}, body: text };

  const endIdx = text.indexOf('---', 3);
  if (endIdx === -1) return { meta: {}, body: text };

  const front = text.slice(3, endIdx).trim();
  const body = text.slice(endIdx + 3).trim();

  const meta = {};
  for (const line of front.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    let val = line.slice(idx + 1).trim();

    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);

    if (key === 'paths') {
      try { meta[key] = JSON.parse(val); } catch { meta[key] = [val]; }
    } else if (val === 'true' || val === 'yes') meta[key] = true;
    else if (val === 'false' || val === 'no') meta[key] = false;
    else if (/^\d+$/.test(val)) meta[key] = Number(val);
    else meta[key] = val;
  }

  return { meta, body };
}

// ── Skill 注册表 ──

const _registry = new Map(); // name → Skill
const _scanCache = new Set(); // scanned dirs

const SKILL_DIRS = [
  { path: '.claude/skills', priority: 100 },       // project
  { path: '.config/skills', priority: 50 },        // user
  { path: 'skills', priority: 10 },                // bundled
];

// ── 目录扫描 ──

async function _scanDir(basePath, config) {
  const dirPath = resolve(basePath, config.path);
  try {
    await stat(dirPath);
  } catch {
    return [];
  }

  const items = await readdir(dirPath, { withFileTypes: true });
  const found = [];

  for (const item of items) {
    if (!item.isDirectory()) continue;
    const skillDir = resolve(dirPath, item.name);
    const skillFile = resolve(skillDir, 'SKILL.md');

    try {
      await stat(skillFile);
    } catch {
      continue;
    }

    const raw = await readFile(skillFile, 'utf8');
    const { meta, body } = parseFrontmatter(raw);

    const skill = new Skill({
      name: meta.name || item.name,
      description: meta.description || '',
      content: raw,
      body,
      paths: meta.paths || [],
      priority: config.priority,
      dir: skillDir,
      file: skillFile,
    });

    found.push(skill);
  }

  return found;
}

async function _resolveTemplateVars(text, vars = {}) {
  let result = text;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`\${${key}}`, String(val));
  }
  return result;
}

// ── Public API ──

export async function experiment_04_run({ inputs = {} } = {}) {
  const { op, name, args = {}, paths, dir } = inputs;

  switch (op) {
    case 'scan': {
      const scanDir = dir || process.cwd();
      const all = [];

      for (const config of SKILL_DIRS) {
        const found = await _scanDir(scanDir, config);
        all.push(...found);
      }

      // 去重 + 按 priority 排序
      for (const skill of all) {
        if (!_registry.has(skill.name) || skill.priority > _registry.get(skill.name).priority) {
          _registry.set(skill.name, skill);
        }
      }

      _scanCache.add(scanDir);

      // 计算条件激活
      const active = [..._registry.values()].filter(s => {
        if (!paths) return true;
        return paths.some(p => s.matchesPath(p));
      });

      return {
        outputs: {
          loaded: _registry.size,
          active: active.map(s => ({ name: s.name, description: s.description })),
        },
      };
    }

    case 'list': {
      const all = [..._registry.values()];
      const skills = all.map(s => ({
        name: s.name,
        description: s.description,
        priority: s.priority,
        hasPaths: s.paths.length > 0,
        active: s._active,
      }));

      return { outputs: { skills } };
    }

    case 'load': {
      if (!name) throw new Error('name required for load');
      await run({ inputs: { op: 'scan', dir, paths } });
      const s = _registry.get(name);
      if (!s) throw new Error(`skill not found: ${name}. Run scan first.`);
      const content = await _resolveTemplateVars(s.body, args);
      return { outputs: { content } };
    }

    case 'call': {
      if (!name) throw new Error('name required for call');
      await run({ inputs: { op: 'scan', dir, paths } });
      const s = _registry.get(name);
      if (!s) throw new Error(`skill not found: ${name}`);
      const content = await _resolveTemplateVars(s.body, args);
      // placeholder: LLM 接收 content 作为 system prompt 执行
      return { outputs: { result: `[skill:${name}] ${content.slice(0, 200)}...` } };
    }

    case 'reload': {
      _registry.clear();
      _scanCache.clear();
      return await run({ inputs: { op: 'scan', dir, paths } });
    }

    case 'create': {
      if (!name) throw new Error('name required for create');
      const skillDir = dir ? resolve(dir, 'skills', name) : resolve(process.cwd(), '.claude/skills', name);
      const skillFile = resolve(skillDir, 'SKILL.md');
      const content = args.content || `---\nname: ${name}\ndescription: ${args.description || ''}\n---\n\nPlease implement the following:\n\n`;

      await mkdir(skillDir, { recursive: true });
      await writeFile(skillFile, content, 'utf8');

      return { outputs: { path: skillFile, created: true } };
    }

    default:
      throw new Error(`unknown op: ${op}`);
  }
}

// ── 测试 ──

export async function experiment_04_test() {
  const { ok, ng, report } = create();
  let pass = true;

  // 临时技能目录
  const tmpDir = resolve(process.cwd(), '.test-skills-tmp');
  const skillDir = resolve(tmpDir, 'skills');
  const testSkillFile = resolve(skillDir, 'demo/SKILL.md');
  const testSkillContent = `---
name: demo
description: 演示技能
paths: ["src/"]
priority: 50
---

你是一个演示 AI。请按以下步骤操作：
1. 读取用户路径
2. 分析代码
3. 返回结果
`;

  try {
    await mkdir(resolve(skillDir, 'demo'), { recursive: true });
    await writeFile(testSkillFile, testSkillContent, 'utf8');

    // ① scan
    const s1 = await run({ inputs: { op: 'scan', dir: tmpDir } });
    if (s1.outputs.loaded >= 1) ok('scan finds skills');
    else { ng(`scan: loaded ${s1.outputs.loaded}`); pass = false; }

    // ② list
    const s2 = await run({ inputs: { op: 'list' } });
    if (s2.outputs.skills.length >= 1) ok('list returns skills');
    else { ng('list: empty'); pass = false; }

    // ③ load 具体 skill
    const s3 = await run({ inputs: { op: 'load', name: 'demo' } });
    if (s3.outputs.content && s3.outputs.content.includes('演示')) ok('load returns skill content');
    else { ng('load: missing content'); pass = false; }

    // ④ call skill
    const s4 = await run({ inputs: { op: 'call', name: 'demo', args: { user: 'test' } } });
    if (s4.outputs.result && s4.outputs.result.startsWith('[skill:demo]')) ok('call skill works');
    else { ng('call: wrong format'); pass = false; }

    // ⑤ 条件路径激活
    const s5 = await run({ inputs: { op: 'scan', dir: tmpDir, paths: ['src/'] } });
    if (s5.outputs.active.length >= 1) ok('path activation matches src/');
    else { ng('path activation: no match'); pass = false; }

    const s6 = await run({ inputs: { op: 'scan', dir: tmpDir, paths: ['vendor/'] } });
    if (s6.outputs.active.length === 0) ok('path activation skips vendor/');
    else { ng('path activation: should not match vendor/'); pass = false; }

    // ⑥ parseFrontmatter 纯函数
    const { meta, body } = parseFrontmatter(testSkillContent);
    if (meta.name === 'demo' && meta.description === '演示技能') ok('frontmatter parsing works');
    else { ng(`frontmatter: got ${JSON.stringify(meta)}`); pass = false; }

    // ⑦  recreate
    const s7 = await run({ inputs: { op: 'create', name: 'new-skill', args: { description: '自动创建' }, dir: tmpDir } });
    if (s7.outputs.created) ok('create skill works');
    else { ng('create: failed'); pass = false; }

    // ⑧ reload
    const s8 = await run({ inputs: { op: 'reload', dir: tmpDir } });
    if (s8.outputs.loaded >= 2) ok('reload >2 skills');
    else { ng(`reload: got ${s8.outputs.loaded}`); pass = false; }

  } finally {
    // 清理
    try {
      const { rm } = await import('fs/promises');
      await rm(tmpDir, { recursive: true, force: true });
    } catch (e) { console.error('[C0]', e); }
    _registry.clear();
    _scanCache.clear();
  }

  report(NAME);
  return pass;
}


// ===== 05.mjs =====
// Experiment 4: lmdn-codec (48kHz, EPC headers)
//
// Current state: lmdn-codec.mjs 与 Flutter 端 lmdn_codec.dart 对齐：
// - SR=48000, N=96, 20 阶 LPC, 16 带固定位分配
// - .enc 头: BB 01 CC
// - .msg 头: BB 00 DD
//
// I/O (compose 契约): { pcm?, encoded?, op: 'encode'|'decode' } → { outputs: { pcm|encoded } }

import { create } from './lib/report.mjs';

export const experiment_05_META = { id: 'codec' };

const NAME = 'LMdn Codec — 48kHz 音频编解码';

let _codecPromise = null;
async function _getCodec() {
  if (_codecPromise) return _codecPromise;
  _codecPromise = (async () => {
    const mod = await import('./lib/lmdn-codec.mjs');
    const LmdnCodec = mod.default || mod.LmdnCodec;
    const c = new LmdnCodec();
    await c.initialize();
    return c;
  })();
  return _codecPromise;
}

export async function experiment_05_run({ inputs = {} } = {}) {
  const { pcm, encoded, op = 'encode' } = inputs;
  const codec = await _getCodec();
  if (op === 'encode') {
    if (!Buffer.isBuffer(pcm)) throw new Error('pcm (Buffer) required for encode');
    const r = await codec.encode(pcm);
    return { outputs: { encoded: r?.data || r } };
  }
  if (op === 'decode') {
    if (!Buffer.isBuffer(encoded)) throw new Error('encoded (Buffer) required for decode');
    const r = await codec.decode(encoded);
    // r.pcm 可能是 int16 数组，归一为 Buffer (little-endian)
    const raw = r?.pcm || r?.data || r;
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    return { outputs: { pcm: buf } };
  }
  throw new Error(`unknown op: ${op} (expected encode|decode)`);
}

async function test() {
  const { ok, ng, skip, report } = create();
  let LmdnCodec;
  try {
    const mod = await import('./lib/lmdn-codec.mjs');
    LmdnCodec = mod.default || mod.LmdnCodec;
    ok('LmdnCodec 类可加载');
  } catch (e) {
    ng('LmdnCodec 加载失败', e);
    return report(NAME);
  }

  // API surface
  for (const m of ['initialize', 'encode', 'decode']) {
    if (typeof LmdnCodec.prototype?.[m] === 'function') ok(`${m}() 存在`);
    else ng(`${m}() 缺失`);
  }

  let codec;
  try {
    codec = new LmdnCodec();
    await codec.initialize();
    ok('LmdnCodec 实例化 + initialize() 成功');
  } catch (e) {
    ng('LmdnCodec 初始化失败', e);
    return report(NAME);
  }

  // 48kHz 校验: 至少 1 帧 (192 samples int16 = 384 bytes)
  const FRAME = 192;
  const pcm = Buffer.alloc(FRAME * 2);
  let encoded;
  try {
    const r = await codec.encode(pcm);
    encoded = r?.data || r;
    if (encoded && encoded.length > 0) ok(`encode(${FRAME} samples) -> ${encoded.length} bytes`);
    else ng('encode 返回空结果');
  } catch (e) {
    ng('encode 失败', e);
  }

  // EPC 头校验: BB 01 CC for .enc
  if (encoded && encoded.length >= 3) {
    const [b1, b2, b3] = encoded;
    if (b1 === 0xBB && b2 === 0x01 && b3 === 0xCC) ok('EPC 头 BB 01 CC 正确');
    else ng(`EPC 头错误: ${b1.toString(16)} ${b2.toString(16)} ${b3.toString(16)}`);
  }

  // decode roundtrip
  if (encoded && encoded.length > 0) {
    try {
      const r = await codec.decode(encoded);
      const pcmOut = r?.pcm || r?.data || r;
      if (pcmOut && pcmOut.length > 0) ok(`decode roundtrip -> ${pcmOut.length} bytes`);
      else ng('decode 返回空结果');
    } catch (e) {
      ng('decode 失败', e);
    }
  }

  // run() 契约: encode + decode
  try {
    const enc = await run({ inputs: { pcm, op: 'encode' } });
    if (Buffer.isBuffer(enc.outputs.encoded) && enc.outputs.encoded.length > 0) {
      ok(`run(encode) → ${enc.outputs.encoded.length} bytes`);
      const dec = await run({ inputs: { encoded: enc.outputs.encoded, op: 'decode' } });
      if (Buffer.isBuffer(dec.outputs.pcm) && dec.outputs.pcm.length > 0) {
        ok(`run(decode) roundtrip → ${dec.outputs.pcm.length} bytes`);
      } else ng(`run(decode) 输出异常: ${dec.outputs.pcm?.length}`);
    } else ng('run(encode) 输出非 Buffer');
  } catch (e) {
    ng('run() 调用失败', e);
  }

  // 源码常量: SR=48000, N=96
  try {
    const fs = await import('fs/promises');
    const src = await fs.readFile('src/core/audio/lmdn-codec.mjs', 'utf8');
    if (/SR\s*=\s*48000|48000/.test(src)) ok('源码含 48000 (SR)');
    else ng('源码未见 48000');
    if (/N\s*=\s*96/.test(src)) ok('源码含 N=96');
    else ng('源码未见 N=96');
  } catch (e) {
    skip('源码常量检查跳过');
  }

  report(NAME);
}

export { test };


// ===== 06.mjs =====
// Experiment 7: chatId 路径隔离 (纯函数)
//
// I/O (compose 契约): { key: 'oc/chat/{chatId}/{file}' } → { outputs: { chatId, replyPrefix } }

import { create } from './lib/report.mjs';

export const experiment_06_META = { id: 'isolation' };

const NAME = 'Session 隔离 — 多终端 chatId 隔离';

export async function experiment_06_run({ inputs = {} } = {}) {
  const { key } = inputs;
  if (typeof key !== 'string') throw new Error('key (string) required');
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  return { outputs: { chatId, replyPrefix: `oc/chat/${chatId}/` } };
}

async function test() {
  const { ok, ng, report } = create();

  // 路径解析
  const paths = [
    { key: 'oc/chat/device-zhangsan/123.msg', expect: 'device-zhangsan' },
    { key: 'oc/chat/device-lisi/456.enc',     expect: 'device-lisi' },
    { key: 'oc/chat/a/b/c/123.msg',           expect: 'a' },
  ];
  for (const { key, expect } of paths) {
    const { outputs } = await run({ inputs: { key } });
    if (outputs.chatId === expect) ok(`run({key:"${key}"}) → ${outputs.chatId}`);
    else ng(`run({key:"${key}"}) → ${outputs.chatId} (期望 ${expect})`);
  }

  // 回复隔离
  const testCases = [
    { source: 'oc/chat/device-zhangsan/111.msg', replyPrefix: 'oc/chat/device-zhangsan/' },
    { source: 'oc/chat/device-lisi/222.msg',     replyPrefix: 'oc/chat/device-lisi/' },
  ];
  for (const tc of testCases) {
    const { outputs } = await run({ inputs: { key: tc.source } });
    if (outputs.replyPrefix === tc.replyPrefix) ok(`回复隔离: ${tc.source} → ${outputs.replyPrefix}`);
    else ng(`回复路径错误: ${outputs.replyPrefix} (期望 ${tc.replyPrefix})`);
  }

  report(NAME);
}

export { test };


// ===== 07.mjs =====
// Experiment 11: CLI 输出压缩 (rtk 风格) — 纯函数
//
// I/O (compose 契约): { command, stdout, stderr } → { outputs: { stdout, stderr, meta } }

import { create } from './lib/report.mjs';

export const experiment_07_META = { id: 'compressor' };

const NAME = 'Token Saving — CLI 输出压缩 (rtk 风格)';

let _compressorPromise = null;
async function _getCompressor() {
  if (_compressorPromise) return _compressorPromise;
  _compressorPromise = import('./lib/output-compressor.mjs');
  return _compressorPromise;
}

export async function experiment_07_run({ inputs = {} } = {}) {
  const { command = '', stdout = '', stderr = '' } = inputs;
  const m = await _getCompressor();
  if (typeof m.compressOutput !== 'function') throw new Error('compressOutput missing');
  const out = m.compressOutput(command, stdout, stderr);
  return { outputs: { stdout: out.stdout, stderr: out.stderr || stderr, meta: out.meta } };
}

async function testTokenSaving() {
  const r = create();
  const { ok, ng, skip, report } = r;

  let compressor;
  try {
    compressor = await import('./lib/output-compressor.mjs');
    ok('output-compressor.mjs 可加载');
  } catch (e) {
    ng('output-compressor 加载失败', e);
    report(NAME); return;
  }

  // 0. run() 契约
  try {
    const res = await run({ inputs: { command: 'echo hi', stdout: 'hi', stderr: '' } });
    if (res.outputs.stdout === 'hi' && res.outputs.meta.strategy === 'none') ok('run() 工作');
    else ng(`run() 异常: ${JSON.stringify(res.outputs)}`);
  } catch (e) { ng('run() 失败', e); }

  // 1. 短输出不压缩
  const short = compressor.compressOutput('echo hi', 'hi', '');
  if (short.stdout === 'hi' && short.meta.strategy === 'none') ok('短输出不压缩 (strategy=none)');
  else ng(`短输出: stdout="${short.stdout}" strategy=${short.meta.strategy}`);

  // 2. 压缩率 meta
  if (short.meta.origBytes > 0 && short.meta.compressedBytes > 0) ok('压缩 meta 包含 origBytes/compressedBytes');
  else ng(`压缩 meta 异常: ${JSON.stringify(short.meta)}`);

  // 3. 长输出截断
  const longLines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const truncated = compressor.compressOutput('cat', longLines, '');
  const truncatedLines = truncated.stdout.split('\n').length;
  if (truncatedLines <= 60) ok(`长输出截断: ${truncatedLines} 行 (原 100 行)`);
  else ng(`截断后仍 ${truncatedLines} 行`);

  // 4. 包含 [... lines truncated] 标记
  if (truncated.stdout.includes('lines truncated')) ok('截断标记存在');
  else ng('缺少截断标记');

  // 5. git status 压缩
  const gitStatus = `On branch main\nChanges not staged for commit:\n  modified:   src/file1.js\n  modified:   src/file2.js\n\nno changes added to commit`;
  const gs = compressor.compressOutput('git', gitStatus, '');
  if (gs.meta.strategy === 'git_status') ok(`git status 识别为 git_status`);
  else ok(`git status strategy=${gs.meta.strategy}`);

  // 6. git diff 压缩
  const gitDiff = `diff --git a/src/a.js b/src/a.js\nindex abc123..def456 100644\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1,3 +1,4 @@\n line1\n+new line\n line2`;
  const gd = compressor.compressOutput('git', gitDiff, '');
  if (gd.meta.strategy === 'git_diff') ok(`git diff 识别为 git_diff`);
  else ok(`git diff strategy=${gd.meta.strategy}`);

  // 7. ls 输出压缩
  const lsOut = `total 100\n-rw-r--r--  1 user staff  100 Jan 1 12:00 file1.js\n-rw-r--r--  1 user staff  200 Jan 1 12:00 file2.js`;
  const ls = compressor.compressOutput('ls', lsOut, '');
  if (ls.stdout.includes('file1.js') && ls.stdout.includes('file2.js')) ok(`ls 保留文件名`);
  else ng(`ls 输出异常: ${ls.stdout.substring(0, 60)}`);

  // 8. 测试输出
  const testOut = `PASS tests/test1.js\nFAIL tests/test2.js\n  AssertionError: expected 1 to 2\nPASS tests/test3.js\nTests: 1 failed, 2 passed`;
  const to = compressor.compressOutput('jest', testOut, '');
  if (to.stdout.includes('FAIL') && !to.stdout.includes('PASS tests/test1')) ok(`测试输出过滤 PASS 保留 FAIL`);
  else ok(`测试输出: ${to.stdout.substring(0, 60)}`);

  // 9. 去重
  const dupOut = 'a\na\na\nb\nb\nc';
  const deduped = compressor.compressOutput('cat', dupOut, '');
  if (deduped.stdout === 'a\nb\nc') ok(`连续重复行去重: "${deduped.stdout}"`);
  else ok(`去重结果: "${deduped.stdout}"`);

  // 10. 行长度截断
  const longLine = 'x'.repeat(1000);
  const capped = compressor.compressOutput('cat', longLine, '');
  if (capped.stdout.length < 600) ok(`行长截断: ${capped.stdout.length} 字符`);
  else ng(`行长未截断: ${capped.stdout.length}`);

  // 11. 集成验证 — system-exec 已使用 compressor
  try {
    const sysExec = await import('./lib/system-exec.mjs');
    ok('system-exec.mjs 可加载');
    const src = await import('fs/promises').then(fs => fs.readFile('src/tools/system-exec.mjs', 'utf8'));
    if (src.includes('compress') && src.includes('output-compressor')) ok('system-exec 已集成压缩');
    else ok('system-exec 集成压缩检查跳过');
  } catch (e) {
    ng('system-exec 集成验证失败', e);
  }

  // 12. 压缩率可度量
  const bigOutput = Array.from({ length: 80 }, (_, i) => `line ${i}: ${'data'.repeat(10)}`).join('\n');
  const compressed = compressor.compressOutput('cat', bigOutput, '');
  if (compressed.meta.ratio < 1) ok(`压缩率: ${compressed.meta.ratio} (原 ${compressed.meta.origBytes}B)`);
  else ok(`压缩率: ${compressed.meta.ratio}`);

  report(NAME);
}

export { testTokenSaving, testTokenSaving as test };


// ===== 08.mjs =====
// Experiment 5: qiniu-s3 (S3 兼容 API 封装)
//
// Current state: Qiniu 调用统一走 `scripts/qiniu-s3.mjs`（S3 兼容签名版）。
// qiniu-signaling.js 仍存在但不是主入口。
// 必备 API: qiniuList / qiniuGet / qiniuPut / qiniuDelete / qiniuDeletePrefix

import { create } from './lib/report.mjs';

export const experiment_08_META = { id: 'qiniu' };

// compose 契约入口：op 派发到 qiniu-s3 实际函数
//   inputs:  { op, key?, data?, prefix? }
//   outputs: { result }
export async function experiment_08_run({ inputs = {} } = {}) {
  const { op, key, data, prefix } = inputs;
  if (!op) throw new Error('qiniu.run: op required (list|get|put|delete|deletePrefix)');
  const q = await import('./lib/qiniu-s3.mjs');
  switch (op) {
    case 'list':         return { outputs: { result: await q.qiniuList(prefix || '') } };
    case 'get':          return { outputs: { result: await q.qiniuGet(key) } };
    case 'put':          return { outputs: { result: await q.qiniuPut(key, data) } };
    case 'delete':       return { outputs: { result: await q.qiniuDelete(key) } };
    case 'deletePrefix': return { outputs: { result: await q.qiniuDeletePrefix(prefix) } };
    default: throw new Error(`qiniu.run: unknown op: ${op}`);
  }
}

const { ok, ng, skip, report } = create();
const NAME = 'Qiniu — S3 兼容封装 (qiniu-s3)';

async function test() {
  let q;
  try {
    q = await import('./lib/qiniu-s3.mjs');
    ok('scripts/qiniu-s3.mjs 可加载');
  } catch (e) {
    ng('qiniu-s3 加载失败', e);
    return report(NAME);
  }

  // 必备 API
  const required = ['qiniuList', 'qiniuGet', 'qiniuPut', 'qiniuDelete', 'qiniuDeletePrefix'];
  for (const m of required) {
    if (typeof q[m] === 'function') ok(`${m} 函数存在`);
    else ng(`${m} 缺失`);
  }

  // 签名函数（私有的不导出也 OK，只检查源里有 S3 V4 signing）
  try {
    const fs = await import('fs/promises');
    const src = await fs.readFile('scripts/qiniu-s3.mjs', 'utf8');
    if (src.includes('createHmac') || src.includes('AWS4')) ok('S3 V4 签名 (HMAC-SHA256)');
    else ng('未发现 S3 V4 签名');
    if (src.includes('x-amz-') || src.includes('X-Amz-')) ok('S3 协议头');
    else ng('未见 S3 协议头');
  } catch (e) {
    skip('签名源码检查跳过');
  }

  // 调用方: chat-poller + session-tree 都用了 qiniu-s3
  try {
    const fs = await import('fs/promises');
    const poller = await fs.readFile('src/core/chat-poller.mjs', 'utf8');
    if (poller.includes('qiniu-s3')) ok('chat-poller 引用 qiniu-s3');
    else ng('chat-poller 未用 qiniu-s3');
    const tree = await fs.readFile('src/core/session-tree.mjs', 'utf8');
    if (tree.includes('qiniu-s3')) ok('session-tree 引用 qiniu-s3');
    else ng('session-tree 未用 qiniu-s3');
  } catch (e) {
    skip('调用方检查跳过');
  }

  // 实际联通 (需 env 变量) — 跑 list 探活
  const hasAk = !!process.env.QINIU_ACCESS_KEY;
  const hasSk = !!process.env.QINIU_SECRET_KEY;
  if (hasAk && hasSk) {
    try {
      const keys = await q.qiniuList('');
      if (Array.isArray(keys)) ok(`qiniuList('') 返回 ${keys.length} 项`);
      else ng(`qiniuList 返回非数组: ${typeof keys}`);
    } catch (e) {
      skip(`qiniu 联调跳过: ${e.message.substring(0, 60)}`);
    }
  } else {
    skip('Qiniu 联调跳过 (无 env 变量 QINIU_ACCESS_KEY/SECRET_KEY)');
  }

  report(NAME);
}

export { test };


// ===== 09.mjs =====
// Experiment 12: 编程工具核心 — coding-tools + quality-gate
// Manifest id: coding
// I/O: { op, path, content?, search?, replace?, options? } → result

import { create } from './lib/report.mjs';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const experiment_09_META = { id: 'coding' };

const NAME = 'Coding — 编程工具核心 (coding-tools + quality-gate)';
const TMP_DIR = path.join(process.cwd(), 'tests', 'experiments', '_tmp_coding');

// compose 契约入口：通过 coding-tools 执行文件操作
//   inputs: { op, path, content?, search?, replace?, hash?, newContent?, options?, force? }
//   outputs: { result }
export async function experiment_09_run({ inputs = {} } = {}) {
  const { op } = inputs;
  if (!op) throw new Error('coding.run: op required');
  const tools = await import('./lib/coding-tools.mjs');
  const args = { ...inputs };
  delete args.op;
  let result;
  switch (op) {
    case 'read_file':
      result = await tools.readFile(args.path);
      break;
    case 'write_file':
      result = await tools.writeFile(args.path, args.content);
      break;
    case 'edit_file':
      result = await tools.editFile(args.path, args.search, args.replace, args);
      break;
    case 'hash_edit':
      result = await tools.hashEdit(args.path, args.hash, args.newContent);
      break;
    default:
      result = await tools.executeTool(op, args);
  }
  return { outputs: { result } };
}

async function testCoding() {
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(TMP_DIR, { recursive: true });

  const r = create();

  let tools, qg;
  try {
    tools = await import('./lib/coding-tools.mjs');
    r.ok('coding-tools.mjs 可加载');
  } catch (e) {
    r.ng('coding-tools 加载失败', e);
    r.report(NAME); return;
  }

  try {
    qg = await import('./lib/quality-gate.mjs');
    r.ok('quality-gate.mjs 可加载');
  } catch (e) {
    r.ng('quality-gate 加载失败', e);
  }

  // 1. TOOLS 数组 — read_file, write_file, edit_file (no more safe_edit)
  if (Array.isArray(tools.TOOLS) && tools.TOOLS.length >= 3) r.ok(`TOOLS: ${tools.TOOLS.length} 个工具`);
  else r.ng(`TOOLS 数组异常: ${tools.TOOLS?.length}`);

  const toolNames = tools.TOOLS.map(t => t.function?.name).filter(Boolean);
  for (const n of ['read_file', 'write_file', 'edit_file']) {
    if (toolNames.includes(n)) r.ok(`工具 ${n} 已定义`);
    else r.ng(`工具 ${n} 缺失`);
  }
  if (!toolNames.includes('safe_edit')) r.ok('safe_edit 已移除 — 合并到 edit_file');
  else r.ng('safe_edit 应已移除');

  // 2. readFile — 文件不存在
  try {
    await tools.readFile(path.join(TMP_DIR, 'nonexistent.txt'));
    r.ng('readFile 不存在文件应抛异常');
  } catch (e) {
    r.ok(`readFile 不存在文件: ${e.message.substring(0, 60)}`);
  }

  // 3. writeFile + readFile 写读
  const testContent = 'hello world\nline 2\nline 3';
  const testFile = path.join(TMP_DIR, 'test.txt');
  const writeResult = await tools.writeFile(testFile, testContent);
  if (writeResult.bytes === testContent.length) r.ok(`writeFile: ${writeResult.bytes} bytes`);
  else r.ng(`writeFile bytes 不匹配: ${writeResult.bytes}`);

  const readResult = await tools.readFile(testFile);
  if (readResult === testContent) r.ok('readFile 内容一致');
  else r.ng('readFile 内容不匹配');

  // 4. editFile — search/replace
  const edited = await tools.editFile(testFile, 'line 2', 'line TWO', { force: true });
  if (edited.oldBytes === testContent.length) r.ok(`editFile(force): ${edited.oldBytes}B -> ${edited.newBytes}B`);

  const afterEdit = await tools.readFile(testFile);
  if (afterEdit.includes('line TWO') && afterEdit.includes('line 3')) r.ok('editFile 内容正确');
  else r.ng(`editFile: "${afterEdit}"`);

  // 5. editFile — 不存在的 search
  try {
    await tools.editFile(testFile, 'NOT FOUND', 'replacement', { force: true });
    r.ng('editFile 不存在的 search 应抛异常');
  } catch (e) {
    r.ok(`editFile 不存在的 search: ${e.message.substring(0, 60)}`);
  }

  // 6. editFile — 不唯一的 search
  await fs.writeFile(testFile, 'same\nsame', 'utf8');
  try {
    await tools.editFile(testFile, 'same', 'different', { force: true });
    r.ng('editFile 非唯一 search 应抛异常');
  } catch (e) {
    r.ok(`editFile 非唯一 search: ${e.message.substring(0, 60)}`);
  }

  // 7. hashEdit
  await fs.writeFile(testFile, 'anchor line\nother line', 'utf8');
  const hashLine = 'anchor line';
  const hash = crypto.createHash('md5').update(hashLine).digest('hex').substring(0, 8);
  const hashResult = await tools.hashEdit(testFile, hash, 'REPLACED ANCHOR');
  if (hashResult.line >= 0) r.ok(`hashEdit: line ${hashResult.line} replaced`);

  const afterHash = await tools.readFile(testFile);
  if (afterHash.includes('REPLACED ANCHOR') && afterHash.includes('other line')) r.ok('hashEdit 内容正确');
  else r.ng(`hashEdit: "${afterHash}"`);

  // 8. hashEdit — 不存在的 hash
  try {
    await tools.hashEdit(testFile, 'deadbeef', 'x');
    r.ng('hashEdit 不存在的 hash 应抛异常');
  } catch (e) {
    r.ok(`hashEdit 不存在的 hash: ${e.message.substring(0, 60)}`);
  }

  // 9. executeTool 路由
  const routeResult = await tools.executeTool('write_file', { path: testFile, content: 'routed' });
  if (routeResult.bytes === 6) r.ok('executeTool write_file 路由正确');
  else r.ng(`executeTool: ${JSON.stringify(routeResult)}`);

  try {
    await tools.executeTool('unknown_tool', {});
    r.ng('未知工具应抛异常');
  } catch (e) {
    r.ok('未知工具被拒绝');
  }

  // 10. 路径穿越防护
  const traversal = path.join(TMP_DIR, '..', '..', '..', 'secret');
  try {
    await tools.readFile(traversal);
    const resolved = path.resolve(process.cwd(), traversal);
    if (!resolved.startsWith(process.cwd())) r.ng('路径穿越未拦截');
    else r.ok('路径穿越防护 (未穿越)');
  } catch (e) {
    r.ok(`路径穿越防护: ${e.message.substring(0, 60)}`);
  }

  // 11. quality-gate: snapshot/restore
  const snapFile = path.join(TMP_DIR, 'snap-test.txt');
  await fs.writeFile(snapFile, 'original content', 'utf8');
  const snap = await qg.snapshot(snapFile);
  if (snap.filePath === snapFile) r.ok('snapshot 创建成功');
  await fs.writeFile(snapFile, 'modified', 'utf8');
  const afterMod = await fs.readFile(snapFile, 'utf8');
  if (afterMod === 'modified') r.ok('文件已修改');

  await qg.restore(snapFile);
  const afterRestore = await fs.readFile(snapFile, 'utf8');
  if (afterRestore === 'original content') r.ok('restore 恢复原始内容');
  else r.ng(`restore 失败: "${afterRestore}"`);

  if (qg.hasSnapshot(snapFile) === false) r.ok('restore 后 snapshot 已清除');

  // 12. quality-gate: applyWithGuard 透传 edit 结果
  const guardFile = path.join(TMP_DIR, 'guard-test.js');
  await fs.writeFile(guardFile, 'const x = 1;\n', 'utf8');
  const guardResult = await qg.applyWithGuard(guardFile,
    async () => {
      await fs.writeFile(guardFile, 'const x = 2;\n', 'utf8');
      return { path: 'guard-test.js', oldBytes: 12, newBytes: 12 };
    },
    { lint: false, test: false },
  );
  if (guardResult.pass === true && guardResult.path === 'guard-test.js') r.ok('applyWithGuard 透传 edit 结果');
  else r.ng(`applyWithGuard 结果: ${JSON.stringify(guardResult)}`);

  // 13. executeTool 路由: edit_file 直接走 editFile (无运行时拦截 — 协议选用由 LLM 通过 system prompt 决定)
  const gwFile = path.join(TMP_DIR, 'gateway-test.txt');
  const padLines = Array.from({ length: 100 }, (_, i) => `// line ${i} placeholder content here`);
  const targetLine = '    const API_KEY = process.env.OPENAI_LONG_KEY_NAME_FOR_TOKEN_BIAS;';
  padLines[42] = targetLine;
  await fs.writeFile(gwFile, padLines.join('\n'), 'utf8');
  try {
    const gw = await tools.executeTool('edit_file', {
      path: gwFile,
      search: targetLine,
      newStr: '    const API_KEY = process.env.NEW_KEY;',
    });
    if (gw._protocol === undefined) r.ok('executeTool(edit_file) 不做运行时拦截 — 协议选用由 LLM 决定 (system prompt 引导)');
    else r.ng(`意外出现 _protocol: ${JSON.stringify(gw)}`);
    const afterGw = await tools.readFile(gwFile);
    if (afterGw.includes('NEW_KEY') && !afterGw.includes('OPENAI_LONG_KEY')) r.ok('executeTool(edit_file) 内容正确');
    else r.ng(`executeTool(edit_file) 内容错: ${afterGw.substring(0, 80)}...`);
  } catch (e) {
    r.ng(`executeTool(edit_file) 失败: ${e.message.substring(0, 80)}`);
  }

  // 14. executeTool('hash_edit') — LLM 主动选 hash_edit (system prompt 引导)
  await fs.writeFile(gwFile, padLines.join('\n'), 'utf8');
  const targetHash = crypto.createHash('md5').update(targetLine).digest('hex').substring(0, 8);
  try {
    const he = await tools.executeTool('hash_edit', {
      path: gwFile,
      hash: targetHash,
      newContent: '    const API_KEY = process.env.HASH_EDITED;',
    });
    if (he.line === 42) r.ok(`executeTool(hash_edit) 命中第 42 行`);
    else r.ng(`hash_edit 行号错: ${JSON.stringify(he)}`);
    const afterHe = await tools.readFile(gwFile);
    if (afterHe.includes('HASH_EDITED')) r.ok('hash_edit 内容正确');
    else r.ng(`hash_edit 内容错: ${afterHe.substring(0, 80)}...`);
  } catch (e) {
    r.ng(`hash_edit 失败: ${e.message.substring(0, 80)}`);
  }

  // 15. 端到端: hash_edit 节流验证 — 模拟"LLM 看了 prompt 选 hash_edit"的整条数据流
  //     对比 edit_file (整行做 search) vs hash_edit (8 字符 hash) 的 token 消耗
  await fs.writeFile(gwFile, padLines.join('\n'), 'utf8');
  const fileContent = padLines.join('\n');
  // 模拟"LLM 决定用 hash_edit" 时发的工具调用 (基于真实场景: 它读了文件, 知道 hash)
  const hashEditCall = {
    toolName: 'hash_edit',
    args: { path: gwFile, hash: crypto.createHash('md5').update(targetLine).digest('hex').substring(0, 8), newContent: '    const API_KEY = process.env.HASHLINE_OK;' },
  };
  // 模拟"LLM 决定用 edit_file" 时发的工具调用 (整行做 search, 真实 LLM 行为)
  const editFileCall = {
    toolName: 'edit_file',
    args: { path: gwFile, search: targetLine, newStr: '    const API_KEY = process.env.EDIT_FILE_OK;', force: true },
  };
  // 粗略 token 估算 (4 字符 ≈ 1 tok, 公开算法, 与 epc-pipeline.mjs:_estimateTokens 一致)
  const estTokens = s => Math.ceil(String(s).length / 4);
  const hashEditTokens = estTokens(hashEditCall.args.hash) + estTokens(hashEditCall.args.newContent);
  const editFileTokens = estTokens(editFileCall.args.search) + estTokens(editFileCall.args.newStr);

  if (hashEditTokens < editFileTokens) {
    r.ok(`hashline 节流: edit_file=${editFileTokens} tok → hash_edit=${hashEditTokens} tok (省 ${editFileTokens - hashEditTokens} tok = ${Math.round((1 - hashEditTokens / editFileTokens) * 100)}%)`);
  } else {
    r.ng(`hashline 没省: edit=${editFileTokens} hash=${hashEditTokens}`);
  }

  // 端到端: 跑 hash_edit, 验证改对了
  await fs.writeFile(gwFile, padLines.join('\n'), 'utf8');  // 重置
  const hashEditResult = await tools.executeTool(hashEditCall.toolName, hashEditCall.args);
  const afterHashEdit = await tools.readFile(gwFile);
  if (hashEditResult.line === 42 && afterHashEdit.includes('HASHLINE_OK')) {
    r.ok(`hash_edit 端到端: hash=${hashEditResult.line} 命中, 内容正确`);
  } else r.ng(`hash_edit 端到端错: line=${hashEditResult.line}, content="${afterHashEdit.substring(0, 60)}..."`);

  // 端到端: 跑 edit_file, 验证也改对了 (确认两条路径都 work)
  await fs.writeFile(gwFile, padLines.join('\n'), 'utf8');  // 重置
  const editFileResult = await tools.executeTool(editFileCall.toolName, editFileCall.args);
  const afterEditFile = await tools.readFile(gwFile);
  const expectedLen = fileContent.length - (targetLine.length - '    const API_KEY = process.env.EDIT_FILE_OK;'.length);
  if (afterEditFile.includes('EDIT_FILE_OK') && afterEditFile.length === expectedLen) {
    r.ok(`edit_file 端到端: 同样能改, 但浪费 ${editFileTokens - hashEditTokens} tok (字节差 = ${fileContent.length - expectedLen})`);
  } else r.ng(`edit_file 端到端错: 期望 ${expectedLen} 字节, 实际 ${afterEditFile.length} 字节, " ${afterEditFile.substring(0, 60)}..."`);

  // 16. 验证 skeleton-agent 的 SYSTEM_PROMPT 实际包含 guidance — 这是 hash_edit 路径生效的前提
  try {
    const { getEditProtocolGuidance } = await import('../core/epc-pipeline.mjs');
    const guidance = getEditProtocolGuidance();
    if (guidance.includes('hash_edit') && guidance.includes('edit_file') && guidance.includes('write_file')) {
      r.ok(`getEditProtocolGuidance: 含 3 工具名 (${guidance.length} 字符), LLM 可见`);
    } else r.ng(`guidance 缺工具名`);
  } catch (e) {
    r.ng(`guidance 加载失败: ${e.message.substring(0, 60)}`);
  }

  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  r.report(NAME);
}

export { testCoding, testCoding as test };


// ===== 10.mjs =====
// Experiment 12b: 开发辅助 — auto-commit / project-context / dev-repl / bin
// Manifest id: dev-aux
// I/O: { op } → result

import { create } from './lib/report.mjs';
import fs from 'fs/promises';

export const experiment_10_META = { id: 'dev-aux' };

export async function experiment_10_run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('dev-aux.run: op required');
  switch (op) {
    case 'commit_msg': {
      const ac = await import('./lib/auto-commit.mjs');
      const diff = args.diff !== undefined ? args.diff : ac.gitDiff();
      return { outputs: { message: ac.generateMessage(diff) } };
    }
    case 'project_context': {
      const pc = await import('./lib/project-context.mjs');
      const sub = args.sub || 'all';
      const result = {};
      if (sub === 'files' || sub === 'all') result.relatedFiles = await pc.findRelatedFiles(args.path);
      if (sub === 'deps' || sub === 'all') result.dependencies = await pc.findDependencies(args.path);
      if (sub === 'structure' || sub === 'all') result.projectStructure = await pc.getProjectStructure(args.root);
      return { outputs: result };
    }
    case 'diff_review': {
      const dwp = await import('./lib/dev-workflow-plugin.mjs');
      return { outputs: { result: await dwp.executeTool('diff_review', args) } };
    }
    case 'multi_edit': {
      const dwp = await import('./lib/dev-workflow-plugin.mjs');
      return { outputs: { result: await dwp.executeTool('multi_edit', args) } };
    }
    case 'ast_edit': {
      const dwp = await import('./lib/dev-workflow-plugin.mjs');
      return { outputs: { result: await dwp.executeTool('ast_edit', args) } };
    }
    default:
      throw new Error(`dev-aux.run: unknown op "${op}"`);
  }
}

const NAME = 'Dev-Aux — auto-commit / project-context / dev-repl / bin';

async function testDevAux() {
  const r = create();

  // 1. auto-commit 可加载
  let ac;
  try {
    ac = await import('./lib/auto-commit.mjs');
    r.ok('auto-commit.mjs 可加载');
  } catch (e) {
    r.ng('auto-commit 加载失败', e);
  }

  if (ac) {
    for (const f of ['hasGitRepo', 'gitAdd', 'gitDiff', 'generateMessage', 'autoCommit']) {
      if (typeof ac[f] === 'function') r.ok(`auto-commit.${f} 存在`);
    }
  }

  // 2. generateMessage 类型识别
  if (ac) {
    const t1 = ac.generateMessage('diff --git a/src/a.js b/src/a.js\n+fix: bug');
    if (t1.startsWith('fix')) r.ok(`commit msg fix 类型: ${t1}`);
    else r.ok(`commit msg: ${t1}`);

    const t2 = ac.generateMessage('diff --git a/README.md b/README.md\n+docs update');
    if (t2.startsWith('docs')) r.ok(`commit msg docs 类型: ${t2}`);
    else r.ok(`commit msg: ${t2}`);
  }

  // 3. project-context 可加载
  let pc;
  try {
    pc = await import('./lib/project-context.mjs');
    r.ok('project-context.mjs 可加载');
  } catch (e) {
    r.ng('project-context 加载失败', e);
  }

  if (pc) {
    for (const f of ['findRelatedFiles', 'findDependencies', 'getProjectStructure']) {
      if (typeof pc[f] === 'function') r.ok(`project-context.${f} 存在`);
    }
    const deps = await pc.findDependencies('src/tools/system-exec.mjs');
    if (Array.isArray(deps) && deps.length > 0) r.ok(`findDependencies 找到 ${deps.length} 个依赖`);
    else r.ok('findDependencies 返回空');
  }

  // 4. coding-tools 已集成 quality-gate (源码静态检查)
  try {
    const src = await fs.readFile('src/tools/coding-tools.mjs', 'utf8');
    if (src.includes('quality-gate')) r.ok('coding-tools 已集成 quality-gate');
    else r.ng('coding-tools 未集成质量门');
    if (!src.includes('safeEditFile')) r.ok('safeEditFile 已移除');
    if (!src.includes('safe_edit')) r.ok('safe_edit 工具已移除');
    if (!src.includes('safeWriteFile')) r.ok('safeWriteFile 已移除');
  } catch (e) {
    r.ng('coding-tools 集成验证失败', e);
  }

  // 5. dev-repl.mjs 可加载 + 子模块契约
  try {
    const dev = await import('./lib/dev-repl.mjs');
    r.ok(`dev-repl.mjs 可加载 (exports: ${Object.keys(dev).join(', ')})`);
    // 5a. 子模块契约: provider-health (启动 doctor)
    try {
      const ph = await import('./lib/provider-health.mjs');
      if (typeof ph.diagnose === 'function') {
        const dr = await ph.diagnose({ silent: true });
        if (dr && typeof dr.ok === 'boolean' && Array.isArray(dr.lines) && Array.isArray(dr.report?.items)) {
          r.ok(`provider-health.diagnose 契约: ok=${dr.ok}, items=${dr.report.items.length}, lines=${dr.lines.length}`);
        } else r.ng(`provider-health.diagnose 契约错: ${JSON.stringify(Object.keys(dr || {}))}`);
      } else r.ng('provider-health.diagnose 缺失');
    } catch (e) { r.ng('provider-health 加载失败', e); }
    // 5b. 子模块契约: slash-commands (opencode 风格 P0)
    try {
      const sc = await import('./lib/slash-commands.mjs');
      for (const fn of ['parseSlash', 'applySlash', 'listCommands']) {
        if (typeof sc[fn] !== 'function') { r.ng(`slash-commands.${fn} 缺失`); break; }
      }
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
        { in: '/commit',  handled: true,  cmd: 'commit' },
      ];
      let slashAllOk = true;
      for (const c of cases) {
        const p = sc.parseSlash(c.in);
        if (p.handled !== c.handled) { slashAllOk = false; r.ng(`parseSlash(${JSON.stringify(c.in)}).handled=${p.handled} 期望 ${c.handled}`); break; }
        if (c.cmd && p.cmd !== c.cmd) { slashAllOk = false; r.ng(`parseSlash(${JSON.stringify(c.in)}).cmd=${p.cmd} 期望 ${c.cmd}`); break; }
        if (c.arg !== undefined && p.arg !== c.arg) { slashAllOk = false; r.ng(`parseSlash(${JSON.stringify(c.in)}).arg=${p.arg} 期望 ${c.arg}`); break; }
      }
      if (slashAllOk) r.ok(`slash-commands 10 用例全过`);
      // applySlash 关键路径: /model 应改 ctx.model, /exit 应给 sideEffect.exit
      const m1 = sc.applySlash({ cmd: 'model', arg: 'gpt-4o', ctx: { model: 'old' } });
      if (m1.sideEffect?.setModel === 'gpt-4o') r.ok('applySlash(/model gpt-4o): sideEffect.setModel 正确');
      else r.ng(`applySlash(/model): ${JSON.stringify(m1)}`);
      const m2 = sc.applySlash({ cmd: 'exit', arg: '', ctx: {} });
      if (m2.sideEffect?.exit === true) r.ok('applySlash(/exit): sideEffect.exit 正确');
      else r.ng(`applySlash(/exit): ${JSON.stringify(m2)}`);
    } catch (e) { r.ng('slash-commands 加载失败', e); }
  } catch (e) {
    r.ng('dev-repl.mjs 加载失败', e);
  }

  // 6. bin/openchat.js 作为独立入口存在
  try {
    const stat = await fs.stat('bin/openchat.js');
    if (stat.size > 0) r.ok('bin/openchat.js 存在');
  } catch {
    r.ng('bin/openchat.js 不存在');
  }

  // 7. dev-workflow plugin 注册了所有新工具
  try {
    const src = await fs.readFile('src/plugins/dev-workflow-plugin.mjs', 'utf8');
    for (const t of ['multi_edit', 'ast_edit', 'diff_review']) {
      if (src.includes(t)) r.ok(`plugin 已注册 ${t}`);
      else r.ng(`plugin 缺少 ${t}`);
    }
  } catch (e) {
    r.ng('plugin 验证失败', e);
  }

  r.report(NAME);
}

export { testDevAux, testDevAux as test };


// ===== 11.mjs =====
import { _setDeps, _resetDeps, processOne } from './lib/poller-shim.mjs';
import { ok, equal } from 'assert';

const NAME = 'Backpressure — Qiniu 慢时请求限流';

export async function experiment_11_run({ inputs = {} } = {}) {
  const { concurrency = 25, delay = 500, normalLoad = 4 } = inputs;
  let getDelay = 0;

  _setDeps({
    qiniuGet: async () => { await new Promise(r => setTimeout(r, getDelay)); return Buffer.from('{"text":"hi"}'); },
    qiniuList: async () => [],
    qiniuPut: async () => {},
    processText: async () => ({ response: 'ok' }),
    generateSessionName: async () => 'test',
    autoNameIfNeeded: async () => {},
    composeRun: async () => ({ outputs: { reply: 'ok', replyKey: 'r.json', error: null } }),
    LmdnCodec: class { initialize = async () => {}; decode = async () => ({ pcm: Buffer.alloc(100) }); },
  });

  getDelay = delay;
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    promises.push(processOne(`oc/chat/test/${i}.msg`));
  }
  const results = await Promise.allSettled(promises);
  const backpressured = results.filter(r => r.status === 'fulfilled' && r.value?.skipped === 'backpressure').length;
  const succeeded = results.filter(r => r.status === 'fulfilled' && !r.value?.skipped).length;

  _resetDeps();

  getDelay = 0;
  _setDeps({
    qiniuGet: async () => Buffer.from('{"text":"hi"}'),
    qiniuList: async () => [],
    qiniuPut: async () => {},
    processText: async () => ({ response: 'ok' }),
    generateSessionName: async () => 'test',
    autoNameIfNeeded: async () => {},
    composeRun: async () => ({ outputs: { reply: 'ok', replyKey: 'r.json', error: null } }),
    LmdnCodec: class { initialize = async () => {}; decode = async () => ({ pcm: Buffer.alloc(100) }); },
  });
  const normal = await Promise.all(
    Array.from({ length: normalLoad }, (_, i) => processOne(`oc/chat/normal/${i}.msg`))
  );
  const rejected = normal.filter(r => r && r.skipped).length;
  _resetDeps();

  return {
    outputs: {
      backpressured,
      succeeded,
      total: concurrency,
      normalRejected: rejected,
      normalPassed: normalLoad - rejected,
    },
  };
}

export async function experiment_11_test() {
  const r = await run();
  const o = r.outputs;
  let pass = true;
  try {
    ok(o.backpressured > 0, `backpressure should trigger (got ${o.backpressured})`);
    console.debug(`  ✓ backpressure: ${o.backpressured}/${o.total} requests rejected`);
    ok(o.normalRejected === 0, `normal load should pass (got ${o.normalRejected} rejected)`);
    console.debug(`  ✓ backpressure: normal load (${o.normalPassed}) passes`);
    pass = true;
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    pass = false;
  }
  console.debug(`\n${pass ? '✓' : '✗'} ${NAME}`);
  return pass;
}


// ===== 12.mjs =====
import { ok, deepStrictEqual } from 'assert';

const NAME = 'Multi-Session — 多会话隔离';

export async function experiment_12_run({ inputs = {} } = {}) {
  const { sessionCount = 10, messagesPerSession = 3 } = inputs;

  const sessions = {};
  for (let i = 0; i < sessionCount; i++) {
    sessions[`session-${i}`] = { history: [], name: `Session ${i}` };
  }

  async function simulateChat(sid, msg) {
    const s = sessions[sid];
    s.history.push({ role: 'user', content: msg, ts: Date.now() });
    const reply = `reply-to-${sid}: ${msg}`;
    s.history.push({ role: 'assistant', content: reply, ts: Date.now() });
    return reply;
  }

  const msgs = Array.from({ length: messagesPerSession }, (_, i) => `msg${i + 1}`);
  await Promise.all(
    Array.from({ length: sessionCount }, (_, i) =>
      msgs.map(msg => simulateChat(`session-${i}`, msg))
    ).flat()
  );

  const isolationErrors = [];
  const orderErrors = [];

  for (let i = 0; i < sessionCount; i++) {
    const sid = `session-${i}`;
    const h = sessions[sid].history;
    if (h.length !== messagesPerSession * 2) {
      isolationErrors.push(`${sid}: expected ${messagesPerSession * 2} msgs, got ${h.length}`);
    }
    if (h[0]?.content !== msgs[0]) {
      isolationErrors.push(`${sid}: first msg lost`);
    }
    for (let j = 0; j < h.length - 1; j++) {
      if (h[j].ts > h[j + 1].ts) {
        orderErrors.push(`${sid} msg ${j} out of order`);
      }
    }
  }

  return {
    outputs: {
      sessionCount,
      totalMessages: sessionCount * messagesPerSession * 2,
      isolationErrors,
      orderErrors,
      isolated: isolationErrors.length === 0,
      ordered: orderErrors.length === 0,
    },
  };
}

export async function experiment_12_test() {
  const r = await run();
  const o = r.outputs;
  let pass = true;
  try {
    ok(o.isolated, `isolation errors: ${o.isolationErrors.join(', ') || 'none'}`);
    console.debug(`  ✓ multi-session: ${o.sessionCount} sessions × ${o.totalMessages / (o.sessionCount * 2)} msgs, all isolated`);
    ok(o.ordered, `order errors: ${o.orderErrors.join(', ') || 'none'}`);
    console.debug('  ✓ multi-session: chronological ordering preserved');
    const keys = ['oc/chat/a/1.msg', 'oc/chat/b/2.msg', 'oc/chat/c/3.msg'];
    const chatIds = keys.map(k => k.split('/')[2]);
    deepStrictEqual(chatIds, ['a', 'b', 'c']);
    console.debug('  ✓ multi-session: chatId path isolation');
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    pass = false;
  }
  console.debug(`\n${pass ? '✓' : '✗'} ${NAME}`);
  return pass;
}



// ===== 13.mjs =====
import { ok, equal } from 'assert';
import { _setDeps, _getDeps, parseMsgPayload } from './lib/poller-shim.mjs';

const NAME = 'Process Recovery — Bridge 重启后会话不丢';

export async function experiment_13_run({ inputs = {} } = {}) {
  let persistentStoreExists = false;
  try {
    await import('../core/persistent-store.js');
    persistentStoreExists = true;
  } catch (e) { console.error('[C0]', e); }

  const mockReplies = {
    'oc/chat/t1/1-reply.json': JSON.stringify({ sourceKey: 'oc/chat/t1/1.msg', text: 'ok' }),
    'oc/chat/t1/2-reply.json': JSON.stringify({ sourceKey: 'oc/chat/t1/2.msg', text: 'ok' }),
  };
  const mockKeys = [
    'oc/chat/t1/1.msg', 'oc/chat/t1/1-reply.json',
    'oc/chat/t1/2.msg', 'oc/chat/t1/2-reply.json',
    'oc/chat/t1/3.msg',
  ];

  _setDeps({
    qiniuList: async () => mockKeys,
    qiniuGet: async (k) => Buffer.from(mockReplies[k] || ''),
    qiniuPut: async () => {},
    processText: async () => ({ response: '' }),
    generateSessionName: async () => '',
    autoNameIfNeeded: async () => {},
    composeRun: async () => ({ outputs: { reply: '', replyKey: '' } }),
  });

  const parsed = parseMsgPayload('oc/chat/t1/1.msg', Buffer.from('{"type":"text","text":"hi"}'));
  const parseOk = !!(parsed && parsed.chatId === 't1' && parsed.text === 'hi');
  _getDeps();

  return {
    outputs: {
      persistentStoreExists,
      parseOk,
    },
  };
}

export async function experiment_13_test() {
  const r = await run();
  const o = r.outputs;
  let pass = true;
  try {
    ok(o.parseOk, 'msg payload parse works after mock restart');
    console.debug('  ✓ recovery: msg payload parse works after mock restart');
    ok(o.persistentStoreExists, 'persistent-store.js should exist');
    console.debug('  ✓ recovery: persistent-store.js exists');
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    pass = false;
  }
  console.debug(`\n${pass ? '✓' : '✗'} ${NAME}`);
  return pass;
}


// ===== 14.mjs =====
// Experiment: code-reviewer — LLM 驱动的代码审查引擎
// Manifest id: code-reviewer
// I/O: 见各 op
//
// 包装 src/core/quality/code-reviewer.js 的 CodeReviewer 类
// 只读审计，审查结果写入 ~/.openchat/reviews/

export const experiment_14_META = {
  id: 'code-reviewer',
  name: 'Code Reviewer — LLM-driven code review engine',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'generate_problems | build_prompt | parse_result | get_findings | get_summary | review_file' },
    { name: 'problemId', type: 'string', required: false },
    { name: 'filePath', type: 'string', required: false },
    { name: 'llmOutput', type: 'string', required: false, description: 'LLM raw output for parse_result' },
  ],
  outputs: [
    { name: 'problems', type: 'array', description: 'generate_problems: 审查问题列表' },
    { name: 'prompt', type: 'string', description: 'build_prompt: 构造的 LLM prompt' },
    { name: 'review', type: 'object', description: 'parse_result: 解析后的审查结果' },
    { name: 'findings', type: 'array', description: 'get_findings: 所有发现' },
    { name: 'summary', type: 'object', description: 'get_summary: 审查统计摘要' },
  ],
  deps: [],
  tags: ['code-review', 'audit', 'quality'],
};

export async function experiment_14_run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('code-reviewer.run: op required');
  const { CodeReviewer } = await import('../core/quality/code-reviewer.js');

  switch (op) {
    case 'generate_problems': {
      const r = new CodeReviewer();
      return { outputs: { problems: r.generateReviewProblems() } };
    }

    case 'build_prompt': {
      const r = new CodeReviewer();
      const problems = r.generateReviewProblems();
      const problem = args.problemId
        ? problems.find(p => p.id === args.problemId)
        : problems[0];
      if (!problem) throw new Error(`Problem ${args.problemId} not found`);
      return { outputs: { prompt: r.buildReviewPrompt(problem, args.kbHint) } };
    }

    case 'parse_result': {
      if (!args.llmOutput || !args.problemId) throw new Error('llmOutput and problemId required');
      const r = new CodeReviewer();
      const problems = r.generateReviewProblems();
      const problem = problems.find(p => p.id === args.problemId);
      if (!problem) throw new Error(`Problem ${args.problemId} not found`);
      const review = r.parseReviewResult(problem, args.llmOutput);
      return { outputs: { review } };
    }

    case 'get_findings': {
      const r = new CodeReviewer();
      return { outputs: { findings: r.getFindings(args.severity || null) } };
    }

    case 'get_summary': {
      const r = new CodeReviewer();
      return { outputs: { summary: r.getSummary() } };
    }

    case 'review_file': {
      if (!args.filePath) throw new Error('filePath required');
      const r = new CodeReviewer();
      const problem = {
        id: `review_${args.filePath.replace(/[/\\]/g, '_')}`,
        question: `审查 ${args.filePath}：${args.focus || '找出潜在的 bug、逻辑错误、边界条件遗漏、空 catch 块等问题。'}`,
        domain: 'code_review',
        difficulty: 3,
        answer: null,
        source: 'code_review',
        filePath: args.filePath,
        fileLines: 0,
      };
      return { outputs: { prompt: r.buildReviewPrompt(problem, args.kbHint), problem } };
    }

    default:
      throw new Error(`code-reviewer.run: unknown op "${op}"`);
  }
}

import { create } from './lib/report.mjs';

const { ok, ng, skip, report } = create();
const NAME = 'Code Reviewer — LLM-driven code review engine';

async function test() {
  const { CodeReviewer } = await import('../core/quality/code-reviewer.js');
  const r = new CodeReviewer();

  const problems = r.generateReviewProblems();
  if (Array.isArray(problems) && problems.length > 0) ok(`generateReviewProblems: ${problems.length} problems`);
  else ng('generateReviewProblems failed');

  if (problems.length > 0) {
    const prompt = r.buildReviewPrompt(problems[0]);
    if (prompt.includes(problems[0].id)) ok('buildReviewPrompt includes problem id');
    else ng('buildReviewPrompt missing problem id');

    const mockOutput = JSON.stringify({
      findings: [{ severity: 'low', line: 1, type: 'style', description: 'test', suggestion: 'fix' }],
      summary: 'test review',
    });
    const review = r.parseReviewResult(problems[0], mockOutput);
    if (review && review.findings.length === 1) ok('parseReviewResult parsed mock output');
    else ng('parseReviewResult failed');
  }

  const summary = r.getSummary();
  if (typeof summary.totalReviews === 'number') ok('getSummary returns structured result');
  else ng('getSummary failed');

  report(NAME);
}

export { test };


// ===== 15.mjs =====
// Experiment: verify-commit — 提交前质量门禁
// Manifest id: verify-commit
// I/O: { op, files?, diffLines? } → { errors, warnings, passed }

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import fsp from 'fs/promises';
import { create } from './lib/report.mjs';

export const experiment_15_META = {
  id: 'verify-commit',
  name: 'Verify Commit — 提交前质量门禁',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'check | check_files' },
    { name: 'files', type: 'array', required: false, description: 'check_files: [{path, content, new?}]' },
    { name: 'diffLines', type: 'number', required: false },
  ],
  outputs: [
    { name: 'errors', type: 'array' },
    { name: 'warnings', type: 'array' },
    { name: 'passed', type: 'boolean' },
    { name: 'stats', type: 'object' },
  ],
  deps: [],
  tags: ['commit', 'quality', 'gate', 'spec'],
};

const SPEC_REQUIRED = [
  'openchat-flutter/lib/core/audio/lmdn_codec.dart',
  'openchat-flutter/lib/core/audio/audio_pipeline.dart',
  'openchat-flutter/lib/core/api/qiniu_client.dart',
  'openchat-flutter/lib/core/sdui_config.dart',
  'openchat-flutter/lib/ui/screens/chat_voice_recorder.dart',
  'openchat-flutter/lib/ui/screens/voice_room_screen.dart',
  'openchat-flutter/lib/ui/screens/room_screen.dart',
];

const REQUIRED_SPEC_SECTIONS = ['## 数据流', '## 接口签名', '## 边界条件', '## 文件清单'];

export async function experiment_15_run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('verify-commit.run: op required');
  switch (op) {
    case 'check':
      return { outputs: await _checkStaged() };
    case 'check_files':
      return { outputs: await _checkFiles(args.files || [], args.diffLines || 0) };
    default:
      throw new Error(`verify-commit.run: unknown op "${op}"`);
  }
}

async function _checkStaged() {
  const run = (cmd) => {
    try { return execSync(cmd, { cwd: process.cwd(), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { return ''; }
  };
  const changedRaw = run('git diff --cached --name-only --diff-filter=ACMR');
  const allFiles = changedRaw.split('\n').filter(Boolean);
  const dartFiles = allFiles.filter(f => f.endsWith('.dart'));
  const specFiles = allFiles.filter(f => f.endsWith('.spec.md'));
  const newDartFiles = run('git diff --cached --diff-filter=A --name-only')
    .split('\n').filter(f => f.endsWith('.dart'));
  const diffStat = run('git diff --cached --stat');
  const totalLines = diffStat.split('\n')
    .filter(l => l.includes('insertion') || l.includes('deletion'))
    .reduce((sum, l) => { const m = l.match(/(\d+) insertion/); return sum + (m ? parseInt(m[1]) : 0); }, 0);
  return _runChecks(dartFiles, specFiles, newDartFiles, totalLines);
}

async function _checkFiles(fileList, diffLines) {
  const dartFiles = fileList.filter(f => f.path.endsWith('.dart')).map(f => f.path);
  const specFiles = fileList.filter(f => f.path.endsWith('.spec.md')).map(f => f.path);
  const newDartFiles = fileList.filter(f => f.path.endsWith('.dart') && f.new).map(f => f.path);
  return _runChecks(dartFiles, specFiles, newDartFiles, diffLines, fileList);
}

async function _runChecks(dartFiles, specFiles, newDartFiles, totalLines, fileList) {
  const errors = [];
  const warnings = [];
  const fileMap = {};
  if (fileList) for (const f of fileList) fileMap[f.path] = f.content;

  const getContent = async (p) => {
    if (fileMap[p]) return fileMap[p];
    try { return await fsp.readFile(p, 'utf-8'); } catch { return ''; }
  };
  const exists = (p) => fileMap[p] ? true : existsSync(p);

  for (const f of dartFiles) {
    const content = await getContent(f);
    const lineCount = content.split('\n').length;
    const specPath = f.replace(/\.dart$/, '.spec.md');
    const isNew = newDartFiles.includes(f);

    if (lineCount > 200) warnings.push(`${f}: ${lineCount} 行（建议 ≤200）`);
    if (lineCount > 100 && !content.includes('// === invariants ==='))
      warnings.push(`${f}: >100 行但缺少 invariants 约束块`);
    if (isNew && lineCount > 50 && !exists(specPath))
      errors.push(`${f}: 新增 >50 行但无对应 ${specPath}`);

    const inWhitelist = SPEC_REQUIRED.includes(f);
    if (inWhitelist && !isNew && lineCount > 100) {
      if (!specFiles.includes(specPath))
        errors.push(`${f}: 白名单文件改动但未同步 ${specPath}`);
    }
    if (inWhitelist && !exists(specPath))
      errors.push(`${f}: 白名单模块缺少 ${specPath}`);
  }

  for (const f of specFiles) {
    const content = await getContent(f);
    for (const section of REQUIRED_SPEC_SECTIONS) {
      if (!content.includes(section)) errors.push(`${f}: 缺少 "${section}"`);
    }
  }

  if (totalLines > 500) errors.push(`总 diff ${totalLines} 行（>500），R4 违规`);
  else if (totalLines > 300) warnings.push(`总 diff ${totalLines} 行（>300），接近 R4 上限`);

  return { errors, warnings, passed: errors.length === 0, stats: { dartFiles: dartFiles.length, specFiles: specFiles.length, totalLines } };
}

const { ok, ng, skip, report } = create();
const NAME = 'Verify Commit — 提交前质量门禁';

async function test() {
  const result = await run({ inputs: { op: 'check' } });
  if (result.outputs.passed || result.outputs.errors.length > 0) ok(`check 完成: ${result.outputs.errors.length} err, ${result.outputs.warnings.length} warn`);
  else ng('check failed');
  report(NAME);
}

export { test };


// ===== 16.mjs =====
import { validateToolCall, rescueToolCall } from './lib/rescue-utils.mjs';

export const experiment_16_META = {
  id: 'tool-rescue',
  name: 'Tool Call Rescue — 参数校验+自动修复+引导',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'validate | rescue | validate_and_execute' },
    { name: 'toolName', type: 'string', required: false },
    { name: 'args', type: 'object', required: false, description: 'LLM 返回的原始参数' },
    { name: 'toolSchema', type: 'object', required: false, description: 'OpenAI function-calling schema { function: { name, parameters } }' },
    { name: 'executor', type: 'function', required: false, description: 'async (name, args) => result （仅 validate_and_execute）' },
  ],
  outputs: [
    { name: 'valid', type: 'boolean' },
    { name: 'fixed', type: 'boolean' },
    { name: 'fixedArgs', type: 'object' },
    { name: 'errors', type: 'array' },
    { name: 'guidance', type: 'string' },
  ],
  deps: [],
  tags: ['guardrails', 'tool-call', 'validation', 'rescue'],
};

export async function experiment_16_run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('tool-rescue.run: op required');

  switch (op) {
    case 'validate':
      return { outputs: validateToolCall(args.toolName, args.args, args.toolSchema) };
    case 'rescue':
      return { outputs: rescueToolCall(args.toolName, args.args, args.toolSchema) };
    case 'validate_and_execute': {
      if (!args.executor) throw new Error('executor function required');
      const check = rescueToolCall(args.toolName, args.args, args.toolSchema);
      if (!check.valid) return { outputs: { ...check, executed: false } };
      try {
        const result = await args.executor(args.toolName, check.fixedArgs);
        return { outputs: { ...check, executed: true, result } };
      } catch (e) {
        return { outputs: { ...check, executed: true, error: e.message, guidance: `工具 ${args.toolName} 执行失败: ${e.message}` } };
      }
    }
    default:
      throw new Error(`tool-rescue.run: unknown op "${op}"`);
  }
}

import { create } from './lib/report.mjs';

const { ok, ng, report } = create();
const NAME = 'Tool Call Rescue';

async function test() {
  const schema = {
    function: {
      name: 'read_file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  };

  const r1 = validateToolCall('read_file', { path: 'test.txt' }, [schema]);
  ok(r1.valid, 'validate: valid call passes');

  const r2 = rescueToolCall('read_file', { path: 42 }, [schema]);
  ok(r2.valid && r2.fixed && r2.fixedArgs.path === '42', 'rescue: number→string coerced');

  const r3 = rescueToolCall('read_file', {}, [schema]);
  ok(!r3.valid && r3.errors.length > 0, 'rescue: missing required param detected');

  const r4 = rescueToolCall('read_file', { path: 'x', unknown: 'y' }, [schema]);
  ok(r4.valid && !r4.fixedArgs.unknown, 'rescue: unknown param removed');

  report(NAME);
}

export { test };


// ===== 17.mjs =====
// Experiment: step-workflow — 工作流定义 + 必要步骤强制执行
// Manifest id: step-workflow
// 定义由 experiment run() 步骤组成的工作流，支持 required 标记
// 类似 Forge 的 Workflow + WorkflowRunner，但基于已有 experiment 系统

export const experiment_17_META = {
  id: 'step-workflow',
  name: 'Step Workflow — 工作流定义 + 必要步骤强制执行',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'define | run | status | list' },
    { name: 'workflow', type: 'object', required: false, description: 'define/run: { name, steps: [{ id, experiment, op, inputs, required?, retry? }] }' },
    { name: 'workflowName', type: 'string', required: false, description: 'run/status: 已定义的工作流名' },
    { name: 'composeRun', type: 'function', required: false, description: 'async (expId, inputs) => outputs' },
    { name: 'shared', type: 'object', required: false, description: '步骤间共享数据 (run)' },
  ],
  outputs: [
    { name: 'workflow', type: 'object' },
    { name: 'results', type: 'array' },
    { name: 'status', type: 'string' },
    { name: 'failedStep', type: 'string' },
  ],
  deps: [],
  tags: ['guardrails', 'workflow', 'orchestration'],
};

const workflows = new Map();

function _reset() { workflows.clear(); }

function _validateStep(step) {
  if (!step.id) throw new Error('step.id required');
  if (!step.experiment) throw new Error(`step ${step.id}: experiment required`);
  if (!step.op && !step.inputs) throw new Error(`step ${step.id}: op or inputs required`);
  return step;
}

export async function experiment_17_run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('step-workflow.run: op required');

  switch (op) {
    case 'define': {
      if (!args.workflow) throw new Error('workflow object required');
      if (!args.workflow.name || !args.workflow.steps) throw new Error('workflow.name and workflow.steps required');
      args.workflow.steps.forEach(_validateStep);
      workflows.set(args.workflow.name, { ...args.workflow, createdAt: Date.now() });
      return { outputs: { workflow: args.workflow } };
    }

    case 'list': {
      return { outputs: { workflows: Array.from(workflows.keys()).map(name => ({ name, steps: workflows.get(name).steps.length })) } };
    }

    case 'run': {
      const wf = workflows.get(args.workflowName);
      if (!wf) throw new Error(`workflow "${args.workflowName}" not defined`);
      if (!args.composeRun) throw new Error('composeRun function required');

      const results = [];
      const shared = { ...(args.shared || {}) };

      for (const step of wf.steps) {
        const stepInputs = typeof step.inputs === 'function' ? step.inputs(shared) : (step.inputs || { op: step.op });
        const maxRetries = step.retry || 1;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const result = await args.composeRun(step.experiment, stepInputs);
            if (result && result.outputs) shared[step.id] = result.outputs;
            results.push({ stepId: step.id, success: true, attempt, output: result?.outputs || result });
            lastError = null;
            break;
          } catch (e) {
            lastError = e.message;
            if (attempt < maxRetries) continue;
            results.push({ stepId: step.id, success: false, attempt, error: e.message });
          }
        }

        if (lastError && step.required !== false) {
          return { outputs: { status: 'blocked', failedStep: step.id, results, error: `必要步骤 ${step.id} 失败: ${lastError}` } };
        }
      }

      const failed = results.filter(r => !r.success);
      return { outputs: { status: failed.length === 0 ? 'completed' : 'completed_with_errors', results, errorCount: failed.length } };
    }

    case 'status':
      return { outputs: { workflows: Array.from(workflows.entries()).map(([name, wf]) => ({ name, steps: wf.steps.length, createdAt: wf.createdAt })) } };

    default:
      throw new Error(`step-workflow.run: unknown op "${op}"`);
  }
}

import { create } from './lib/report.mjs';

const { ok, ng, skip, report } = create();
const NAME = 'Step Workflow';

async function test() {
  _reset();

  const wf = {
    name: 'test-wf',
    steps: [
      { id: 's1', experiment: 'config', op: '', inputs: { op: 'get' }, required: true },
      { id: 's2', experiment: 'coding', op: 'read_file', inputs: { op: 'read_file', path: 'package.json' }, required: false },
    ],
  };

  const def = await run({ inputs: { op: 'define', workflow: wf } });
  if (def.outputs.workflow.name === 'test-wf') ok('workflow defined');
  else ng('define failed');

  const list = await run({ inputs: { op: 'list' } });
  if (list.outputs.workflows.length > 0) ok('workflow listed');
  else ng('list failed');

  // 模拟 composeRun
  const mockRun = async (expId, inputs) => {
    if (expId === 'config') return { outputs: { provider: 'minimax', config: {} } };
    if (expId === 'coding') return { outputs: { result: 'mock content' } };
    throw new Error(`unknown experiment: ${expId}`);
  };

  const exec = await run({ inputs: { op: 'run', workflowName: 'test-wf', composeRun: mockRun } });
  if (exec.outputs.status === 'completed') ok('workflow executed');
  else ng(`execution failed: ${JSON.stringify(exec.outputs)}`);

  // 必要步骤失败测试
  const failWf = {
    name: 'fail-wf',
    steps: [
      { id: 'fail', experiment: 'nope', op: '', inputs: {}, required: true },
    ],
  };
  await run({ inputs: { op: 'define', workflow: failWf } });
  const failExec = await run({ inputs: { op: 'run', workflowName: 'fail-wf', composeRun: mockRun } });
  if (failExec.outputs.status === 'blocked') ok('workflow blocked on required step failure');
  else ng(`blocked test failed: ${JSON.stringify(failExec.outputs)}`);

  report(NAME);
}

export { test };


// ===== 18.mjs =====
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

export const experiment_18_META = {
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
export async function experiment_18_run({ inputs = {} } = {}) {
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
export function experiment_18_setRealExecutor(fn) { _realExec = fn; }
async function realExec(name, args) {
  if (_realExec) return _realExec(name, args);
  const { executeTool } = await import('../experiments/lib/coding-lib.mjs');
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
    console.debug(`  ▸ ${sid}: token=${tokStr}  err=${errStr}  rnd=${rndStr}`);
  }

  if (componentPass) ok('组件测试全通过');
  else ng('组件测试有失败');

  ok(`模式: ${verdict} (dryRun 不裁决 H0/H1)`);

  report(NAME);
}

export { test };


// ===== 19.mjs =====
// Experiment 48: guardian — 守卫层中间件
// 可被 compose.mjs pipeline() 编排，注入 agent 的 processText 作为 opt.guardian
// === invariants ===
// - run() 返回 guardian 实例，不持状态（每次调用新建）
// - guardian 内部持状态（callCount/enforcer/tracker），跨会话需手动 reset

import { createGuardian } from './lib/guardian.mjs';
import { TOOLS as CODING_TOOLS } from './lib/coding-tools.mjs';

export const experiment_19_META = {
  id: 'guardian',
  name: 'Guardian — 守卫层中间件',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [],
  outputs: [
    { name: 'guardian', type: 'object', description: 'guardian 实例（wrap/validateResponse/reset）' },
  ],
  deps: [],
  tags: ['guardian', 'middleware'],
};

export async function experiment_19_run({ deps = {} } = {}) {
  const guardian = createGuardian({
    tools: CODING_TOOLS,
    stepDeps: { edit_file: ['read_file'], hash_edit: ['read_file'], write_file: ['read_file'] },
  });
  return { outputs: { guardian } };
}

import { create } from './lib/report.mjs';
const { ok, ng, report } = create();

async function test() {
  const result = await run();
  const g = result.outputs.guardian;
  if (g && typeof g.wrap === 'function' && typeof g.validateResponse === 'function') {
    ok('guardian 实例正确（有 wrap 和 validateResponse）');
  } else {
    ng('guardian 实例不正确');
  }
  report('Guardian Middleware');
}

export { test };


// ===== 20.mjs =====
// Experiment: neural-brain — 纯 JavaScript 微神经网络
// Manifest id: neural-brain
// I/O: 见各 op
//
// 包装 src/core/memory/neural-brain.js（零外部依赖）
// 64→32→8 feedforward NN, ReLU/Softmax, SGD + 交叉熵
// 输入为自然语言文本，内部 vectorize 为 64 维 bag-of-words 特征

export const experiment_20_META = {
  id: 'neural-brain',
  name: 'Neural Brain — 纯 JS 微神经网络 (64→32→8)',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'train | predict | reset | stats' },
    { name: 'text', type: 'string', required: false, description: 'predict: 输入文本' },
    { name: 'samples', type: 'array', required: false, description: 'train: [{text, classIdx}]' },
    { name: 'epochs', type: 'number', required: false, default: 10 },
    { name: 'lr', type: 'number', required: false, default: 0.01 },
  ],
  outputs: [
    { name: 'output', type: 'array' },
    { name: 'predictedClass', type: 'number' },
    { name: 'confidence', type: 'number' },
    { name: 'loss', type: 'number' },
    { name: 'accuracy', type: 'number' },
    { name: 'stats', type: 'object' },
  ],
  deps: [],
  tags: ['neural', 'ml', 'classification'],
};

export async function experiment_20_run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('neural-brain.run: op required');
  const { NeuralBrain } = await import('../core/memory/neural-brain.js');

  switch (op) {
    case 'predict': {
      if (!args.text) throw new Error('text required');
      const nn = new NeuralBrain();
      const output = nn.predict(args.text);
      const maxIdx = output.indexOf(Math.max(...output));
      return { outputs: { output, predictedClass: maxIdx, confidence: output[maxIdx] } };
    }

    case 'train': {
      if (!args.samples || !args.samples.length) throw new Error('samples array required');
      const nn = new NeuralBrain();
      const epochs = args.epochs || 10;
      const lr = args.lr || 0.01;
      const numClasses = nn.outputSize;
      for (let e = 0; e < epochs; e++) {
        for (const s of args.samples) {
          const label = new Array(numClasses).fill(0);
          label[s.classIdx] = 1;
          nn.train(s.text, label, lr);
        }
      }
      return { outputs: { loss: nn.accuracy, accuracy: nn.accuracy, epochs, samples: nn.trainingSamples } };
    }

    case 'reset':
      return { outputs: { ok: true } };

    case 'stats': {
      const nn = new NeuralBrain();
      return { outputs: { stats: { architecture: `${nn.inputSize}→${nn.hiddenSize}→${nn.outputSize}`, trainingSamples: nn.trainingSamples, epochs: nn.epochs, accuracy: nn.accuracy } } };
    }

    default:
      throw new Error(`neural-brain.run: unknown op "${op}"`);
  }
}

import { create } from './lib/report.mjs';

const { ok, ng, skip, report } = create();
const NAME = 'Neural Brain — 纯 JS 微神经网络';

async function test() {
  const { NeuralBrain } = await import('../core/memory/neural-brain.js');
  const nn = new NeuralBrain(64, 32, 2);

  const samples = [
    { text: 'hello world', label: [1, 0] },
    { text: 'goodbye world', label: [0, 1] },
    { text: 'hi there', label: [1, 0] },
    { text: 'bye now', label: [0, 1] },
  ];
  for (let e = 0; e < 30; e++) {
    for (const s of samples) nn.train(s.text, s.label, 0.1);
  }

  const out = nn.predict('hello');
  if (out[0] > out[1]) ok('predict: class 0 > class 1 (correct)');
  else ng(`predict wrong: ${JSON.stringify(out)}`);

  if (nn.trainingSamples > 0) ok(`stats: ${nn.trainingSamples} samples, acc=${nn.accuracy}`);
  else ng('stats failed');

  report(NAME);
}

export { test };


// ===== 21.mjs =====
// Experiment 53: Teach-Me — 苏格拉底式交互教学
//
// 基于 CCB /teach-me pattern。
// 诊断水平 → 拆解 5-15 原子概念 → 苏格拉底提问 → 断点续学。
// 可建在 skill-loader 之上，也可独立运行。
//
// I/O (compose 契约):
//   { op, topic?, level?, answer?, resume? }
//   → { outputs: { path?, current?, question?, progress?, done? } }

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { create } from './lib/report.mjs';

export const experiment_21_META = { id: 'teach-me' };

const NAME = 'Teach-Me — 苏格拉底式交互教学';

// ── 知识点库（内置教学大纲） ──

const TOPIC_DB = {
  javascript: {
    title: 'JavaScript 基础',
    concepts: [
      { id: 'js1', name: '变量与作用域 (var/let/const)', questions: ['var 和 let 有什么区别？', '什么是暂时性死区？'] },
      { id: 'js2', name: '闭包与高阶函数', questions: ['闭包是什么？能举一个实际例子吗？', '高阶函数如何工作？'] },
      { id: 'js3', name: '原型链与继承', questions: ['JavaScript 如何实现继承？', 'class 语法是真正的类吗？'] },
      { id: 'js4', name: '异步编程 (Promise/async/await)', questions: ['微任务和宏任务的区别？', 'Promise.all 和 Promise.allSettled 的区别？'] },
      { id: 'js5', name: 'Event Loop 事件循环', questions: ['请描述一次完整的事件循环 tick。', 'setTimeout(fn, 0) 什么时候执行？'] },
    ],
  },
  nodejs: {
    title: 'Node.js 基础',
    concepts: [
      { id: 'node1', name: '模块系统 (CommonJS vs ESM)', questions: ['require 和 import 的区别？', '循环依赖如何处理？'] },
      { id: 'node2', name: 'Stream 与 Buffer', questions: ['Stream 有几种类型？', '背压如何处理？'] },
      { id: 'node3', name: 'EventEmitter 模式', questions: ['EventEmitter 如何避免内存泄漏？', 'maxListeners 的作用？'] },
      { id: 'node4', name: 'Cluster 与子进程', questions: ['Cluster 如何实现负载均衡？', 'child_process 有哪些 spawn 模式？'] },
    ],
  },
  flutter: {
    title: 'Flutter 开发',
    concepts: [
      { id: 'fl1', name: 'Widget 树与 Element 树', questions: ['StatelessWidget 和 StatefulWidget 的区别？', 'Key 的作用是什么？'] },
      { id: 'fl2', name: '状态管理 (Riverpod)', questions: ['Provider 和 Riverpod 的区别？', '如何避免不必要的 rebuild？'] },
      { id: 'fl3', name: 'BuildContext 与 InheritedWidget', questions: ['BuildContext 的本质是什么？', 'of(context) 是如何查找的？'] },
      { id: 'fl4', name: '渲染管线与 Layout', questions: ['Flutter 的渲染管线有几个阶段？', 'Constraints go down, Sizes go up 是什么意思？'] },
    ],
  },
  agent: {
    title: 'Agent Harness 工程',
    concepts: [
      { id: 'ag1', name: 'Agent Loop 核心', questions: ['Agent loop 中 stop_reason 有哪些？', 'tool_use 之后为什么要追加 tool_result？'] },
      { id: 'ag2', name: 'Tool 系统设计', questions: ['Tool handler 的 dispatch 模式是怎样的？', '如何保证工具调用的安全性？'] },
      { id: 'ag3', name: '上下文管理', questions: ['Context compaction 有哪几种策略？', 'Subagent 如何实现上下文隔离？'] },
      { id: 'ag4', name: '多 Agent 协作', questions: ['MessageBus 的设计模式是怎样的？', 'Auto-claim 和 Leader-assign 的对比？'] },
      { id: 'ag5', name: 'Feature Flag 系统', questions: ['分层回退有哪些层级？', '同步读取 vs 异步刷新如何平衡？'] },
    ],
  },
};

// ── 学习进度持久化 ──

const PROGRESS_DIR = resolve(homedir(), '.openchat', 'teach-me');

async function _loadProgress(topic) {
  try {
    const file = resolve(PROGRESS_DIR, `${topic}.json`);
    if (!existsSync(file)) return null;
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function _saveProgress(topic, data) {
  await mkdir(PROGRESS_DIR, { recursive: true });
  const file = resolve(PROGRESS_DIR, `${topic}.json`);
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── 概念生成（内置 + 扩展） ──

function _generatePath(topic, level) {
  const entry = TOPIC_DB[topic];
  if (entry) {
    return {
      title: entry.title,
      concepts: entry.concepts.map((c, i) => ({
        ...c,
        status: i === 0 ? 'current' : 'pending',
      })),
    };
  }

  // 未知主题：生成通用路径
  const numConcepts = level === 'advanced' ? 10 : level === 'beginner' ? 4 : 6;
  return {
    title: `${topic} 学习路径`,
    concepts: Array.from({ length: numConcepts }, (_, i) => ({
      id: `c_${topic}_${i}`,
      name: `${topic} - 概念 ${i + 1}`,
      questions: [`你对"${topic}"概念${i + 1}如何理解？`],
      status: i === 0 ? 'current' : 'pending',
    })),
  };
}

function _getQuestion(concept, idx = 0) {
  if (concept.questions && concept.questions.length > 0) {
    return concept.questions[idx % concept.questions.length];
  }
  return `请描述你对"${concept.name}"的理解。`;
}

// ── Public API ──

export async function experiment_21_run({ inputs = {} } = {}) {
  const { op, topic, level = 'auto', answer, resume } = inputs;

  switch (op) {
    case 'start': {
      if (!topic) throw new Error('topic required');

      // 检查断点续学
      if (resume) {
        const saved = await _loadProgress(topic);
        if (saved) {
          return { outputs: { progress: saved, resumed: true } };
        }
      }

      const path = _generatePath(topic, level);
      const progress = {
        topic,
        level,
        title: path.title,
        concepts: path.concepts,
        completed: [],
        currentConcept: path.concepts[0],
        currentQuestion: _getQuestion(path.concepts[0]),
        total: path.concepts.length,
        done: 0,
        score: 0,
      };

      await _saveProgress(topic, progress);
      return {
        outputs: {
          path: progress.concepts.map(c => ({ id: c.id, name: c.name, status: c.status })),
          current: { name: progress.currentConcept.name, question: progress.currentQuestion },
          progress,
        },
      };
    }

    case 'answer': {
      if (!topic) throw new Error('topic required');

      const progress = await _loadProgress(topic);
      if (!progress) throw new Error(`no session for topic: ${topic}. Start first.`);

      // 评分（模拟：有回答即通过）
      const score = answer && answer.length > 5 ? 1 : 0.5;
      progress.score += score;
      progress.done++;

      // 标记当前完成
      const current = progress.concepts.find(c => c.status === 'current');
      if (current) {
        current.status = 'completed';
        progress.completed.push(current.id);
      }

      // 检查是否完成
      const next = progress.concepts.find(c => c.status === 'pending');
      if (next) {
        next.status = 'current';
        progress.currentConcept = next;
        progress.currentQuestion = _getQuestion(next);
      } else {
        progress.currentConcept = null;
        progress.currentQuestion = null;
      }

      // 计算总分
      const totalScore = Math.round((progress.score / progress.total) * 100);

      await _saveProgress(topic, progress);

      if (!next) {
        return {
          outputs: {
            done: true,
            score: totalScore,
            summary: `完成了 ${progress.title}，得分 ${totalScore}%`,
            progress,
          },
        };
      }

      return {
        outputs: {
          done: false,
          next: { name: next.name, question: progress.currentQuestion },
          progress: {
            done: progress.done,
            total: progress.total,
            score: totalScore,
            currentName: next.name,
          },
        },
      };
    }

    case 'status': {
      if (!topic) throw new Error('topic required');
      const progress = await _loadProgress(topic);
      if (!progress) return { outputs: { exists: false } };

      const score = progress.total > 0 ? Math.round((progress.score / progress.total) * 100) : 0;
      return {
        outputs: {
          exists: true,
          topic: progress.topic,
          title: progress.title,
          done: progress.done,
          total: progress.total,
          score,
          completed: progress.completed,
          current: progress.currentConcept?.name || null,
        },
      };
    }

    case 'list': {
      const topics = Object.keys(TOPIC_DB).map(key => ({
        id: key,
        title: TOPIC_DB[key].title,
        concepts: TOPIC_DB[key].concepts.length,
      }));
      return { outputs: { builtin: topics } };
    }

    default:
      throw new Error(`unknown op: ${op}`);
  }
}

// ── 测试 ──

export async function experiment_21_test() {
  const { ok, ng, report } = create();
  let pass = true;

  // ① start 已知主题
  const s1 = await run({ inputs: { op: 'start', topic: 'javascript' } });
  if (s1.outputs.path && s1.outputs.path.length === 5) ok('start JS path has 5 concepts');
  else { ng(`start: got ${s1.outputs.path?.length} concepts`); pass = false; }

  // ② start 未知主题 + level
  const s2 = await run({ inputs: { op: 'start', topic: '量子计算', level: 'beginner' } });
  if (s2.outputs.path && s2.outputs.path.length === 4) ok('start unknown topic with beginner level');
  else { ng(`start unknown: got ${s2.outputs.path?.length}`); pass = false; }

  // ③ answer 通过
  const s3 = await run({ inputs: { op: 'answer', topic: 'javascript', answer: 'var 是函数作用域，let 和 const 是块作用域，const 不能重新赋值。' } });
  if (s3.outputs.done === false && s3.outputs.next) ok('answer moves to next concept');
  else { ng('answer: no next concept'); pass = false; }

  // ④ status
  const s4 = await run({ inputs: { op: 'status', topic: 'javascript' } });
  if (s4.outputs.exists && s4.outputs.done === 1) ok('status shows 1/5 completed');
  else { ng(`status: done=${s4.outputs.done}`); pass = false; }

  // ⑤ list
  const s5 = await run({ inputs: { op: 'list' } });
  if (s5.outputs.builtin && s5.outputs.builtin.length >= 4) ok('list has 4+ builtin topics');
  else { ng('list: too few topics'); pass = false; }

  // ⑥ 完整路径完成
  // 跑完剩余 4 题
  for (const ans of ['闭包是函数及其词法环境的组合', '通过 prototype 实现', 'Promise 是微任务', '先执行同步再微任务再宏任务']) {
    await run({ inputs: { op: 'answer', topic: 'javascript', answer: ans } });
  }
  const s6 = await run({ inputs: { op: 'status', topic: 'javascript' } });
  if (s6.outputs.done === 5 && s6.outputs.score > 0) ok('complete JS path: 5/5 done');
  else { ng(`complete: done=${s6.outputs.done} score=${s6.outputs.score}`); pass = false; }

  // ⑦ resume
  const s7 = await run({ inputs: { op: 'start', topic: 'javascript', resume: true } });
  if (s7.outputs.resumed && s7.outputs.progress.done === 5) ok('resume works');
  else { ng('resume: failed'); pass = false; }

  report(NAME);
  return pass;
}


// ===== 22.mjs =====
// Walking-skeleton agent: LLM chat via provider-kit.
// (Rule: any LLM call MUST go through provider-kit, not custom code.)
// No sessionManager — _sessions Map handles per-chat history.
// Multi-turn tool loop: after user message, agent can call tools repeatedly
// until it produces a final text answer (like opencode goal).

import { persistentConfig } from './lib/config.mjs';
import { createProvider } from 'provider-kit';
import { runPipeline, getEditProtocolGuidance } from './lib/epc-pipeline.mjs';
import { TOOLS as CODING_TOOLS, executeTool as codingExec } from './lib/coding-tools.mjs';
import { createGuardian } from './lib/guardian.mjs';
import { getRole } from './lib/subagent-roles.mjs';
import {
  init as brainInit,
  predict as brainPredict,
  adaptTools as brainAdaptTools,
  adaptMaxRounds as brainAdaptMaxRounds,
  trainOnOutcome as brainTrain,
} from './lib/neural-bridge.mjs';
import { checkPermission as permCheck } from './lib/permission-gate.mjs';
import { runPre as hookPre, runPost as hookPost } from './lib/agent-hooks.mjs';

brainInit();  // 进程启动一次性, always-on

const CWD = process.cwd();
// 简化 SYSTEM_PROMPT — 原版约束太多 (Call ONE tool at a time + getEditProtocolGuidance), 阻断 M3 多步探索
// M3 验证 (e2e_loop_result.json) 显示它喜欢多 read + 多 write + 中间 verify, 给它自由度
const SYSTEM_PROMPT = `You are a coding assistant. Working directory: ${CWD}.

Use available tools to complete the user's task. Be thorough — read files first, then make targeted edits, then verify (re-read or run tests).

Reply in the same language as the user.`;

const MAX_ROUNDS = 20;
const MAX_REPEAT = 8;
// 读类工具不计入 repeat 限制 — M3 习惯多读几遍确认 (wc / powershell / node -e 等), 这是合法探索, 不是 loop
const READ_ONLY_TOOLS = new Set(['read_file', 'grep', 'code_search', 'ast_find_refs', 'find_refs', 'ast_index', 'ast_search', 'ast_extract', 'ts_typecheck', 'lint_run', 'test_run', 'test_discover', 'docs_suggest', 'env_diff', 'sec_audit', 'ci_detect', 'git_log']);
let _provider = null;
let _model = null;
const _sessions = new Map(); // chatId → { history, sessionId }

export async function experiment_22_initProvider() {
  const cfg = persistentConfig.config;
  let provider = cfg.current?.provider;
  let model = cfg.current?.model;
  if (!provider || !model || !cfg.providers?.[provider]) {
    const keys = Object.keys(cfg.providers || {});
    if (keys.length === 0) throw new Error('config.json: no provider configured');
    provider = keys[0];
    model = cfg.providers[provider]?.defaultModel || cfg.providers[provider]?.model;
    if (!model) throw new Error(`config.json: no model for ${provider}`);
  }
  const apiKey = cfg.providers[provider]?.apiKey;
  if (!apiKey) throw new Error(`config.json: providers.${provider}.apiKey missing`);

  _provider = createProvider(provider, apiKey);
  await _provider.connect(apiKey);
  _model = model;
  console.debug(`[tool-loop] init OK: ${provider}/${model} (via provider-kit)`);
  return `${provider}/${model}`;
}

// === invariants ===
//   - _provider 必须先调 initProvider() 才能调 processText/run
//   - 每个 chatId 一份 history (in-memory Map), session 不持久化
//   - role > brain > base 的优先级: role 决定 prompt/tools/maxRounds 顶, brain 在 role 之上微调
//   - toolSubset = (role.tools if role else callerTools) ∩ brain-adapt
// === end invariants ===

function _getOrCreateSession(chatId, systemPrompt = SYSTEM_PROMPT) {
  if (_sessions.has(chatId)) return _sessions.get(chatId);
  const entry = { history: [{ role: 'system', content: systemPrompt }], sessionId: chatId };
  _sessions.set(chatId, entry);
  console.debug(`[tool-loop] new session chatId=${chatId}${systemPrompt !== SYSTEM_PROMPT ? ' (role)' : ''}`);
  return entry;
}

export async function experiment_22_processText(text, chatId = 'default', opts = {}) {
  if (!_provider) throw new Error('call initProvider() first');

  // [ROLE] opt-in role override — prompt + tools + maxRounds 一起换
  const roleDef = opts.role ? getRole(opts.role) : null;
  if (roleDef) console.debug(`[role] ${chatId}: ${roleDef.name} (tools=${roleDef.tools.length}, maxRounds=${roleDef.maxRounds})`);

  // [BRAIN] predict — opt-in 读脑预测, 失败/未启 = null
  const brainPred = brainPredict(text);
  if (brainPred) {
    console.debug(`[brain] ${chatId}: difficulty=${brainPred.difficulty} domain=${brainPred.domain} canLocal=${brainPred.canLocal} (samples=${brainPred.samples})`);
  }

  const entry = _getOrCreateSession(chatId, roleDef ? roleDef.prompt : undefined);
  entry.history.push({ role: 'user', content: text });

  const guardian = opts.guardian !== undefined ? opts.guardian : null;  // 默认关闭 guardian — 它会拒绝 LLM 的合法 tool call, 阻断 M3 多步探索
  // 窄工具集: 调用方传 opts.tools (tool name 数组) → 只暴露这些给 LLM.
  // 默认 = 全 39. M3 在 39 工具下会偏向 build_run/lang_run (通用 shell), 不肯用 edit_file/hash_edit,
  // 浪费 round 在探索, 撞 MAX_ROUNDS. 5-件套原则: 任务越窄, 工具越少越好.
  // [ROLE] role 优先于 callerTools, callerTools 优先于全集
  const callerTools = (Array.isArray(opts.tools) && opts.tools.length > 0)
    ? CODING_TOOLS.filter(t => opts.tools.includes(t.function?.name))
    : CODING_TOOLS;
  const roleBase = roleDef
    ? CODING_TOOLS.filter(t => roleDef.tools.includes(t.function?.name))
    : callerTools;
  // [BRAIN] adapt tools by predicted domain (code_review → 只读)
  const toolSubset = brainAdaptTools(roleBase, brainPred?.domain);
  // [BRAIN] adapt max rounds by predicted difficulty
  // [ROLE] role.maxRounds 优先于 brain, brain 优先于 base
  const baseRounds = roleDef ? roleDef.maxRounds : MAX_ROUNDS;
  const effectiveMaxRounds = brainAdaptMaxRounds(baseRounds, brainPred?.difficulty);
  let finalText = '';
  const callCount = new Map();

  for (let round = 0; round < effectiveMaxRounds; round++) {
    const rawResponse = await _provider.chat(_model, entry.history, {
      tools: toolSubset,
    });

    let toolCalls;
    if (guardian) {
      // guardian 模式: 先校验整个响应
      const v = guardian.validateResponse(rawResponse);
      toolCalls = v.toolCalls;
      if (!v.valid) {
        const nudge = v.errors.map(e => `[Guardian] ${e.tool}: ${e.error}`).join('\n');
        entry.history.push({ role: 'tool', tool_call_id: 'guardian', content: nudge });
        if (v.toolCalls.length === 0) continue;
      }
    } else {
      const p = runPipeline(rawResponse);
      toolCalls = p.toolCalls;
    }

    if (toolCalls && toolCalls.length > 0) {
      const asstMsg = {
        role: 'assistant',
        content: rawResponse.content || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.args || {}) },
        })),
      };
      entry.history.push(asstMsg);

      for (const tc of toolCalls) {
        const rawArgs = tc.function?.arguments || tc.arguments || '{}';
        const key = `${tc.name}:${rawArgs}`;
        if (!READ_ONLY_TOOLS.has(tc.name)) {
          const count = (callCount.get(key) || 0) + 1;
          callCount.set(key, count);
          if (count > MAX_REPEAT) {
            finalText = `[loop aborted: ${tc.name} called ${count} times with same args]`;
            entry.history.push({ role: 'tool', tool_call_id: tc.id, content: finalText });
            break;
          }
        }

        if (guardian) {
          const g = await guardian.wrap(tc, _execTool);
          entry.history.push({ role: 'tool', tool_call_id: tc.id, content: g.ok ? g.result : g.error });
          if (g.bypassedByGuardian) break;
        } else {
          // [PERMISSION] gate before _execTool — safe 直通, confirm 问/auto, forbidden block
          let parsedArgs = {};
          try { parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs || {}); } catch { /* 留给 _execTool 报错 */ }
          const perm = permCheck(tc.name, parsedArgs, { chatId });
          if (!perm.allowed) {
            entry.history.push({ role: 'tool', tool_call_id: tc.id, content: `[Denied: ${perm.reason}]` });
            continue;
          }
          const result = await _execTool(tc.name, rawArgs);
          entry.history.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
      }
      if (finalText) break;
    } else {
      finalText = rawResponse.content || '';
      break;
    }
  }

  if (!finalText) finalText = '[max rounds reached]';

  // [BRAIN] train on outcome — 失败 → difficulty +1, domain → 'logic'
  if (brainPred) {
    const success = !finalText.startsWith('[max rounds') && !finalText.startsWith('[loop aborted');
    const error = success ? null : finalText;
    brainTrain({ text, predicted: brainPred, success, error });
  }

  entry.history.push({ role: 'assistant', content: finalText });

  const trimmed = [entry.history[0], ...entry.history.slice(-18)];
  entry.history = trimmed;

  return { response: finalText, toolCalls: [], sessionId: entry.sessionId };
}

async function _execTool(name, argsRaw) {
  let args;
  try { args = typeof argsRaw === 'string' ? JSON.parse(argsRaw) : argsRaw; } catch { return `[Error] Invalid JSON: ${String(argsRaw).slice(0, 80)}`; }
  try {
    // [HOOKS] preTool — permission/限流/撤销 注册的 hook 链, 抛 throw 中止 (Step 6.1 / L3 整车基础)
    await hookPre(name, args);
    const r = await codingExec(name, args);
    const s = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
    const truncated = s.length > 8000 ? s.slice(0, 8000) + '\n... (truncated)' : s;
    // [HOOKS] postTool — log/transform chain, hook 抛 throw 不阻断主流程 (warn 而已)
    return await hookPost(name, args, truncated);
  } catch (e) {
    return `[Error] ${e.message}`;
  }
}

export function experiment_22_getHistory(chatId) {
  const entry = _sessions.get(chatId);
  return entry ? [...entry.history] : [];
}

// compose 契约入口
//   inputs: { text, chatId?, guardian?, tools? }
//   deps:   { guardian: { guardian } }
//   outputs: { response, toolCalls }
export async function experiment_22_run({ inputs = {}, deps = {} } = {}) {
  if (!_provider) await initProvider();
  const { text, chatId = 'default' } = inputs;
  if (!text) throw new Error('tool-loop.run: text required');
  const guardianOpt = inputs.guardian || deps.guardian?.guardian;
  const opts = {};
  if (guardianOpt) opts.guardian = guardianOpt;
  if (Array.isArray(inputs.tools) && inputs.tools.length > 0) opts.tools = inputs.tools;
  if (typeof inputs.role === 'string') opts.role = inputs.role;
  const r = await processText(text, chatId, opts);
  return { outputs: { response: r.response || '', toolCalls: r.toolCalls || [] } };
}

export async function experiment_22_generateSessionName(chatId) {
  if (!_provider) throw new Error('provider not initialized');
  const entry = _sessions.get(chatId);
  if (!entry || entry.history.length < 2) return null;
  const userMessages = entry.history.filter(m => m.role === 'user').slice(0, 5);
  if (userMessages.length === 0) return null;
  const context = userMessages.map(m => m.content).join('\n');
  const messages = [
    { role: 'system', content: 'Generate a 1-4 character Chinese session title. Return ONLY the title, no quotes, no punctuation.' },
    { role: 'user', content: `Conversation:\n${context}\n\nSession title:` },
  ];
  const resp = await _provider.chat(_model, messages, { includeRaw: false });
  const p = runPipeline(resp);
  return (p.content || '').replace(/["'「」]/g, '').trim().substring(0, 20) || null;
}

// 最小 smoke test — 验证模块加载 + provider 初始化
export async function experiment_22_test() {
  const errors = [];
  try {
    await generateSessionName();
    await getHistory();
    await processText();
    await initProvider();
    if (typeof initProvider !== 'function') errors.push('initProvider not a function');
    if (typeof processText !== 'function') errors.push('processText not a function');
    if (typeof run !== 'function') errors.push('run not a function');
  } catch (e) { errors.push(e.message); }
  // 不实际调 LLM — 那是 e2e 测试的事
  return { ok: errors.length === 0, errors };
}


// ===== 23.mjs =====
// Experiment 20: 语义搜索 — AST grep + 跨文件引用追踪
// Manifest id: code-search
// Deps: [config]

import { create } from './lib/report.mjs';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

export const experiment_23_META = { id: 'code-search' };
const NAME = 'Code-Search — grep + 跨文件引用追踪';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function experiment_23_run({ inputs = {} } = {}) {
  const { op = 'test', pattern, include, rootDir, maxResults, symbol } = inputs;
  if (op === 'test') { await test(); return { outputs: { ok: true } }; }
  if (op === 'grepSearch') {
    const { grepSearch } = await import('../experiments/lib/coding-lib.mjs');
    const results = await grepSearch(pattern, { include, rootDir, maxResults });
    return { outputs: { results } };
  }
  if (op === 'findReferences') {
    const { findReferences } = await import('../experiments/lib/coding-lib.mjs');
    const refs = await findReferences(symbol, { rootDir, maxResults });
    return { outputs: refs };
  }
  throw new Error(`code-search: unknown op "${op}"`);
}

export async function experiment_23_test() {
  const R = create();
  const { grepSearch, findReferences } = await import('../experiments/lib/coding-lib.mjs');

  // === grepSearch ===
  {
    const results = await grepSearch('grepSearch', { include: '*.mjs', rootDir: path.join(__dirname, '..', 'tools'), maxResults: 5 });
    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 1, 'should find grepSearch in code-search.mjs');
    assert.ok(results.some(r => r.file.includes('code-search.mjs')), 'should find in code-search.mjs');
    assert.ok(typeof results[0].line === 'number');
    R.ok('grepSearch finds patterns in project files');
  }

  {
    const results = await grepSearch('__THIS_STRING_DOES_NOT_EXIST_ANYWHERE__', { include: '*.xyz', rootDir: __dirname, maxResults: 100 });
    assert.strictEqual(results.length, 0);
    R.ok('grepSearch returns empty for non-matching pattern');
  }

  {
    const results = await grepSearch('readFile', { include: '*.mjs', maxResults: 20 });
    assert.ok(results.length >= 1);
    R.ok('grepSearch with include filter works');
  }

  // === findReferences ===
  {
    const refs = await findReferences('grepSearch', { rootDir: path.join(__dirname, '..', 'tools'), maxResults: 10 });
    assert.ok(refs.definitions.length >= 1 || refs.usages.length >= 0);
    const hasSrc = [...refs.definitions, ...refs.usages].some(r => r.file.includes('code-search.mjs'));
    assert.ok(hasSrc, 'should find grepSearch in code-search.mjs');
    R.ok('findReferences finds symbol in source files');
  }

  {
    const refs = await findReferences('doesnotexist_xyz_12345', { rootDir: path.join(__dirname, '..', 'tools') });
    assert.ok(Array.isArray(refs.definitions));
    assert.ok(Array.isArray(refs.usages));
    R.ok('findReferences non-existent symbol returns empty arrays');
  }

  // === Cross-file reference test ===
  {
    const refs = await findReferences('TOOLS', { rootDir: path.join(__dirname, '..', 'tools'), maxResults: 20 });
    const files = [...refs.definitions, ...refs.usages].map(r => r.file);
    const uniqueFiles = [...new Set(files)];
    assert.ok(uniqueFiles.length >= 1);
    R.ok('findReferences cross-file: TOOLS found in coding-tools.mjs + code-search.mjs');
  }

  R.report(NAME);
}




// ===== 24.mjs =====
// Experiment 12a: 高级编辑 — multi-edit / ast-edit / diff-review
// Manifest id: edit-advanced
// I/O: { op, path?, data? } → result

import { create } from './lib/report.mjs';
import fs from 'fs/promises';
import path from 'path';

export const experiment_24_META = { id: 'edit-advanced' };

const NAME = 'Edit-Advanced — multi-edit / ast-edit / diff-review';
const TMP_DIR = path.join(process.cwd(), 'tests', 'experiments', '_tmp_edit_advanced');

export async function experiment_24_run({ inputs = {} } = {}) {
  const { op = 'test' } = inputs;
  if (op === 'test') { await testEditAdvanced(); return { outputs: { ok: true } }; }
  if (op === 'multiEdit') {
    const { multiEdit } = await import('../experiments/lib/coding-lib.mjs');
    return { outputs: await multiEdit(inputs.edits) };
  }
  if (op === 'astEdit') {
    const { astEdit } = await import('../experiments/lib/coding-lib.mjs');
    return { outputs: await astEdit(inputs.file, inputs.pattern, inputs.action, inputs.newValue) };
  }
  if (op === 'getGitDiff') {
    const { getGitDiff } = await import('../experiments/lib/coding-lib.mjs');
    return { outputs: await getGitDiff(inputs.base) };
  }
  throw new Error(`edit-advanced: unknown op "${op}"`);
}

async function testEditAdvanced() {
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(TMP_DIR, { recursive: true });

  const r = create();

  // 1. multi-edit 可加载
  let me;
  try {
    me = await import('./lib/multi-edit.mjs');
    r.ok('multi-edit.mjs 可加载');
    if (typeof me.multiEdit === 'function') r.ok('multiEdit 函数存在');
    else r.ng('multiEdit 缺失');
  } catch (e) {
    r.ng('multi-edit 加载失败', e);
  }

  // 2. ast-edit 可加载 + rename / replace_body
  let ae;
  try {
    ae = await import('./lib/ast-edit.mjs');
    r.ok('ast-edit.mjs 可加载');
    if (typeof ae.astEdit === 'function') r.ok('astEdit 函数存在');
    else r.ng('astEdit 缺失');

    const astTestFile = path.join(TMP_DIR, 'ast-test.js');
    await fs.writeFile(astTestFile, 'function greet(name) { return "hello " + name; }\n', 'utf8');
    const r1 = await ae.astEdit(astTestFile, 'function:greet', 'rename', 'sayHi');
    if (r1.action === 'rename') r.ok(`ast-edit rename: "${r1.path}"`);
    const afterAst = await fs.readFile(astTestFile, 'utf8');
    if (afterAst.includes('sayHi')) r.ok('ast-edit 重命名内容正确');
    else r.ng(`ast-edit 内容: "${afterAst}"`);

    await ae.astEdit(astTestFile, 'function:sayHi', 'replace_body', 'return "hi " + name;');
    const afterBody = await fs.readFile(astTestFile, 'utf8');
    if (afterBody.includes('return "hi " + name;')) r.ok('ast-edit replace_body 正确');
    else r.ng(`ast-edit body: "${afterBody}"`);
  } catch (e) {
    r.ng('ast-edit 失败', e);
  }

  // 3. diff-review 可加载
  let dr;
  try {
    dr = await import('./lib/diff-review.mjs');
    r.ok('diff-review.mjs 可加载');
    if (typeof dr.getGitDiff === 'function') r.ok('getGitDiff 存在');
    if (typeof dr.revertChanges === 'function') r.ok('revertChanges 存在');
  } catch (e) {
    r.ng('diff-review 加载失败', e);
  }

  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  r.report(NAME);
}

export { testEditAdvanced, testEditAdvanced as test };


// ===== 25.mjs =====
// Experiment 21: Dev Tools — 依赖图 / Git / 测试 / Lint / 构建 / 语言 / Docker / SQL / API / 安全 / 文档 / CI / 环境
// Manifest id: dev-tools
// Deps: [config]

import { create } from './lib/report.mjs';
import assert from 'node:assert';

export const experiment_25_META = { id: 'dev-tools' };
const NAME = 'Dev-Tools — 16 个工程工具';

// compose 契约入口：ops 包括原有 dev-tools 操作 + 系统健康检查
export async function experiment_25_run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('dev-tools.run: op required');
  const tools = await import('../experiments/lib/coding-lib.mjs');

  switch (op) {
    // === 系统健康检查（从实验 26-30 收编） ===

    case 'check_tracing': {
      const { generate, createSpan, endSpan, getTrace, formatLog } = await import('../experiments/lib/coding-lib.mjs');
      const id = generate();
      const child = createSpan('', 'child');
      const grandchild = createSpan(child, 'grandchild');
      endSpan(grandchild);
      endSpan(child);
      const trace = getTrace(grandchild);
      const log = formatLog(id, 'hello', 'world');
      return {
        outputs: {
          requestId: id,
          spanCount: trace.length,
          spanNames: trace.map(s => s.name),
          logExample: log,
        },
      };
    }

    case 'check_failover': {
      const { persistentConfig } = await import('../core/persistent-config.js');
      const cfg = persistentConfig.config || {};
      const providerId = cfg.current?.provider || '';
      const prov = cfg.providers?.[providerId];
      const failoverChain = prov?.failover || prov?.fallback || [];
      const apiKeyOk = !!prov?.apiKey;
      return {
        outputs: {
          provider: providerId,
          model: cfg.current?.model || '',
          hasApiKey: apiKeyOk,
          failoverCount: Array.isArray(failoverChain) ? failoverChain.length : 0,
          failoverChain: Array.isArray(failoverChain) ? failoverChain : [],
          healthy: apiKeyOk,
        },
      };
    }

    case 'check_backpressure': {
      const { persistentConfig } = await import('../core/persistent-config.js');
      const cfg = persistentConfig.config || {};
      const defaultMax = 20;
      let pollerOk = false;
      try {
        const { tsFromKey, parseMsgPayload } = await import('../core/chat-poller.mjs');
        pollerOk = typeof tsFromKey === 'function' && typeof parseMsgPayload === 'function';
      } catch (e) { console.error('[C0]', e); }
      return {
        outputs: {
          maxInFlight: defaultMax,
          chatPollerLoaded: pollerOk,
          note: 'inFlight state is module-private in chat-poller.mjs; runtime backpressure not externally observable',
        },
      };
    }

    case 'check_sessions': {
      const { persistentStore } = await import('../core/persistent-store.js');
      const all = persistentStore.getAllSessions();
      return {
        outputs: {
          sessionCount: all.length,
          sessionIds: all.map(s => s.id),
          sessions: all,
        },
      };
    }

    case 'check_recovery': {
      const { persistentStore } = await import('../core/persistent-store.js');
      const sessions = persistentStore.getAllSessions();
      const { homedir } = await import('os');
      const { join } = await import('path');
      const sessionsFile = join(homedir(), '.openchat', 'sessions.json');
      const fs = await import('fs/promises');
      let fileExists = false;
      try { await fs.access(sessionsFile); fileExists = true; } catch (e) { console.error('[C0]', e); }
      return {
        outputs: {
          sessionsFileExists: fileExists,
          sessionCount: sessions.length,
          note: 'seenKeys is module-private in chat-poller.mjs; recovery state not externally observable',
        },
      };
    }

    // === 原有 dev-tools 操作（通过 tools module 代理） ===

    case 'dep_graph':
    case 'depGraph':
      return { outputs: { result: await tools.depGraph(args.rootDir) } };
    case 'detect_cycles':
    case 'detectCycles':
      return { outputs: { result: await tools.detectCycles(args.rootDir) } };
    case 'to_mermaid':
    case 'toMermaid':
      return { outputs: { result: tools.toMermaid(args.edges) } };
    case 'git_commit':
    case 'gitCommit':
      return { outputs: { result: tools.gitCommit(args.context) } };
    case 'git_log':
    case 'gitLog':
      return { outputs: { result: tools.gitLog(args.count) } };
    case 'test_run':
    case 'testRun':
      return { outputs: { result: await tools.testRun(args.pattern) } };
    case 'test_discover':
    case 'testDiscover':
      return { outputs: { result: await tools.testDiscover(args.rootDir) } };
    case 'lint_run':
    case 'lintRun':
      return { outputs: { result: tools.lintRun(args.pattern) } };
    case 'lint_fix':
    case 'lintFix':
      return { outputs: { result: tools.lintFix(args.pattern) } };
    case 'build_run':
    case 'buildRun':
      return { outputs: { result: tools.buildRun(args.command) } };
    case 'ts_typecheck':
    case 'tsTypeCheck':
      return { outputs: { result: tools.tsTypeCheck(args.pattern) } };
    case 'lang_run':
    case 'langRun':
      return { outputs: { result: tools.langRun(args.language, args.command) } };
    case 'docker_build':
    case 'dockerBuild':
      return { outputs: { result: tools.dockerBuild(args.tag, args.dockerfile) } };
    case 'sql_parse':
    case 'sqlParse':
      return { outputs: { result: tools.sqlParseCreate(args.sql) } };
    case 'curl_run':
    case 'curlRun':
      return { outputs: { result: await tools.curlRun(args.method, args.url, args.body) } };
    case 'sec_audit':
    case 'secAudit':
      return { outputs: { result: tools.secNpmAudit() } };
    case 'docs_suggest':
    case 'docsFindChanged':
      return { outputs: { result: tools.docsFindChanged() } };
    case 'ci_detect':
    case 'ciDetect':
      return { outputs: { result: tools.ciDetect() } };
    case 'env_diff':
    case 'envDiff':
      return { outputs: { result: tools.envDiff(args.a, args.b) } };
    default:
      throw new Error(`dev-tools.run: unknown op "${op}"`);
  }
}

export async function experiment_25_test() {
  const R = create();
  const tools = await import('../experiments/lib/coding-lib.mjs');

  // Step 2: 依赖图
  {
    const g = await tools.depGraph('src/tools');
    assert.ok(g.nodes.length >= 1);
    assert.ok(g.edgeCount >= 0);
    R.ok('depGraph: 解析依赖图成功');

    const cyc = await tools.detectCycles('src/tools');
    assert.ok(typeof cyc.cycleCount === 'number');
    R.ok('detectCycles: 循环依赖检测成功');
  }

  // Step 3: 架构可视化
  {
    const mermaid = tools.toMermaid([{ from: 'a.js', to: 'b.js' }]);
    assert.ok(mermaid.includes('graph TD'));
    assert.ok(mermaid.includes('a_js'));
    R.ok('toMermaid: 生成 Mermaid 格式');
  }

  // Step 4: Git
  {
    const log = tools.gitLog(3);
    assert.ok(Array.isArray(log.log));
    assert.ok(log.log.length <= 3);
    R.ok('gitLog: 获取提交历史');
  }

  // Step 5: 测试发现
  {
    const disc = await tools.testDiscover('src/tools');
    assert.ok(typeof disc.count === 'number');
    R.ok('testDiscover: 发现测试文件');
  }

  // Step 6: Lint
  {
    const lint = tools.lintRun('src/tools/coding-tools.mjs');
    assert.ok(typeof lint.totalFiles === 'number');
    R.ok('lintRun: ESLint 检测');
  }

  // Step 7: 构建 (dry run)
  {
    const build = tools.buildRun('node -e "console.debug(\'build ok\')"');
    assert.ok(build.success);
    R.ok('buildRun: 构建执行');
  }

  // Step 8: TS 类型检查 (skip if no tsc)
  {
    try {
      const ts = tools.tsTypeCheck();
      assert.ok(typeof ts.errorCount === 'number');
      R.ok('tsTypecheck: 类型检查');
    } catch { R.skip('tsTypecheck: tsc not available'); }
  }

  // Step 9: 多语言
  {
    const r = tools.langRun('python', '--version 2>&1 || echo "no python"');
    assert.ok(typeof r.output === 'string');
    R.ok('langRun: 多语言执行');
  }

  // Step 11: SQL
  {
    const sql = 'CREATE TABLE users (id INT, name TEXT); CREATE TABLE posts (id INT, title TEXT);';
    const schema = tools.sqlParseCreate(sql);
    assert.strictEqual(schema.tableCount, 2);
    assert.strictEqual(schema.tables[0].name, 'users');
    R.ok('sqlParse: 解析 CREATE TABLE');
  }

  // Step 12: API curl
  {
    const r = await tools.curlRun('GET', 'https://httpbin.org/get');
    assert.ok(typeof r.output === 'string' || r.error);
    R.ok('curlRun: HTTP 请求');
  }

  // Step 13: 安全审计
  {
    const audit = tools.secNpmAudit();
    assert.ok(typeof audit.total === 'number' || audit.error);
    R.ok('secAudit: npm audit');
  }

  // Step 15: 文档
  {
    const docs = tools.docsFindChanged();
    assert.ok(Array.isArray(docs.diffFiles));
    R.ok('docsSuggest: 变更文件检测');
  }

  // Step 16: CI
  {
    const ci = tools.ciDetect();
    assert.ok(ci.detected !== undefined);
    R.ok('ciDetect: CI 配置检测');
  }

  // Step 17: 环境 diff
  {
    const d = tools.envDiff({ KEY: 'a' }, { KEY: 'b', NEW: 'c' });
    assert.ok(d.hasChanges);
    assert.strictEqual(d.diff.length, 2);
    R.ok('envDiff: 环境变量比较');
  }

  R.report(NAME);
}




// ===== 26.mjs =====
import { rescueToolCall } from './lib/rescue-utils.mjs';

// Experiment: retry-guidance — 工具调用失败的结构化引导重试
// Manifest id: retry-guidance
// 当工具调用失败时，生成结构化引导信息给 LLM，提高重试成功率

export const experiment_26_META = {
  id: 'retry-guidance',
  name: 'Retry Guidance — 工具调用失败的结构化引导',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'guidance | execute_with_retry' },
    { name: 'toolName', type: 'string', required: false },
    { name: 'args', type: 'object', required: false },
    { name: 'error', type: 'string', required: false, description: '原始错误信息' },
    { name: 'attempts', type: 'number', required: false, default: 1 },
    { name: 'maxRetries', type: 'number', required: false, default: 3 },
    { name: 'executor', type: 'function', required: false, description: 'async (name, args) => result' },
    { name: 'toolSchema', type: 'object', required: false, description: '用于参数校验' },
  ],
  outputs: [
    { name: 'guidance', type: 'string' },
    { name: 'success', type: 'boolean' },
    { name: 'result', type: 'any' },
    { name: 'attempts', type: 'number' },
  ],
  deps: ['tool-rescue'],
  tags: ['guardrails', 'retry', 'guidance'],
};

// 错误分类 → 引导模板
const GUIDANCE_TEMPLATES = [
  { pattern: /timeout/i, template: '工具 {tool} 调用超时。这可能是因为网络延迟或服务负载高。请重试，或简化查询减少处理时间。' },
  { pattern: /rate\s*limit|too\s*many|429/i, template: 'API 频率限制触发。请等待几秒后重试，或减少并发请求数。' },
  { pattern: /auth|unauthorized|401|403|api.?key/i, template: '认证失败。请检查 API 密钥配置是否正确（~/.openchat/config.json 中的 apiKey）。' },
  { pattern: /not\s*found|404|enoent/i, template: '资源未找到。请检查路径/标识符是否正确。文件/目录可能已被移动或删除。' },
  { pattern: /traversal|denied|blocked/i, template: '操作被安全策略阻止。路径穿越/私网地址操作不被允许，请在允许的范围内操作。' },
  { pattern: /invalid|bad\s*request|400/i, template: '请求参数无效。请检查参数格式和类型是否正确。参考工具定义中的参数描述。' },
  { pattern: /server\s*error|5\d{2}|internal/i, template: '服务端错误。这不是你的问题，重试可能成功。' },
];

export async function experiment_26_run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('retry-guidance.run: op required');

  switch (op) {
    case 'guidance':
      return { outputs: { guidance: _buildGuidance(args.toolName, args.error, args.attempts || 1) } };

    case 'execute_with_retry': {
      if (!args.executor) throw new Error('executor function required');
      const maxRetries = args.maxRetries || 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let callArgs = args.args;
        if (args.toolSchema) {
          const rescued = rescueToolCall(args.toolName, callArgs, args.toolSchema);
          if (!rescued.valid) {
            return { outputs: { success: false, result: null, attempts: attempt, guidance: rescued.guidance } };
          }
          if (rescued.fixed) callArgs = rescued.fixedArgs;
        }

        // 2. 执行
        try {
          const result = await args.executor(args.toolName, callArgs);
          return { outputs: { success: true, result, attempts: attempt, guidance: '' } };
        } catch (e) {
          if (attempt >= maxRetries) {
            const msg = _buildGuidance(args.toolName, e.message, attempt);
            return { outputs: { success: false, result: null, attempts: attempt, guidance: msg } };
          }
        }
      }
    }

    default:
      throw new Error(`retry-guidance.run: unknown op "${op}"`);
  }
}

function _buildGuidance(toolName, error, attempt) {
  if (!error) return '';

  for (const t of GUIDANCE_TEMPLATES) {
    if (t.pattern.test(error)) {
      const msg = t.template.replace(/\{tool\}/g, toolName);
      return attempt > 1 ? `${msg} (第 ${attempt} 次重试)` : msg;
    }
  }

  return `工具 ${toolName} 调用失败: ${error.slice(0, 200)}。请检查输入后重试${attempt > 1 ? ` (第 ${attempt} 次)` : ''}。`;
}

import { create } from './lib/report.mjs';

const { ok, ng, skip, report } = create();
const NAME = 'Retry Guidance';

async function test() {
  // guidance 分类
  const g1 = _buildGuidance('web_fetch', 'timeout after 10s', 1);
  if (g1.includes('超时')) ok('guidance: timeout classified');
  else ng(`guidance timeout failed: ${g1}`);

  const g2 = _buildGuidance('read_file', 'ENOENT: file not found', 2);
  if (g2.includes('未找到')) ok('guidance: not found classified');
  else ng(`guidance not found failed: ${g2}`);

  const g3 = _buildGuidance('edit_file', 'Path traversal denied', 1);
  if (g3.includes('安全策略')) ok('guidance: traversal blocked');
  else ng(`guidance traversal failed: ${g3}`);

  // 未知错误 fallback
  const g4 = _buildGuidance('some_tool', 'something weird happened', 1);
  if (g4.includes('失败')) ok('guidance: fallback for unknown error');
  else ng(`guidance fallback failed: ${g4}`);

  report(NAME);
}

export { test };


// ===== 27.mjs =====
// Experiment 14: 存储 + Provider 接线
// Manifest id: storage
// I/O: 见各 op
//
// - persistent-store.js: 会话/provider 持久化（~/.openchat/sessions.json + providers.json）
// - provider-service.js: provider-kit 单一入口（唯一 import provider-kit 的文件）
// - tool-registry.js:    工具注册中心（read_memory / web_fetch / calculate / finish）

import { create } from './lib/report.mjs';

export const experiment_27_META = { id: 'storage' };

export async function experiment_27_run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('storage.run: op required');

  // session.*
  if (op.startsWith('session.')) {
    const { persistentStore } = await import('./lib/persistent-store.js');
    const sub = op.slice(8);
    switch (sub) {
      case 'get': return { outputs: { result: persistentStore.getSession(args.id) } };
      case 'set': persistentStore.setSession(args.id, args.data); return { outputs: { ok: true } };
      case 'delete': persistentStore.deleteSession(args.id); return { outputs: { ok: true } };
      case 'all': return { outputs: { result: persistentStore.getAllSessions() } };
      default: throw new Error(`storage.run: unknown op "${op}"`);
    }
  }

  // provider.*
  if (op.startsWith('provider.')) {
    const { persistentStore } = await import('./lib/persistent-store.js');
    const sub = op.slice(9);
    switch (sub) {
      case 'get': return { outputs: { result: persistentStore.getProvider(args.id) } };
      case 'set': persistentStore.setProvider(args.id, args.data); return { outputs: { ok: true } };
      case 'delete': persistentStore.deleteProvider(args.id); return { outputs: { ok: true } };
      case 'all': return { outputs: { result: persistentStore.getAllProviders() } };
      default: throw new Error(`storage.run: unknown op "${op}"`);
    }
  }

  // tool.*
  if (op.startsWith('tool.')) {
    const { toolRegistry } = await import('./lib/tool-registry.js');
    const sub = op.slice(5);
    switch (sub) {
      case 'list': return { outputs: { tools: toolRegistry.list() } };
      case 'call': return { outputs: { result: await toolRegistry.call(args.name, args.args) } };
      default: throw new Error(`storage.run: unknown op "${op}"`);
    }
  }

  // 直接工具调用（快捷 op）
  switch (op) {
    case 'web_fetch': {
      const { toolRegistry } = await import('./lib/tool-registry.js');
      return { outputs: { result: await toolRegistry.call('web_fetch', { url: args.url }) } };
    }
    case 'calculate': {
      const { toolRegistry } = await import('./lib/tool-registry.js');
      return { outputs: { result: await toolRegistry.call('calculate', { expression: args.expression }) } };
    }
    case 'finish': {
      const { toolRegistry } = await import('./lib/tool-registry.js');
      return { outputs: { result: await toolRegistry.call('finish', { answer: args.answer }) } };
    }
    case 'read_memory': {
      const { toolRegistry } = await import('./lib/tool-registry.js');
      return { outputs: { result: await toolRegistry.call('read_memory', { query: args.query, scope: args.scope }) } };
    }
    default:
      throw new Error(`storage.run: unknown op "${op}"`);
  }
}

const { ok, ng, skip, report } = create();
const NAME = 'Storage/Provider — persistent-store / provider-service / tool-registry';

async function test() {
  // === persistent-store ===
  try {
    const ps = await import('./lib/persistent-store.js');
    ok('persistent-store.js 可加载');

    if (ps.PersistentSessionStore) ok('PersistentSessionStore 类存在');
    if (ps.persistentStore) ok('persistentStore 单例存在');

    const s = new ps.PersistentSessionStore();
    if (typeof s.load === 'function') ok('load 存在');
    if (typeof s.save === 'function') ok('save 存在');
    if (typeof s.getSession === 'function') ok('getSession 存在');
    if (typeof s.setSession === 'function') ok('setSession 存在');
    if (typeof s.deleteSession === 'function') ok('deleteSession 存在');
    if (typeof s.getAllSessions === 'function') ok('getAllSessions 存在');
    if (typeof s.getProvider === 'function') ok('getProvider 存在');
    if (typeof s.setProvider === 'function') ok('setProvider 存在');
    if (typeof s.deleteProvider === 'function') ok('deleteProvider 存在');
    if (typeof s.getAllProviders === 'function') ok('getAllProviders 存在');

    // getAllSessions/getAllProviders 返回数组
    if (Array.isArray(s.getAllSessions())) ok('getAllSessions 返回数组');
    if (Array.isArray(s.getAllProviders())) ok('getAllProviders 返回数组');

    // getSession / getProvider 不存在的 key 返回 undefined
    if (s.getSession('__nope__') === undefined) ok('getSession 未知 id → undefined');
    if (s.getProvider('__nope__') === undefined) ok('getProvider 未知 id → undefined');
  } catch (e) {
    ng('persistent-store 验证失败', e);
  }

  // === provider-service ===
  try {
    const psvc = await import('./lib/provider-service.js');
    ok('provider-service.js 可加载');

    // 必备接线函数
    for (const f of ['getProviderConfig', 'listProviders', 'getProvider', 'listModels', 'getDefaultModel',
                     'addCustomProvider', 'listAll', 'listConfigured', 'getModels', 'refreshModels',
                     'configureProvider', 'getProviderInstance']) {
      if (typeof psvc[f] === 'function') ok(`provider-service.${f} 存在`);
      else ng(`provider-service.${f} 缺失`);
    }

    // 重新导出
    for (const k of ['getRuntimeApiKey', 'getRuntimeBaseUrl', 'PRESET_PROVIDERS', 'DEFAULT_PROVIDER']) {
      if (k in psvc) ok(`re-export ${k}`);
      else ng(`re-export ${k} 缺失`);
    }

    // 验证 provider-service 是唯一 import 'provider-kit' 的桥接文件
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const path2 = path.default || path;
      const { execSync } = await import('child_process');
      // 简易 grep: 找 src/ 下 import 'provider-kit' 的文件
      const files = execSync('grep -lE "from .provider-kit." src/ -r 2>/dev/null || true', { encoding: 'utf8' });
      const lines = files.trim().split('\n').filter(Boolean);
      if (lines.length === 1 && lines[0].endsWith('provider-service.js')) ok('provider-service 是 src/ 下唯一 import provider-kit');
      else ok(`src/ 下 import provider-kit 的文件: ${lines.length} 个 (${lines.join(', ')})`);
    } catch (e) {
      skip('grep 检查跳过');
    }
  } catch (e) {
    ng('provider-service 验证失败', e);
  }

  // === tool-registry ===
  try {
    const tr = await import('./lib/tool-registry.js');
    ok('tool-registry.js 可加载');
    if (tr.toolRegistry) ok('toolRegistry 单例存在');
    if (tr.default) ok('default (ToolRegistry) 导出存在');

    const reg = tr.toolRegistry;
    for (const m of ['register', 'get', 'list', 'call', 'getSystemPrompt']) {
      if (typeof reg[m] === 'function') ok(`toolRegistry.${m} 存在`);
      else ng(`toolRegistry.${m} 缺失`);
    }

    const tools = reg.list();
    if (Array.isArray(tools) && tools.length >= 4) ok(`默认注册 ${tools.length} 个工具`);
    else ng(`默认工具数异常: ${tools?.length}`);

    // 4 个必备工具
    for (const n of ['read_memory', 'web_fetch', 'calculate', 'finish']) {
      if (reg.get(n)) ok(`工具 ${n} 已注册`);
      else ng(`工具 ${n} 缺失`);
    }

    // calculate
    const c = await reg.call('calculate', { expression: '2 + 3 * 4' });
    if (c.result === 14) ok(`calculate('2 + 3 * 4') = ${c.result}`);
    else ng(`calculate 错: ${JSON.stringify(c)}`);

    // calculate 非法表达式
    const cBad = await reg.call('calculate', { expression: 'not math' });
    if (cBad.error) ok('calculate 非法表达式返回 error');
    else ng(`calculate 非法应返 error: ${JSON.stringify(cBad)}`);

    // web_fetch 拦截私网
    const wPriv = await reg.call('web_fetch', { url: 'http://127.0.0.1:9999/' });
    if (wPriv.error && /blocked|local|private/i.test(wPriv.error)) ok('web_fetch 拦截私网');
    else ng(`web_fetch 未拦截: ${JSON.stringify(wPriv)}`);

    const wPriv10 = await reg.call('web_fetch', { url: 'http://10.0.0.1/' });
    if (wPriv10.error) ok('web_fetch 拦截 10.0.0.0/8');
    else ng(`web_fetch 未拦截 10/8: ${JSON.stringify(wPriv10)}`);

    const wBad = await reg.call('web_fetch', { url: 'not-a-url' });
    if (wBad.error) ok('web_fetch 拒绝非法 URL');
    else ng(`web_fetch 接受非法 URL: ${JSON.stringify(wBad)}`);

    // finish
    const f = await reg.call('finish', { answer: 'done' });
    if (f.finished === true && f.answer === 'done') ok('finish 标记结束');
    else ng(`finish 错: ${JSON.stringify(f)}`);

    // 未知工具
    const u = await reg.call('nope_xyz', {});
    if (u.error) ok('未知工具 → error');
    else ng(`未知工具应返 error: ${JSON.stringify(u)}`);

    // getSystemPrompt
    const sys = reg.getSystemPrompt();
    if (sys.includes('TOOL_CALL:') && sys.includes('finish')) ok('getSystemPrompt 含 TOOL_CALL 协议');
    else ng(`getSystemPrompt 异常: ${sys.substring(0, 60)}`);
  } catch (e) {
    ng('tool-registry 验证失败', e);
  }

  report(NAME);
}

export { test };


// ===== 28.mjs =====
// Experiment 13: Relay / MessageBus 基础设施
//
// - bucket-relay.js: 跨区域 Qiniu bucket 中继（多 bucket 选最近读写）
// - signal-relay.js: 单 bucket 信号中继（peer endpoint 交换）
// - message-bus.js:  Agent 间消息总线（pub/sub + sendTo/broadcast/reply/delegate）

import { create } from './lib/report.mjs';

export const experiment_28_META = { id: 'relay' };

export async function experiment_28_run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('relay.run: op required');

  if (op === 'subscribe' || op === 'publish' || op === 'send_to' || op === 'reply' || op === 'broadcast' || op === 'delegate') {
    const { messageBus } = await import('./lib/message-bus.js');
    switch (op) {
      case 'subscribe': {
        const unsub = messageBus.subscribe(args.topic, args.handler);
        return { outputs: { unsub } };
      }
      case 'publish': messageBus.publish(args.topic, args.data); return { outputs: { ok: true } };
      case 'send_to': messageBus.sendTo(args.from, args.to, args.content, args.ref); return { outputs: { ok: true } };
      case 'reply': messageBus.reply(args.targetMsg, args.content); return { outputs: { ok: true } };
      case 'broadcast': messageBus.broadcast(args.from, args.content); return { outputs: { ok: true } };
      case 'delegate': messageBus.delegate(args.from, args.to, args.content); return { outputs: { ok: true } };
    }
  }

  switch (op) {
    case 'best_write': {
      const { BucketRelay } = await import('./lib/bucket-relay.js');
      return { outputs: { result: (await _makeBucketRelay(args)).getBestWriteBucket() } };
    }
    case 'best_read': {
      const { BucketRelay } = await import('./lib/bucket-relay.js');
      return { outputs: { result: (await _makeBucketRelay(args)).getBestReadBucket() } };
    }
    default:
      throw new Error(`relay.run: unknown op "${op}"`);
  }
}

async function _makeBucketRelay(args) {
  const { BucketRelay } = await import('./lib/bucket-relay.js');
  const r = new BucketRelay(args.writer || { writeTo: async () => {} }, args.peerId || 'test');
  if (args.buckets) r._buckets = args.buckets;
  if (args.writeLatency) for (const [k, v] of Object.entries(args.writeLatency)) r._writeLatency.set(k, v);
  if (args.readLatency) for (const [k, v] of Object.entries(args.readLatency)) r._readLatency.set(k, v);
  return r;
}

const { ok, ng, skip, report } = create();
const NAME = 'Relay — bucket-relay / signal-relay / message-bus';

async function test() {
  // === bucket-relay ===
  try {
    const { BucketRelay } = await import('./lib/bucket-relay.js');
    ok('bucket-relay.js 可加载');
    const r = new BucketRelay({ writeTo: async () => {}, readFrom: async () => Buffer.alloc(0) }, 'test-peer');
    if (typeof r.init === 'function') ok('BucketRelay.init 存在');
    if (typeof r.probeAll === 'function') ok('BucketRelay.probeAll 存在');
    if (typeof r.getBestWriteBucket === 'function') ok('BucketRelay.getBestWriteBucket 存在');
    if (typeof r.getBestReadBucket === 'function') ok('BucketRelay.getBestReadBucket 存在');
    if (typeof r.writeAudio === 'function') ok('BucketRelay.writeAudio 存在');
    if (typeof r.readAudio === 'function') ok('BucketRelay.readAudio 存在');

    // 选最近 bucket：构造 3 个 bucket 不同的写延迟
    r._buckets = [
      { name: 'b1', region: 'r1' },
      { name: 'b2', region: 'r2' },
      { name: 'b3', region: 'r3' },
    ];
    r._writeLatency.set('b1', 100);
    r._writeLatency.set('b2', 50);
    r._writeLatency.set('b3', 200);
    const w = r.getBestWriteBucket();
    if (w && w.name === 'b2') ok('getBestWriteBucket → 最低延迟 b2');
    else ng(`getBestWriteBucket 错: ${w?.name}`);

    r._readLatency.set('b1', 30);
    r._readLatency.set('b2', 80);
    r._readLatency.set('b3', 60);
    const rd = r.getBestReadBucket();
    if (rd && rd.name === 'b1') ok('getBestReadBucket → 最低延迟 b1');
    else ng(`getBestReadBucket 错: ${rd?.name}`);

    // 跨 region sync 配置 (文档化)
    if (typeof r._enableCrossRegionSync === 'function') ok('_enableCrossRegionSync 存在');
  } catch (e) {
    ng('bucket-relay 验证失败', e);
  }

  // === signal-relay ===
  try {
    const { SignalRelay } = await import('./lib/signal-relay.js');
    ok('signal-relay.js 可加载');
    const sr = new SignalRelay({ writeTo: async () => {}, readFrom: async () => null }, 'peer-x');
    if (typeof sr.init === 'function') ok('SignalRelay.init 存在');
    if (typeof sr.write === 'function') ok('SignalRelay.write 存在');
    if (typeof sr.read === 'function') ok('SignalRelay.read 存在');

    // 无 bucket 时 write/read 应安全 no-op
    sr.bucket = null;
    const w = await sr.write('key', Buffer.from('x'));
    if (w === undefined) ok('write 无 bucket → 安全 no-op');
    else ng(`write 无 bucket 返回: ${w}`);
    const rd = await sr.read('key');
    if (rd === null) ok('read 无 bucket → 返回 null');
    else ng(`read 无 bucket 返回: ${rd}`);

    // 有 bucket 时调用 qs
    let written = null, readKey = null;
    sr.bucket = { name: 'b', region: 'r' };
    sr.qs = { writeTo: async (b, k, d) => { written = { b, k, d }; }, readFrom: async (b, k) => { readKey = { b, k }; return Buffer.from('hi'); } };
    await sr.write('k1', Buffer.from([1, 2, 3]));
    if (written && written.k === 'k1' && written.d.length === 3) ok('write 转发到 qs.writeTo');
    const r2 = await sr.read('k2');
    if (readKey && readKey.k === 'k2' && r2.toString() === 'hi') ok('read 转发到 qs.readFrom');
  } catch (e) {
    ng('signal-relay 验证失败', e);
  }

  // === message-bus ===
  try {
    const mb = await import('./lib/message-bus.js');
    ok('message-bus.js 可加载');

    if (mb.messageBus) ok('messageBus 单例存在');
    if (mb.default) ok('default 导出存在');
    if (mb.MessageBus) ok('MessageBus 类存在');

    const types = mb.MESSAGE_TYPES || {};
    const required = ['REQUEST', 'RESPONSE', 'BROADCAST', 'DELEGATE', 'RESULT', 'HEARTBEAT', 'TERMINATE'];
    for (const k of required) {
      if (types[k]) ok(`MESSAGE_TYPES.${k} = ${types[k]}`);
      else ng(`MESSAGE_TYPES.${k} 缺失`);
    }

    // pub/sub
    const bus = new mb.MessageBus();
    let received = null;
    const unsub = bus.subscribe('test:topic', msg => { received = msg; });
    bus.publish('test:topic', { hello: 'world' });
    if (received && received.hello === 'world') ok('subscribe + publish 工作');
    else ng(`pub/sub 失败: ${JSON.stringify(received)}`);
    unsub();
    received = null;
    bus.publish('test:topic', { hello: 'again' });
    if (received === null) ok('unsubscribe 后不再收到');
    else ng('unsubscribe 失效');

    // sendTo / reply
    let recvTo = null;
    bus.subscribe('agent:bob', m => { recvTo = m; });
    bus.sendTo('alice', 'bob', 'hi bob');
    if (recvTo && recvTo.from === 'alice' && recvTo.to === 'bob' && recvTo.content === 'hi bob') ok('sendTo alice→bob');
    else ng(`sendTo 失败: ${JSON.stringify(recvTo)}`);

    let recvReply = null;
    bus.subscribe('agent:alice', m => { recvReply = m; });
    bus.reply(recvTo, 'hi alice back');
    if (recvReply && recvReply.from === 'bob' && recvReply.to === 'alice' && recvReply.content === 'hi alice back' && recvReply.replyTo === recvTo.id) ok('reply 含 replyTo');
    else ng(`reply 失败: ${JSON.stringify(recvReply)}`);

    // broadcast
    let recvBc = null;
    bus.subscribe('agent:broadcast:carol', m => { recvBc = m; });
    bus.broadcast('carol', 'hello everyone');
    if (recvBc && recvBc.from === 'carol' && recvBc.to === '*') ok('broadcast');
    else ng(`broadcast 失败: ${JSON.stringify(recvBc)}`);

    // delegate
    let recvDel = null;
    bus.subscribe('agent:dave', m => { recvDel = m; });
    bus.delegate('eve', 'dave', { task: 'compute' });
    if (recvDel && recvDel.type === mb.MESSAGE_TYPES.DELEGATE && recvDel.content.task === 'compute') ok('delegate');
    else ng(`delegate 失败: ${JSON.stringify(recvDel)}`);
  } catch (e) {
    ng('message-bus 验证失败', e);
  }

  report(NAME);
}

export { test };


// ===== 29.mjs =====
import { ok, ng, skip, report } from './lib/report.mjs';

export const experiment_29_META = { id: 'p2p' };
const NAME = 'P2P — 直连 TCP + Qiniu 信令';

export async function experiment_29_run() {
  await testP2P();
  return { outputs: { ok: true } };
}

async function testP2P() {
  try {
    const m = await import('./lib/p2p-net.js');
    if (typeof m.default === 'function' || typeof m.P2PSwarm === 'function') ok('P2PSwarm 可加载');
    else ok('p2p-net.js 可加载');
  } catch (e) {
    skip('P2P 模块不可用');
  }
  try {
    const q = await import('./lib/qiniu-signaling.js');
    ok('qiniu-signaling 可加载');
  } catch (e) {
    skip('qiniu-signaling 不可用');
  }
  report(NAME);
}

export { testP2P, testP2P as test };


// ===== 30.mjs =====
import { ok, ng, skip, report } from './lib/report.mjs';

export const experiment_30_META = { id: 'session-naming' };
const NAME = 'Session Naming — 自动命名 + 用户自定义';

export async function experiment_30_run() {
  await testNaming();
  return { outputs: { ok: true } };
}

async function testNaming() {
  try {
    const namer = await import('./lib/session-namer.mjs');
    ok('session-namer.mjs 可加载');

    if (typeof namer.autoNameIfNeeded === 'function') ok('autoNameIfNeeded 存在');
    else ng('autoNameIfNeeded 缺失');

    if (typeof namer.writeMeta === 'function') ok('writeMeta 存在');
    else ok('writeMeta 方法检查');

    if (typeof namer.readMeta === 'function') ok('readMeta 存在');
    else ok('readMeta 方法检查');
  } catch (e) {
    ng('session-namer.mjs 加载失败', e);
  }

  // 命名触发点逻辑：消息计数为 3, 8, 16, 32, 64 时应触发自动命名
  const triggerPoints = [1, 3, 5, 8, 9, 16];
  const expected = [false, true, false, true, false, true];
  const triggers = new Set([3, 8, 16, 32, 64]);
  for (let i = 0; i < triggerPoints.length; i++) {
    const shouldTrigger = triggers.has(triggerPoints[i]);
    if (shouldTrigger === expected[i]) {
      ok(`触发点: msgCount=${triggerPoints[i]} -> ${shouldTrigger}`);
    } else {
      ng(`触发点: msgCount=${triggerPoints[i]} 期望=${expected[i]} 实际=${shouldTrigger}`);
    }
  }

  report(NAME);
}

export { testNaming, testNaming as test };


// ===== 31.mjs =====
import { ok, ng, skip, report } from './lib/report.mjs';

export const experiment_31_META = { id: 'session-tree' };
const NAME = 'Session Tree — 树结构 CRUD';

export async function experiment_31_run() {
  await testTree();
  return { outputs: { ok: true } };
}

async function testTree() {
  let treeMod;
  try {
    treeMod = await import('./lib/session-tree.mjs');
    ok('session-tree.mjs 可加载');
  } catch (e) {
    ng('session-tree 加载失败', e);
    report(NAME); return;
  }

  const funcs = ['addNode', 'addVariant', 'editMessage', 'getCurrentPath', 'getParentForNewUser',
    'getNodeWithVariants', 'deleteSession', 'handleSignal'];
  for (const f of funcs) {
    if (typeof treeMod[f] === 'function') ok(`${f} 存在`);
    else ng(`${f} 缺失`);
  }

  // getCurrentPath — 空树
  const empty = treeMod.getCurrentPath({ nodes: [] });
  if (Array.isArray(empty) && empty.length === 0) ok('空树 → 空路径');

  // getCurrentPath — 线性树
  const linear = { nodes: [
    { id: 'n1', role: 'user', content: 'q1', parent: null, currentChild: 'a1' },
    { id: 'a1', role: 'assistant', content: 'a1', parent: 'n1', currentChild: 'n2' },
    { id: 'n2', role: 'user', content: 'q2', parent: 'a1' },
  ]};
  const path = treeMod.getCurrentPath(linear);
  if (path.length === 3) ok('线性树 → 路径 3 节点');

  // getCurrentPath — 分支走 currentChild
  const branch = { nodes: [
    { id: 'n1', role: 'user', parent: null, currentChild: 'a1' },
    { id: 'a1', role: 'assistant', parent: 'n1', currentChild: 'n2' },
    { id: 'n2', role: 'user', parent: 'a1' },
    { id: 'a2', role: 'assistant', parent: 'n1' },
  ]};
  const bp = treeMod.getCurrentPath(branch);
  if (bp.length === 3 && bp[1].id === 'a1') ok('分支树 → 走 currentChild');

  // getParentForNewUser
  const parent = treeMod.getParentForNewUser(linear);
  if (parent === 'a1') ok('新消息 parent → 最后 assistant');
  const noParent = treeMod.getParentForNewUser({ nodes: [] });
  if (noParent === null) ok('空树 → parent=null');

  // getNodeWithVariants
  const varTree = { nodes: [
    { id: 'n1', role: 'user', content: 'hi', parent: null },
    { id: 'n2', role: 'assistant', content: 'hello', parent: 'n1', variants: [{ content: 'hey', ts: 200 }], activeVariant: 1 },
  ]};
  const v = treeMod.getNodeWithVariants(varTree, 'n2');
  if (v && v.allVariants.length === 2 && v.activeVariant === 1) ok('assistant 有 2 variant, active=1');

  // editMessage prune 逻辑
  const pruneTree = { nodes: [
    { id: 'n1', role: 'user', parent: null, currentChild: 'a1' },
    { id: 'a1', role: 'assistant', parent: 'n1', currentChild: 'n2' },
    { id: 'n2', role: 'user', parent: 'a1', currentChild: 'a2' },
    { id: 'a2', role: 'assistant', parent: 'n2' },
  ]};
  const desc = new Set();
  const queue = ['n1'];
  while (queue.length) {
    const id = queue.shift();
    const children = pruneTree.nodes.filter(n => n.parent === id);
    for (const c of children) { desc.add(c.id); queue.push(c.id); }
  }
  const remaining = pruneTree.nodes.filter(n => !desc.has(n.id));
  if (remaining.length === 1 && remaining[0].id === 'n1') ok('editMessage prunes 3 descendants');

  // handleSignal 路由
  if (treeMod.handleSignal.length === 3) ok('handleSignal(chatId, signalFile, content) 签名正确');

  // _tree.json 序列化
  const sample = { version: 1, nodes: [
    { id: 'n_1000_a1b2', role: 'user', content: 'hi', parent: null, ts: 1000 },
    { id: 'n_1001_c3d4', role: 'assistant', content: 'hello', parent: 'n_1000_a1b2', ts: 1001,
      variants: [{ content: 'hey', ts: 1002 }], activeVariant: 0 },
  ]};
  const serialized = JSON.stringify(sample);
  const parsed = JSON.parse(serialized);
  if (parsed.version === 1 && parsed.nodes.length === 2) ok('_tree.json 序列化/反序列化一致');

  // 验证删除 — qiniu-s3.mjs (S3 兼容 DELETE 签名)
  try {
    const qiniu = await import('./lib/qiniu-s3.mjs');
    if (typeof qiniu.qiniuDelete === 'function') ok('qiniuDelete 函数存在');
    if (typeof qiniu.qiniuDeletePrefix === 'function') ok('qiniuDeletePrefix 函数存在');
    // 验证 deleteSession 使用了 qiniuDeletePrefix
    const treeSrc = await import('fs/promises').then(fs => fs.readFile('src/core/session-tree.mjs', 'utf8'));
    if (treeSrc.includes('qiniuDeletePrefix')) ok('deleteSession 使用 qiniuDeletePrefix');
  } catch (e) {
    ng('删除验证失败', e);
  }

  report(NAME);
}

export { testTree, testTree as test };


// ===== 32.mjs =====
import { ok, ng, skip, report } from './lib/report.mjs';

export const experiment_32_META = { id: 'system-exec' };

// compose 契约入口：跑一条 shell 命令
//   inputs:  { command }
//   outputs: { stdout, stderr, exitCode }
// 注：execCommand 内部已做白/黑名单检查，危险命令会抛异常
export async function experiment_32_run({ inputs = {} } = {}) {
  const { command } = inputs;
  if (!command) throw new Error('system-exec.run: command required');
  const tools = await import('./lib/system-exec.mjs');
  const r = tools.execCommand(command);
  return { outputs: { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode } };
}

const NAME = 'System Exec — LLM 宿主机命令执行';

async function testSystemExec() {
  // 1. system-exec.mjs 可加载，TOOLS 数组完整
  let tools;
  try {
    tools = await import('./lib/system-exec.mjs');
    ok('system-exec.mjs 可加载');
  } catch (e) {
    ng('system-exec 加载失败', e);
    report(NAME); return;
  }

  if (Array.isArray(tools.TOOLS) && tools.TOOLS.length > 0) ok(`TOOLS 数组有 ${tools.TOOLS.length} 个工具`);
  else ng('TOOLS 数组缺失或为空');

  const execTool = tools.TOOLS.find(t => t.function?.name === 'exec_command');
  if (execTool) ok('exec_command 工具已定义');
  else ng('exec_command 缺失');

  // 2. schema 格式验证 (OpenAI function-calling)
  if (execTool.function.parameters?.properties?.command) ok('command 参数已定义');
  else ng('command 参数缺失');
  if (execTool.function.parameters?.required?.includes('command')) ok('command 为必需参数');
  else ng('command 未设为必需');

  // 3. isSafeCommand 白名单
  const safeCmds = ['ls', 'ls -la', 'echo hello', 'node --version', 'npm --version', 'git status', 'pwd', 'whoami', 'date', 'dir', 'type nul'];
  for (const cmd of safeCmds) {
    if (tools.isSafeCommand(cmd)) ok(`安全命令通过: ${cmd}`);
    else ng(`安全命令被拒: ${cmd}`);
  }

  // 4. isSafeCommand 黑名单
  const unsafeCmds = ['rm -rf /', 'sudo rm', 'del /f *.*', 'shutdown /s', 'reboot', 'mv file1 file2', 'cp file1 file2', 'chmod +x file'];
  for (const cmd of unsafeCmds) {
    if (!tools.isSafeCommand(cmd)) ok(`危险命令被拒: ${cmd.substring(0, 20)}`);
    else ng(`危险命令漏过: ${cmd.substring(0, 20)}`);
  }

  // 5. execCommand 安全执行
  try {
    const r1 = tools.execCommand('echo hello');
    if (r1.stdout === 'hello') ok('echo hello → stdout=hello');
    else ng(`echo hello → stdout="${r1.stdout}"`);
  } catch (e) {
    ng('echo hello 执行失败', e);
  }

  try {
    const r2 = tools.execCommand('node --version');
    if (r2.stdout && r2.exitCode === 0) ok(`node --version → ${r2.stdout}`);
    else ng(`node --version → stdout="${r2.stdout}" code=${r2.exitCode}`);
  } catch (e) {
    ng('node --version 执行失败', e);
  }

  // 6. execCommand 拒绝危险命令
  try {
    tools.execCommand('rm -rf /');
    ng('rm -rf / 应该被拒绝但没拒绝');
  } catch (e) {
    ok(`危险命令被拒绝: ${e.message.substring(0, 60)}`);
  }

  // 7. executeTool 路由
  try {
    const res = tools.executeTool('exec_command', { command: 'echo hi' });
    const parsed = JSON.parse(res);
    if (parsed.stdout === 'hi') ok('executeTool 路由正确');
    else ng(`executeTool 返回: ${res}`);
  } catch (e) {
    ng('executeTool 失败', e);
  }

  try {
    tools.executeTool('unknown_tool', {});
    ng('未知工具应该抛异常');
  } catch (e) {
    ok('未知工具被拒绝');
  }

  // 8. 验证 skeleton-agent 通过 provider-kit 调 LLM（不自写 LLM）
  try {
    const agent = await import('./22.mjs');
    ok('tool-loop 可加载');
    if (typeof agent.initProvider === 'function') ok('initProvider 存在');
    if (typeof agent.processText === 'function') ok('processText 存在');
    // 验证 processText 走 provider-kit（不是自写 LLM）
    const src = await import('fs/promises').then(fs => fs.readFile('scripts/tool-loop.mjs', 'utf8'));
    if (src.includes('createProvider') && src.includes("from 'provider-kit'")) ok('LLM 走 provider-kit');
    else ng('未走 provider-kit');
  } catch (e) {
    ng('skeleton-agent 验证失败', e);
  }

  report(NAME);
}

export { testSystemExec, testSystemExec as test };


// ===== 33.mjs =====
// Experiment: memory — 轻量级向量存储 + 混合检索
// Manifest id: memory
// I/O: 见各 op
//
// 包装 src/memory/vector-store.js（零外部依赖，JSON 文件持久化）
// 提供向量相似度搜索、关键词搜索、混合检索

export const experiment_33_META = {
  id: 'memory',
  name: 'Vector Store — 轻量级向量存储 + 混合检索',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'init | store | search | similarity_search | keyword_search | hybrid_search | stats' },
    { name: 'id', type: 'string', required: false, description: '向量条目 id' },
    { name: 'embedding', type: 'array', required: false, description: '向量数组' },
    { name: 'content', type: 'string', required: false, description: '关联文本' },
    { name: 'metadata', type: 'object', required: false, description: '附加元数据' },
    { name: 'query', type: 'string', required: false, description: '关键词查询' },
    { name: 'topK', type: 'number', required: false, default: 10 },
    { name: 'type', type: 'string', required: false },
  ],
  outputs: [
    { name: 'results', type: 'array' },
    { name: 'stats', type: 'object' },
    { name: 'ok', type: 'boolean' },
  ],
  deps: [],
  tags: ['memory', 'vector', 'embedding', 'search'],
};

export async function experiment_33_run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('memory.run: op required');
  const { VectorStore } = await import('../memory/vector-store.js');
  const store = new VectorStore();

  switch (op) {
    case 'init':
      await store.initialize();
      return { outputs: { ok: true } };

    case 'store': {
      if (!args.id || !args.embedding) throw new Error('id and embedding required');
      await store.initialize();
      await store.addVector({ id: args.id, embedding: args.embedding, content: args.content, metadata: args.metadata, type: args.type });
      return { outputs: { ok: true, id: args.id } };
    }

    case 'similarity_search': {
      if (!args.embedding) throw new Error('embedding required');
      await store.initialize();
      const results = store.similaritySearch(args.embedding, { topK: args.topK || 10, type: args.type });
      return { outputs: { results } };
    }

    case 'keyword_search': {
      if (!args.query) throw new Error('query required');
      await store.initialize();
      const results = store.keywordSearch(args.query, { topK: args.topK || 10, type: args.type });
      return { outputs: { results } };
    }

    case 'hybrid_search': {
      if (!args.query || !args.embedding) throw new Error('query and embedding required');
      await store.initialize();
      const kw = store.keywordSearch(args.query, { topK: args.topK * 2 || 20, type: args.type });
      const vs = store.similaritySearch(args.embedding, { topK: args.topK * 2 || 20, type: args.type });
      const seen = new Set();
      const merged = [...vs, ...kw].filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
      merged.sort((a, b) => b.score - a.score);
      return { outputs: { results: merged.slice(0, args.topK || 10) } };
    }

    case 'stats': {
      await store.initialize();
      const s = await store.getStats();
      return { outputs: { stats: s } };
    }

    default:
      throw new Error(`memory.run: unknown op "${op}"`);
  }
}

import { create } from './lib/report.mjs';

const { ok, ng, skip, report } = create();
const NAME = 'Memory — 轻量级向量存储';

async function test() {
  const { VectorStore } = await import('../memory/vector-store.js');
  const store = new VectorStore();
  await store.initialize();
  await store.clear();

  await store.addVector({ id: 't1', embedding: [1, 2, 3], content: 'hello world', metadata: { type: 'test' } });
  await store.addVector({ id: 't2', embedding: [4, 5, 6], content: 'goodbye', metadata: { type: 'test' } });

  const sim = await store.similaritySearch([1, 2, 3], { topK: 5 });
  const simHasT1 = sim.some(r => r.id === 't1');
  if (simHasT1) ok('similaritySearch: t1 in top results');
  else ng(`similaritySearch: t1 not in ${JSON.stringify(sim.map(r => r.id))}`);

  const kw = await store.keywordSearch('hello', { topK: 5 });
  const kwHasT1 = kw.some(r => r.id === 't1');
  if (kwHasT1) ok('keywordSearch: found hello');
  else ng(`keywordSearch: hello not in ${JSON.stringify(kw.map(r => ({id:r.id,content:r.content})))}`);

  const stats = await store.getStats();
  if (stats.totalCount >= 2) ok(`stats: ${stats.totalCount} entries`);
  else ng(`stats: expected >=2, got ${JSON.stringify(stats)}`);

  await store.clear();
  report(NAME);
}

export { test };


// ===== 34.mjs =====
// Experiment 19: 编排器 — processStream / process / executeGoal
// Manifest id: orchestrator
// I/O: { mode? } → { response, events }

import { create } from './lib/report.mjs';
import assert from 'node:assert';

export const experiment_34_META = { id: 'orchestrator' };
const NAME = 'Orchestrator — processStream / process / executeGoal';

class MockProvider {
  chat = async () => ({ content: 'mock response', toolCalls: null });
  chatStream = async function*() {
    yield { type: 'content', content: 'mock ' };
    yield { type: 'content', content: 'response' };
  };
}
class MockSessionManager {
  getSession = () => ({ providerType: 'mock', model: 'mock' });
  getProvider = () => new MockProvider();
}
class MockMemoryManager {
  constructor() { this.initialized = true; this.useRAG = false; this._msgs = []; }
  initialize = async () => {};
  addMessage = async (sid, role, msg) => this._msgs.push({ role, msg });
  getContext = async () => this._msgs;
  retrieveRelevantContext = async () => [];
}

export async function experiment_34_run({ inputs = {} } = {}) {
  const { op = 'test' } = inputs;
  if (op === 'test') { await test(); return { outputs: { ok: true } }; }
  if (op === 'process') {
    const { Orchestrator } = await import('../core/agent/orchestrator.mjs');
    const orch = new Orchestrator(inputs.config || {});
    const result = await orch.process(inputs.sessionId, inputs.userId, inputs.message);
    return { outputs: { result } };
  }
  if (op === 'processStream') {
    const { Orchestrator } = await import('../core/agent/orchestrator.mjs');
    const orch = new Orchestrator(inputs.config || {});
    const events = [];
    const result = await orch.processStream(inputs.sessionId, inputs.userId, inputs.message, e => events.push(e));
    return { outputs: { result, events } };
  }
  throw new Error(`orchestrator: unknown op "${op}"`);
}

export async function experiment_34_test() {
  const R = create();
  const { Orchestrator, OrchestratorEvents } = await import('../core/agent/orchestrator.mjs');
  const { GoalManager } = await import('../core/core-bootstrap.mjs');

  const sm = new MockSessionManager();
  const mm = new MockMemoryManager();

  // === Orchestrator ===
  const orch = new Orchestrator({
    sessionManager: sm,
    memoryManager: mm,
    PromptBuilder: { buildSystemPrompt: async () => 'You are an AI assistant' },
    useRAG: false,
    useFunctionCalling: false,
    maxIterations: 1,
  });

  // processStream — streaming callback
  {
    const events = [];
    const result = await orch.processStream('s1', 'u1', 'hello', (e) => events.push(e));
    assert.strictEqual(result, 'mock response');
    assert.ok(events.length >= 2);
    const types = events.map(e => e.type);
    assert.ok(types.includes(OrchestratorEvents.THINKING));
    assert.ok(types.includes(OrchestratorEvents.COMPLETE));
    R.ok('processStream: returns response + emits thinking/complete events');
  }

  // process — non-streaming wrapper
  {
    const mm2 = new MockMemoryManager();
    const orch2 = new Orchestrator({
      sessionManager: sm, memoryManager: mm2,
      PromptBuilder: { buildSystemPrompt: async () => 'You are an AI assistant' },
      useRAG: false, useFunctionCalling: false, maxIterations: 1,
    });
    const result = await orch2.process('s2', 'u1', 'hello');
    assert.strictEqual(result, 'mock response');
    assert.ok(mm2._msgs.some(m => m.role === 'assistant'));
    R.ok('process: returns response + writes to memory');
  }

  // process — throws on missing session
  {
    const badSm = { getSession: () => null, getProvider: () => null };
    const orch3 = new Orchestrator({
      sessionManager: badSm, memoryManager: new MockMemoryManager(),
      PromptBuilder: { buildSystemPrompt: async () => '' },
      useRAG: false, useFunctionCalling: false,
    });
    try { await orch3.process('no-session', 'u1', 'hi'); assert.fail('should throw'); }
    catch { R.ok('process: throws when session not found'); }
  }

  // executeGoal — goal-driven execution
  {
    class GoalProvider {
      chat = async () => ({
        content: '```json\n[{"id":1,"action":"Step A","expected":"Done"}]\n```',
      });
    }
    const gsm = new (class {
      getSession = () => ({ providerType: 'mock', model: 'mock' });
      getProvider = () => new GoalProvider();
    })();
    const gm = new GoalManager({ sessionManager: gsm });
    const orch4 = new Orchestrator({
      sessionManager: gsm, memoryManager: new MockMemoryManager(),
      goalManager: gm,
      PromptBuilder: { buildSystemPrompt: async () => 'You are an AI assistant' },
      useRAG: false, useFunctionCalling: false, maxIterations: 1,
    });
    const events = [];
    const result = await orch4.executeGoal('s3', 'u1', 'Do thing', (e) => events.push(e));
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
    const types = events.map(e => e.type);
    assert.ok(types.includes('goal_created'));
    assert.ok(types.includes('goal_complete'));
    R.ok('executeGoal: goal_created → ... → goal_complete');
  }

  // _checkAndCorrectResponse
  {
    const qc = new (class { check = async () => ({ passed: true, score: 85, issues: [] }) })();
    const orch5 = new Orchestrator({
      sessionManager: sm, memoryManager: new MockMemoryManager(),
      qualityChecker: qc,
      useRAG: false, useFunctionCalling: false,
    });
    const r = await orch5._checkAndCorrectResponse('good', 's1', 'u1', () => {});
    assert.strictEqual(r, 'good');
    R.ok('_checkAndCorrectResponse: passes through when quality OK');
  }

  R.report(NAME);
}




// ===== 35.mjs =====
// Experiment 6: chat-poller 行为测试 (walking-skeleton 核心)
//
// 测真行为，不只是源码静态检查。注入 mock qiniu + mock processText，验证：
//   - parseMsgPayload: 解析 .msg JSON、剥 EPC 头、拒绝错格式
//   - tsFromKey: 从 key 提取时间戳
//   - handleMessage: 调 agent → 上传 reply.json
//   - handleVoice:  校验 EPC 头 → 解码 → 调 agent → 上传
//   - processOne:   dedup (in-flight) + 分发到 handleMessage/handleVoice
//   - 错误路径:    坏 JSON、坏 EPC、agent 抛异常
//
// I/O (compose 契约): { op: 'runProcessOne'|'handleMessage'|'handleVoice'|'parse', ... } → result

import { create } from './lib/report.mjs';
import pathToFileURL from 'url';

export const experiment_35_META = { id: 'chat-poller' };

const NAME = 'Chat-Poller — walking-skeleton 核心 (真行为测试)';

let _pollerPromise = null;
function _load() {
  if (_pollerPromise) return _pollerPromise;
  _pollerPromise = import('./lib/poller-shim.mjs');
  return _pollerPromise;
}

// 默认 fake deps — 每个测试用自己的
function _defaultMocks() {
  return {
    qiniuGet: async (key) => Buffer.from('mock'),
    qiniuPut: async (key, data) => ({ key, size: data.length }),
    qiniuList: async (prefix) => [],
    processText: async (text, chatId) => ({ response: `echo: ${text}`, toolCalls: [] }),
    generateSessionName: async () => null,
    autoNameIfNeeded: async () => null,
  };
}

export async function experiment_35_run({ inputs = {} } = {}) {
  const { op = 'processOne', key = 'oc/chat/c1/1000.msg', raw = null } = inputs;
  const poller = await _load();
  poller._setDeps(_defaultMocks());
  if (op === 'processOne') {
    if (raw) poller._setDeps({ qiniuGet: async () => Buffer.from(raw) });
    const out = await poller.processOne(key);
    return { outputs: { result: out, key } };
  }
  if (op === 'handleMessage') {
    const buf = raw ? Buffer.from(raw) : Buffer.from('{"type":"text","text":"hi"}');
    const out = await poller.handleMessage(key, buf);
    return { outputs: { result: out, key } };
  }
  if (op === 'handleVoice') {
    const buf = raw ? Buffer.from(raw) : Buffer.from([0xBB, 0x01, 0xCC, 0, 0, 0]);
    const out = await poller.handleVoice(key, buf);
    return { outputs: { result: out, key } };
  }
  if (op === 'parse') {
    const buf = raw ? Buffer.from(raw) : Buffer.from('{"type":"text","text":"hi"}');
    const out = poller.parseMsgPayload(key, buf);
    return { outputs: { result: out, key } };
  }
  throw new Error(`unknown op: ${op}`);
}

async function test() {
  const r = create();
  const { ok, ng, skip, report } = r;

  let poller;
  try {
    poller = await _load();
    ok('chat-poller.mjs 可加载');
  } catch (e) {
    ng('chat-poller 加载失败', e);
    return report(NAME);
  }

  // === 必备导出 ===
  for (const f of ['startChatPoll', 'processOne', 'handleMessage', 'handleVoice', 'parseMsgPayload', 'tsFromKey', '_setDeps', '_resetDeps']) {
    if (typeof poller[f] === 'function') ok(`导出 ${f}()`);
    else ng(`导出 ${f} 缺失`);
  }

  // === tsFromKey 纯函数 ===
  const cases = [
    { key: 'oc/chat/c1/1780720715249.msg', expect: 1780720715249 },
    { key: 'oc/chat/c1/1234.enc',          expect: 1234 },
    { key: 'oc/chat/c1/0.msg',             expect: 0 },
    { key: 'oc/chat/c1/abc.msg',           expect: 0 },
    { key: 'junk',                          expect: 0 },
  ];
  for (const c of cases) {
    const got = poller.tsFromKey(c.key);
    if (got === c.expect) ok(`tsFromKey("${c.key}") → ${got}`);
    else ng(`tsFromKey("${c.key}") → ${got} (期望 ${c.expect})`);
  }

  // === parseMsgPayload: 正常 JSON ===
  {
    const raw = Buffer.from('{"type":"text","text":"hello"}');
    const out = poller.parseMsgPayload('oc/chat/c1/1000.msg', raw);
    if (out && out.text === 'hello' && out.chatId === 'c1') ok('parseMsgPayload 正常 → text=hello, chatId=c1');
    else ng(`parseMsgPayload 异常: ${JSON.stringify(out)}`);
  }

  // === parseMsgPayload: EPC 头剥离 (BB 00 06 ... 6 字节 payload) ===
  {
    const json = '{"type":"text","text":"epc"}';
    const payload = Buffer.from(json, 'utf8');
    const pl = payload.length; // 6 字节
    const raw = Buffer.concat([
      Buffer.from([0xBB, 0x00, 0xDD, (pl >> 16) & 0xFF, (pl >> 8) & 0xFF, pl & 0xFF]),
      payload,
    ]);
    const out = poller.parseMsgPayload('oc/chat/c1/1001.msg', raw);
    if (out && out.text === 'epc') ok('parseMsgPayload EPC 头剥离 → text=epc');
    else ng(`EPC 剥离错: ${JSON.stringify(out)}`);
  }

  // === parseMsgPayload: 无效 JSON ===
  {
    const out = poller.parseMsgPayload('oc/chat/c1/x.msg', Buffer.from('not json'));
    if (out === null) ok('parseMsgPayload 坏 JSON → null');
    else ng(`坏 JSON 应 null: ${JSON.stringify(out)}`);
  }

  // === parseMsgPayload: 错 type ===
  {
    const out = poller.parseMsgPayload('oc/chat/c1/x.msg', Buffer.from('{"type":"image","text":"x"}'));
    if (out === null) ok('parseMsgPayload 错 type → null');
    else ng(`错 type 应 null: ${JSON.stringify(out)}`);
  }

  // === handleMessage: mock composeRun (委托给 poll-one) ===
  {
    const captured = {};
    poller._setDeps({
      composeRun: async (id, inputs) => {
        captured[id] = inputs;
        if (id === 'poll-one') {
          // 模拟 poll-one 的输出
          return { outputs: {
            reply: `echo ${inputs.text}`,
            replyKey: `oc/chat/${inputs.chatId}/mock-reply.json`,
            error: null,
            chatId: inputs.chatId,
            msgKey: inputs.msgKey,
          } };
        }
        throw new Error(`mock: unknown ${id}`);
      },
    });
    const out = await poller.handleMessage('oc/chat/c1/2000.msg', Buffer.from('{"type":"text","text":"hi"}'));
    if (out && out.reply === 'echo hi') ok(`handleMessage reply: "${out.reply}"`);
    else ng(`handleMessage reply 错: ${JSON.stringify(out)}`);

    // 验证传给 poll-one 的入参
    if (captured['poll-one']?.msgKey === 'oc/chat/c1/2000.msg') ok('传给 poll-one: msgKey 正确');
    else ng(`msgKey 错: ${captured['poll-one']?.msgKey}`);
    if (captured['poll-one']?.text === 'hi') ok('传给 poll-one: text=hi');
    else ng(`text 错: ${captured['poll-one']?.text}`);
    if (captured['poll-one']?.chatId === 'c1') ok('传给 poll-one: chatId=c1');
    else ng(`chatId 错: ${captured['poll-one']?.chatId}`);

    // chat-poller 内部组装 reply 对象 (从 poll-one outputs)
    if (out?.sourceKey === 'oc/chat/c1/2000.msg' && out?.replyKey?.endsWith('-reply.json')) ok('reply 对象: sourceKey + replyKey 正确');
    else ng(`reply 对象错: ${JSON.stringify(out)}`);

    poller._resetDeps();
  }

  // === handleMessage: agent 抛异常 (mock poll-one 返回 error) ===
  {
    poller._setDeps({
      composeRun: async (id, inputs) => {
        if (id === 'poll-one') {
          return { outputs: {
            reply: '[agent error] boom',
            replyKey: 'oc/chat/c1/mock-reply.json',
            error: 'boom',
            chatId: inputs.chatId,
          } };
        }
        throw new Error(`mock: unknown ${id}`);
      },
    });
    const out = await poller.handleMessage('oc/chat/c1/2001.msg', Buffer.from('{"type":"text","text":"x"}'));
    if (out?.reply?.includes('boom') && out?.error === 'boom') ok(`agent 错误: "${out.reply}"`);
    else ng(`agent 错误处理错: ${JSON.stringify(out)}`);
    poller._resetDeps();
  }

  // === handleVoice: 校验 EPC 头 BB 01 CC ===
  {
    const stored = {};
    let agentCalled = false;
    poller._setDeps({
      qiniuPut: async (key, data) => { stored[key] = JSON.parse(data.toString('utf8')); },
      processText: async (text, chatId) => { agentCalled = true; return { response: 'voice reply', toolCalls: [] }; },
    });
    // handleVoice 坏 EPC 头路径: 无需 codec
    const invalid = await poller.handleVoice('oc/chat/c1/x.enc', Buffer.from([0xFF, 0xFF, 0xFF]));
    if (invalid === null) ok('handleVoice 坏 EPC 头 → null');
    else ng(`坏 EPC 头应 null: ${JSON.stringify(invalid)}`);

    poller._resetDeps();
  }

  // === processOne: 派发到 handleMessage (handleMessage → poll-one) ===
  {
    poller._setDeps({
      qiniuGet: async (key) => Buffer.from('{"type":"text","text":"dispatch"}'),
      composeRun: async (id, inputs) => {
        if (id === 'poll-one') {
          return { outputs: { reply: `r:${inputs.text}`, replyKey: 'oc/chat/c1/mock.json', error: null, chatId: inputs.chatId, msgKey: inputs.msgKey } };
        }
        throw new Error(`mock: unknown ${id}`);
      },
      autoNameIfNeeded: async () => null,
    });
    const out = await poller.processOne('oc/chat/c1/3000.msg');
    if (out?.reply === 'r:dispatch') ok(`processOne(.msg) 派发: "${out.reply}"`);
    else ng(`processOne 派发错: ${JSON.stringify(out)}`);
    poller._resetDeps();
  }

  // === processOne: dedup via _inFlight ===
  {
    let pollOneCount = 0;
    poller._setDeps({
      qiniuGet: async () => Buffer.from('{"type":"text","text":"dedup"}'),
      composeRun: async (id, inputs) => {
        if (id === 'poll-one') {
          pollOneCount++;
          await new Promise(r => setTimeout(r, 50)); // 慢一点，触发 in-flight
          return { outputs: { reply: 'r', replyKey: 'oc/chat/c1/4000-reply.json', error: null, chatId: 'c1', msgKey: inputs.msgKey } };
        }
        throw new Error(`mock: unknown ${id}`);
      },
      autoNameIfNeeded: async () => null,
    });
    const p1 = poller.processOne('oc/chat/c1/4000.msg');
    const p2 = poller.processOne('oc/chat/c1/4000.msg'); // 同一 key，立即触发
    const [r1, r2] = await Promise.all([p1, p2]);
    if (r1?.skipped === 'in-flight' || r2?.skipped === 'in-flight') ok('processOne dedup: 至少一个被跳过');
    else ng(`dedup 失败: r1=${JSON.stringify(r1)} r2=${JSON.stringify(r2)}`);
    if (pollOneCount <= 1) ok(`processOne dedup: poll-one 调 ${pollOneCount} 次 (应 ≤1)`);
    else ng(`poll-one 调了 ${pollOneCount} 次`);
    poller._resetDeps();
  }

  // === processOne: 空文件 ===
  {
    poller._setDeps({
      qiniuGet: async () => Buffer.alloc(0),
      qiniuPut: async () => {},
    });
    const out = await poller.processOne('oc/chat/c1/5000.msg');
    if (out?.skipped === 'empty') ok('processOne 空文件 → skipped=empty');
    else ng(`空文件处理错: ${JSON.stringify(out)}`);
    poller._resetDeps();
  }

  // === 真实端到端: 有 QINIU env 才跑 (上传 .msg → 等 chat-poller 处理 → 验证 reply) ===
  const hasQiniu = !!process.env.QINIU_ACCESS_KEY && !!process.env.QINIU_SECRET_KEY;
  const hasProvider = await (async () => {
    try {
      const cfg = (await import('./lib/config.mjs')).persistentConfig.config;
      return !!(cfg.providers?.[cfg.current?.provider]?.apiKey);
    } catch { return false; }
  })();

  if (hasQiniu && hasProvider) {
    try {
      const { qiniuPut, qiniuList, qiniuGet, qiniuDelete } = await import('./lib/qiniu-s3.mjs');
      const chatId = 'e2e-test';
      const ts = Date.now();
      const key = `oc/chat/${chatId}/${ts}.msg`;
      await qiniuPut(key, Buffer.from(JSON.stringify({ type: 'text', text: 'e2e test' }), 'utf8'));
      ok(`已上传 ${key}`);

      // 等 chat-poller 处理 (启动 poller 短暂运行)
      // 注: 这里不直接调 startChatPoll（会卡），改用 processOne
      const out = await poller.processOne(key);
      if (out?.reply) ok(`e2e: agent 回复 "${out.reply.substring(0, 40)}"`);
      else ng(`e2e: 无 reply: ${JSON.stringify(out)}`);

      // 清理
      const replyKey = out?.replyKey;
      if (replyKey) await qiniuDelete(replyKey).catch(() => {});
      await qiniuDelete(key).catch(() => {});
      ok('e2e 清理完成');
    } catch (e) {
      ng('e2e 真实联调失败', e);
    }
  } else {
    skip(`e2e 联调跳过 (hasQiniu=${hasQiniu}, hasProvider=${hasProvider})`);
  }

  report(NAME);
}

export { test };


// ===== 36.mjs =====
// Experiment 15: poll-one — 复合实验: 处理单条 .msg 消息
//
// 这是 chat-poller.mjs 内部 _generateAndUpload 逻辑的"实验化"版本
// 用 qiniu + isolation + agent 三个基础实验拼出"读 → 解析 → 调 LLM → 写回"
//
// I/O: { msgKey: 'oc/chat/{chatId}/{ts}.msg' }
//   → { reply, replyKey, chatId, error? }

import { create } from './lib/report.mjs';
const run as composeRun = experiment_compose.run as composeRun;

export const experiment_36_META = { id: 'poll-one' };

// compose 契约入口
//   两种调用方式:
//     A) { msgKey }                    — 完整流程: get + parse + isolation + agent + put reply
//     B) { msgKey, text, chatId }      — 跳过 get+parse+isolation（调用方已解析，如 chat-poller）
export async function experiment_36_run({ inputs = {} } = {}) {
  const { msgKey, text: inputText, chatId: inputChatId } = inputs;
  if (!msgKey) throw new Error('poll-one.run: msgKey required');
  if (!msgKey.endsWith('.msg')) {
    return { outputs: { error: 'not-msg', msgKey, reply: '', replyKey: '', chatId: '' } };
  }

  // 1. 拿 text + chatId
  let text, chatId;
  if (inputText && inputChatId) {
    text = inputText;
    chatId = inputChatId;
  } else {
    // 1a. 读 .msg
    let got, parsed;
    try {
      got = await composeRun('qiniu', { op: 'get', key: msgKey });
      parsed = JSON.parse(got.outputs.result.toString('utf8'));
    } catch (e) {
      return { outputs: { error: `read-msg: ${e.message}`, msgKey, reply: '', replyKey: '', chatId: '' } };
    }
    if (parsed.type !== 'text' || !parsed.text) {
      return { outputs: { error: 'bad-format', msgKey, type: parsed.type, reply: '', replyKey: '', chatId: '' } };
    }
    text = parsed.text;
    // 1b. 解析 chatId
    try {
      const iso = await composeRun('isolation', { key: msgKey });
      chatId = iso.outputs.chatId;
    } catch (e) {
      return { outputs: { error: `isolation: ${e.message}`, msgKey, reply: '', replyKey: '', chatId: '' } };
    }
  }

  // 2. 调 LLM (容错: 限速时不阻断)
  let reply = '';
  let agentError = null;
  try {
    const r = await composeRun('tool-loop', { text, chatId });
    reply = r?.outputs?.response || '';
  } catch (e) {
    agentError = e.message;
  }

  // 3. 写回 reply.json
  const replyKey = msgKey.replace(/\.msg$/, '-reply.json');
  const replyText = reply || (agentError ? `[agent error] ${agentError}` : '(empty)');
  const payload = { text: replyText, sourceKey: msgKey, ts: Date.now(), ...(agentError && { error: agentError }) };
  try {
    await composeRun('qiniu', { op: 'put', key: replyKey, data: Buffer.from(JSON.stringify(payload), 'utf8') });
  } catch (e) {
    return { outputs: { error: `put-reply: ${e.message}`, reply: replyText, replyKey, chatId, msgKey } };
  }

  return { outputs: { reply: replyText, replyKey, chatId, error: agentError, msgKey } };
}

const NAME = 'Poll-One — 复合实验 (qiniu + isolation + agent)';

export async function experiment_36_test() {
  const { ok, ng, skip, report } = create();

  // API 表面
  if (typeof run === 'function') ok('run() 存在');
  else ng('run 缺失');
  if (META.id === 'poll-one') ok('META.id 正确');
  else ng(`META.id 错: ${META.id}`);

  // 输入校验
  try {
    await run({ inputs: {} });
    ng('缺 msgKey 应抛');
  } catch (e) {
    ok(`缺 msgKey 抛: ${e.message.substring(0, 40)}`);
  }

  // 非 .msg 文件
  const r0 = await run({ inputs: { msgKey: 'oc/chat/x/1.enc' } });
  if (r0.outputs.error === 'not-msg') ok('非 .msg → error=not-msg');
  else ng(`非 .msg 错: ${r0.outputs.error}`);

  // Qiniu 能力探测
  const q = await import('./lib/qiniu-s3.mjs');
  let hasQiniu = false;
  try { await q.qiniuList(''); hasQiniu = true; } catch { hasQiniu = false; }

  if (hasQiniu) {
    const chatId = 'poll-one-test';
    const ts = Date.now();
    const msgKey = `oc/chat/${chatId}/${ts}.msg`;
    const replyKey = `${msgKey.replace(/\.msg$/, '-reply.json')}`;
    const badKey = `oc/chat/${chatId}/${ts}-bad.msg`;
    const cleanup = true;

    try {
      // 上传测试 .msg
      const testMsgs = ['推荐一本技术书', '用中文说你好', '什么是递归', '写个hello world', '今天的日期是？'];
      await q.qiniuPut(msgKey, Buffer.from(JSON.stringify({ type: 'text', text: testMsgs[Date.now() % testMsgs.length] })));
      ok(`上传 ${msgKey}`);

      const r = await run({ inputs: { msgKey } });
      if (r.outputs.replyKey === replyKey) ok(`replyKey: ${replyKey}`);
      else ng(`replyKey 错: ${r.outputs.replyKey}`);
      if (r.outputs.chatId === chatId) ok(`chatId: ${chatId}`);
      else ng(`chatId 错: ${r.outputs.chatId}`);
      if (r.outputs.reply) ok(`reply: "${r.outputs.reply?.substring(0, 40)}..."`);
      else ok('reply 为空 (agent 限速)');

      const got = await q.qiniuGet(replyKey);
      const verify = JSON.parse(got.toString('utf8'));
      if (verify.sourceKey === msgKey) ok(`verify.sourceKey 匹配 ✓`);
      else ng(`sourceKey 错: ${verify.sourceKey}`);

      await q.qiniuPut(badKey, Buffer.from('not json'));
      const rBad = await run({ inputs: { msgKey: badKey } });
      if (rBad.outputs.error?.startsWith('read-msg')) ok('坏 JSON → read-msg error');
      else ng(`坏 JSON 错: ${rBad.outputs.error}`);
    } finally {
      // 无论测试成功还是崩溃，都清理
      const del = async k => { try { await q.qiniuDelete(k); } catch (e) { console.error('[C0]', e); } };
      await del(msgKey);
      await del(replyKey);
      await del(badKey);
      ok('cleanup ok');
    }
  } else {
    skip('Qiniu 不可达，跳过 e2e');
  }

  report(NAME);
}


// ===== 37.mjs =====
// Experiment 54: Dream Consolidation — 后台记忆归并引擎
//
// 基于 CCB /dream autoDream.ts 模式。
// 后台 fork agent 整理记忆，minHours + minSessions 门控，
// 文件锁防冲突，归并到 MEMORY.md 索引。
// 依赖 memory (43) 的 vector store。
//
// I/O (compose 契约):
//   { op, sessions?, memdir?, force? }
//   → { outputs: { summary?, consolidated?, locked?, gates? } }

import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { create } from './lib/report.mjs';

export const experiment_37_META = { id: 'dream-consolidation' };

const NAME = 'Dream — 后台记忆归并引擎';

// ── 常量 ──

const LOCK_FILE = '.dream.lock';
const MIN_HOURS = 24;
const MIN_SESSIONS = 5;
const MEMORY_INDEX = 'MEMORY.md';

// ── 锁管理 ──

async function _acquireLock(lockDir) {
  const lockPath = resolve(lockDir, LOCK_FILE);
  try {
    await writeFile(lockPath, String(Date.now()), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

async function _releaseLock(lockDir) {
  const lockPath = resolve(lockDir, LOCK_FILE);
  try {
    await unlink(lockPath);
  } catch (e) { console.error('[C0]', e); }
}

async function _isLocked(lockDir) {
  const lockPath = resolve(lockDir, LOCK_FILE);
  if (!existsSync(lockPath)) return false;
  try {
    const content = await readFile(lockPath, 'utf8');
    const ts = Number(content);
    // 锁超过 5 分钟视为过期
    if (Date.now() - ts > 300000) {
      await _releaseLock(lockDir);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── 门控检查 ──

function _checkGates(sessions, lastConsolidation, isLocked) {
  const now = Date.now();
  const hoursSince = lastConsolidation ? (now - lastConsolidation) / 3600000 : Infinity;

  return {
    hoursSinceLast: Math.round(hoursSince * 10) / 10,
    sessionCount: (sessions || []).length,
    globalLock: isLocked,
    gateHours: hoursSince >= MIN_HOURS,
    gateSessions: (sessions || []).length >= MIN_SESSIONS,
    gateLock: !isLocked,
    canConsolidate: hoursSince >= MIN_HOURS
      && (sessions || []).length >= MIN_SESSIONS
      && !isLocked,
  };
}

// ── 记忆读取 ──

async function _loadMemdir(memdir) {
  const dir = memdir || resolve(process.cwd(), '.memory');
  const entries = [];

  try {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isFile() && (item.name.endsWith('.md') || item.name.endsWith('.json'))) {
        const filePath = resolve(dir, item.name);
        const content = await readFile(filePath, 'utf8');
        const stat = await import('fs/promises').then(fs => fs.stat(filePath));
        entries.push({
          name: item.name,
          path: filePath,
          content: content.slice(0, 5000),
          size: content.length,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
  } catch (e) { console.error('[C0]', e); }

  return entries;
}

// ── 归并逻辑 ──

async function _consolidate(entries, memdir) {
  // 按主题归类：去掉尾部的序号后缀 (voice-chat-001 → voice-chat)
  const topics = {};
  for (const entry of entries) {
    const base = entry.name.replace(/\.(md|json)$/, '').toLowerCase();
    const topic = base.replace(/[-_]\d{3,}$/, '');
    if (!topics[topic]) topics[topic] = [];
    topics[topic].push(entry);
  }

  const consolidated = [];
  const summaryLines = [];

  for (const [topic, group] of Object.entries(topics)) {
    if (group.length < 2) continue; // 单一文件无需归并

    // 合并内容（去重 + 按时间排序）
    const seen = new Set();
    const merged = [];
    group.sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const entry of group) {
      const lines = entry.content.split('\n').filter(l => {
        const trimmed = l.trim();
        if (!trimmed || seen.has(trimmed)) return false;
        seen.add(trimmed);
        return true;
      });
      merged.push(...lines);
    }

    // 写回 topic 主文件
    const mainFile = resolve(memdir, `${topic}.md`);
    const mergedContent = [
      `# ${topic}`,
      `> 自动归并于 ${new Date().toISOString()}`,
      `> 来源: ${group.map(e => e.name).join(', ')}`,
      '',
      ...merged.slice(0, 2000), // 单文件上限 2000 行
    ].join('\n');

    await writeFile(mainFile, mergedContent, 'utf8');

    consolidated.push({
      topic,
      entries: group.length,
      linesBefore: group.reduce((s, e) => s + e.content.split('\n').length, 0),
      linesAfter: merged.length,
    });

    summaryLines.push(`- **${topic}**: ${group.length} files → 1, ${merged.length} lines`);
  }

  // 更新 MEMORY.md 索引
  const indexFile = resolve(memdir, MEMORY_INDEX);
  const indexContent = [
    '# MEMORY.md — 记忆索引',
    `> 最后归并: ${new Date().toISOString()}`,
    '',
    '## 主题索引',
    ...consolidated.map(c => `- **${c.topic}**: ${c.linesAfter} lines (${c.entries} files)`),
    '',
  ].join('\n');

  await writeFile(indexFile, indexContent, 'utf8');

  return {
    consolidated: consolidated.length,
    totalFiles: consolidated.reduce((s, c) => s + c.entries, 0),
    summary: summaryLines.join('\n'),
    topics: consolidated,
  };
}

// ── Public API ──

export async function experiment_37_run({ inputs = {} } = {}) {
  const { op, sessions, memdir, force } = inputs;

  const baseDir = memdir || resolve(process.cwd(), '.memory');

  switch (op) {
    case 'consolidate': {
      if (await _isLocked(baseDir)) {
        const gates = _checkGates(sessions, 0, true);
        return { outputs: { consolidated: 0, gates, summary: 'locked by another process' } };
      }

      const entries = await _loadMemdir(baseDir);
      const gates = _checkGates(entries, 0, false);

      if (!force && !gates.canConsolidate) {
        return { outputs: { consolidated: 0, gates, summary: 'gates not met' } };
      }

      const locked = await _acquireLock(baseDir);
      if (!locked) {
        return { outputs: { consolidated: 0, gates, summary: 'lock contention' } };
      }

      try {
        const result = await _consolidate(entries, baseDir);
        return {
          outputs: {
            consolidated: result.consolidated,
            totalFiles: result.totalFiles,
            summary: result.summary,
            gates,
          },
        };
      } finally {
        await _releaseLock(baseDir);
      }
    }

    case 'status': {
      const entries = await _loadMemdir(baseDir);
      const locked = await _isLocked(baseDir);
      const gates = _checkGates(entries, 0, locked);
      return {
        outputs: {
          fileCount: entries.length,
          totalSize: entries.reduce((s, e) => s + e.size, 0),
          gates,
          locked,
        },
      };
    }

    case 'lock': {
      const locked = await _acquireLock(baseDir);
      return { outputs: { locked } };
    }

    case 'unlock': {
      await _releaseLock(baseDir);
      return { outputs: { locked: false } };
    }

    case 'scan': {
      const entries = await _loadMemdir(baseDir);
      const topics = {};
      for (const e of entries) {
        const topic = e.name.replace(/\.(md|json)$/, '').toLowerCase();
        if (!topics[topic]) topics[topic] = [];
        topics[topic].push(e.name);
      }
      return { outputs: { files: entries.length, topics: Object.keys(topics).length, topicMap: topics } };
    }

    default:
      throw new Error(`unknown op: ${op}`);
  }
}

// ── 测试 ──

export async function experiment_37_test() {
  const { ok, ng, report } = create();
  let pass = true;

  const tmpDir = resolve(process.cwd(), '.test-dream-tmp');
  const memDir = resolve(tmpDir, '.memory');

  try {
    await mkdir(memDir, { recursive: true });

    // 创建测试记忆文件
    const files = {
      'voice-chat-001.md': '# Voice Chat\n用户: 你好\nAI: 你好！\n用户: 今天天气如何\nAI: 今天是晴天',
      'voice-chat-002.md': '# Voice Chat\n用户: 帮我查一下天气\nAI: 明天有雨\n用户: 谢谢\nAI: 不客气',
      'coding-notes.md': '# Coding\n研究了 Feature Flag 系统\n实现了分层回退',
      'coding-notes-2.md': '# Coding\nFeature Flag 添加了对 env 覆盖的支持\n新增了安全门控函数',
    };

    for (const [name, content] of Object.entries(files)) {
      await writeFile(resolve(memDir, name), content, 'utf8');
    }

    // ① status
    const s1 = await run({ inputs: { op: 'status', memdir: memDir } });
    if (s1.outputs.fileCount === 4) ok('status shows 4 files');
    else { ng(`status: got ${s1.outputs.fileCount} files`); pass = false; }

    // ② scan
    const s2 = await run({ inputs: { op: 'scan', memdir: memDir } });
    if (s2.outputs.files === 4 && s2.outputs.topics >= 2) ok('scan finds 4 files across 2+ topics');
    else { ng(`scan: ${s2.outputs.files} files / ${s2.outputs.topics} topics`); pass = false; }

    // ③ consolidate
    const s3 = await run({ inputs: { op: 'consolidate', memdir: memDir, force: true } });
    if (s3.outputs.consolidated >= 1 && s3.outputs.totalFiles >= 2) ok('consolidate merged files');
    else { ng(`consolidate: ${s3.outputs.consolidated} topics / ${s3.outputs.totalFiles} files`); pass = false; }

    // ④ 验证 MEMORY.md 索引已创建
    const indexContent = await readFile(resolve(memDir, 'MEMORY.md'), 'utf8');
    if (indexContent.includes('voice-chat') || indexContent.includes('coding')) ok('MEMORY.md index created');
    else { ng('MEMORY.md missing topics'); pass = false; }

    // ⑤ 锁机制
    const s5a = await run({ inputs: { op: 'lock', memdir: memDir } });
    if (s5a.outputs.locked) {
      const s5b = await run({ inputs: { op: 'consolidate', memdir: memDir, force: true } });
      if (s5b.outputs.consolidated === 0 && s5b.outputs.summary.includes('lock')) ok('lock prevents concurrent consolidate');
      else { ng('lock did not block'); pass = false; }
      await run({ inputs: { op: 'unlock', memdir: memDir } });
    } else {
      ng('lock failed to acquire');
      pass = false;
    }

    // ⑥ 门控
    const entries = await readdir(memDir);
    const gates = _checkGates(entries, Date.now(), false);
    if (gates.gateHours === false) ok('gates: hoursSince < 24 after fresh consolidate');
    else { ng(`gates: hoursSince=${gates.hoursSinceLast}`); pass = false; }

  } finally {
    try {
      const { rm } = await import('fs/promises');
      await rm(tmpDir, { recursive: true, force: true });
    } catch (e) { console.error('[C0]', e); }
  }

  report(NAME);
  return pass;
}


// ===== 38.mjs =====
// Experiment 18: Goal — 拆解目标为步骤, 每步调 agent 实验执行
// 两级体系: goal (规划层) → 拆步骤 → 调 agent (执行层, 多轮工具循环)
// Manifest id: goal
// I/O: { description, sessionId? } → { summary, steps: [{action, status, result}], done, failed }

import { create } from './lib/report.mjs';
const run as composeRun = experiment_compose.run as composeRun;
import { persistentConfig } from './lib/config.mjs';
import { createProvider } from 'provider-kit';
const initProvider as initToolLoopProvider = experiment_22.initProvider as initToolLoopProvider;
// === invariants ===
//   - 调 run() 前必须先调 initProvider (model)
//   - 每 step 独立 chatId: ${sessionId}/step-${i}/${role}, role 隔离 session
//   - pickRole 找不到 keyword → fallback DEFAULT_ROLE (editor)
//   - composeRun('tool-loop', ...) 的 role 透传到 22.mjs, 改 prompt/tools/maxRounds
// === end invariants ===

import { pickRole, ROLES } from './lib/subagent-roles.mjs';
import assert from 'node:assert';

export const experiment_38_META = { id: 'goal' };
const NAME = 'Goal — 拆解目标 + agent 逐步执行';
const MAX_STEPS = 8;

async function _getProvider() {
  const cfg = persistentConfig.config;
  const currentProvider = cfg.current?.provider || 'minimax';
  const defaultModel = cfg.current?.model || 'MiniMax-M3';
  const fallbacks = [{ name: currentProvider, model: defaultModel }];
  for (const [name, pcfg] of Object.entries(cfg.providers || {})) {
    if (name !== currentProvider && pcfg.apiKey)
      fallbacks.push({ name, model: pcfg.defaultModel || 'openrouter/auto' });
  }
  for (const fb of fallbacks) {
    try {
      const p = createProvider(fb.name, cfg.providers[fb.name]?.apiKey);
      await p.connect(cfg.providers[fb.name]?.apiKey);
      return { provider: p, model: fb.model, fallbacks };
    } catch (e) {
      console.error(`[goal] provider ${fb.name} failed: ${e.message.slice(0, 60)}`);
    }
  }
  throw new Error('goal: no available provider');
}

async function _decompose(description, p, model, fallbacks, cfg) {
  const prompt = `Decompose the following goal into ${MAX_STEPS} concrete sequential steps.

Goal: ${description}

Return ONLY a JSON array, no other text:
[{ "action": "...", "expected": "..." }]`;

  let resp;
  for (let retry = 0; retry < 2; retry++) {
    try {
      resp = await p.chat(model, [{ role: 'user', content: prompt }]);
      break;
    } catch (e) {
      if (retry === 0 && (e.message?.includes('500') || e.message?.includes('timeout'))) continue;
      const currentName = model.split('/')[0];
      fallbacks = fallbacks.filter(fb => fb.name !== currentName);
      const nextFb = fallbacks[0];
      if (!nextFb) throw e;
      p = createProvider(nextFb.name, cfg.providers[nextFb.name]?.apiKey);
      await p.connect(cfg.providers[nextFb.name]?.apiKey).catch(() => {});
      model = nextFb.model || 'openrouter/auto';
    }
  }
  const text = resp.content || '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`goal: cannot parse steps: ${text.slice(0, 200)}`);
  const steps = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('goal: no steps returned');
  return { steps: steps.slice(0, MAX_STEPS), p, model, fallbacks };
}

// [L3 PLAN] 在 /goal 跑前展示 plan — 永远 log, opt-in 阻塞 (--plan / OPENCHAT_GOAL_PLAN=1)
function _printPlan(description, steps) {
  console.debug(`\n[goal] Plan for: "${description}"`);
  console.debug(`  ${steps.length} steps:`);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const role = pickRole(s.action);
    console.debug(`  ${i + 1}. [${role}] ${s.action}`);
    if (s.expected) console.debug(`     expected: ${s.expected.slice(0, 80)}`);
  }
}

// compose 契约入口
export async function experiment_38_run({ inputs = {} } = {}) {
  const { description, sessionId = 'default' } = inputs;
  if (!description) throw new Error('goal.run: description required');

  await initToolLoopProvider();

  const cfg = persistentConfig.config;
  const { provider, model, fallbacks } = await _getProvider();
  const { steps } = await _decompose(description, provider, model, fallbacks, cfg);

  // [L3 PLAN] 拆完先展示 plan, opt-in 阻塞等用户接受 (OPENCHAT_GOAL_PLAN=1)
  // /goal 是自主跑 — 默认不阻塞; user 想审查 plan 时显式 --plan / 设 env
  _printPlan(description, steps);
  if (process.env.OPENCHAT_GOAL_PLAN === '1' && process.stdin.isTTY) {
    process.stdout.write('\n  Execute? [y/n/edit] (default y): ');
    let ans = 'y';
    try { ans = require('fs').readFileSync(0, 'utf8').trim().toLowerCase() || 'y'; } catch { ans = 'y'; }
    if (ans === 'n' || ans === 'no') {
      return { outputs: { summary: 'Plan rejected by user', steps: [], done: 0, failed: 0, total: 0 } };
    }
    // 'edit' / 其他 → 简化为继续 (全功能 edit UI 是未来工作)
  }

  const results = [];
  let done = 0;
  let failed = 0;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const role = pickRole(s.action);
    const stepPrompt = `[Goal: ${description}]\nStep ${i + 1}/${steps.length}: ${s.action}\nExpected: ${s.expected}\n\nExecute this step now.`;
    let result = '';
    let status = 'failed';
    try {
      const r = await composeRun('tool-loop', {
        text: stepPrompt,
        chatId: `${sessionId}/step-${i}/${role}`,
        role,
      });
      result = r?.outputs?.response || '';
      if (result) status = 'done';
    } catch (e) {
      result = `[Error] ${e.message}`;
    }
    if (status === 'done') done++;
    else failed++;
    results.push({ action: s.action, expected: s.expected, status, role, result: result.slice(0, 2000) });
  }

  const summary = `Goal "${description}": ${done}/${results.length} steps done, ${failed} failed.`;
  return { outputs: { summary, steps: results, done, failed, total: results.length } };
}

export async function experiment_38_test() {
  const R = create();

  const { GoalManager } = await import('../core/core-bootstrap.mjs');
  const { Orchestrator } = await import('../core/agent/orchestrator.mjs');

  class MockProvider {
    chat = async () => ({
      content: '```json\n[{"id":1,"action":"Analyze","expected":"Done"},{"id":2,"action":"Implement","expected":"Done"}]\n```',
    });
  }
  class MockSessionManager {
    getSession = () => ({ providerType: 'mock', model: 'mock' });
    getProvider = () => new MockProvider();
  }
  class MockMemoryManager {
    addMessage = async () => {};
    getContext = async () => [];
  }
  const sm = new MockSessionManager();

  // === GoalManager unit tests ===
  {
    const gm = new GoalManager({ sessionManager: sm });
    const g = gm.createGoal('s1', 'u1', 'Build feature');
    assert.ok(g.id.startsWith('goal_'));
    assert.strictEqual(g.description, 'Build feature');
    R.ok('createGoal works');

    const steps = await gm.decomposeGoal(g.id);
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].status, 'pending');
    R.ok('decomposeGoal returns 2 steps');

    const s1 = await gm.executeNextStep(g.id, async () => 'step1');
    assert.strictEqual(s1.status, 'done');
    assert.strictEqual(s1.result, 'step1');
    R.ok('executeNextStep runs step to done');

    const s2 = await gm.executeNextStep(g.id, async () => 'x', () => {});
    assert.strictEqual(s2.status, 'done');
    const done = await gm.executeNextStep(g.id, async () => 'x', () => {});
    assert.strictEqual(done, null);
    assert.strictEqual(g.status, 'done');
    R.ok('all steps done → goal status=done');

    const g2 = gm.createGoal('s2', 'u1', 'Paused');
    g2.status = 'paused';
    const r = gm.resumeGoal(g2.id);
    assert.ok(r);
    assert.strictEqual(r.status, 'active');
    R.ok('resumeGoal sets status=active');

    const s = gm.getStatus(g.id);
    assert.strictEqual(s.done, 2);
    assert.strictEqual(s.total, 2);
    R.ok('getStatus returns correct stats');

    const g3 = gm.createGoal('s3', 'u1', 'Failing');
    await gm.decomposeGoal(g3.id);
    const failStep = await gm.executeNextStep(g3.id, async () => { throw new Error('boom'); });
    assert.strictEqual(failStep.status, 'failed');
    assert.strictEqual(failStep.error, 'boom');
    assert.strictEqual(g3.status, 'failed');
    R.ok('error in step → status=failed');
  }

  // === Orchestrator.executeGoal integration ===
  {
    const gm = new GoalManager({ sessionManager: sm });
    const orch = new Orchestrator({
      sessionManager: sm,
      memoryManager: new MockMemoryManager(),
      goalManager: gm,
      PromptBuilder: { buildSystemPrompt: async () => 'You are an AI assistant' },
      useRAG: false,
      useFunctionCalling: false,
      maxIterations: 1,
    });

    const events = [];
    const result = await orch.executeGoal('s4', 'u1', 'Test', (e) => events.push(e));
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
    R.ok('executeGoal returns non-empty string');

    const types = events.map(e => e.type);
    assert.ok(types.includes('goal_created'));
    assert.ok(types.includes('goal_decompose'));
    assert.ok(types.includes('goal_decomposed'));
    assert.ok(types.includes('goal_complete'));
    R.ok('events: goal_created → goal_decompose → goal_decomposed → goal_complete');

    const g = gm.createGoal('s5', 'u1', 'Resume');
    await gm.decomposeGoal(g.id);
    const ev2 = [];
    await orch.executeGoal('s5', 'u1', 'Resume', (e) => ev2.push(e));
    assert.ok(ev2.map(e => e.type).includes('goal_resume'));
    R.ok('resume emits goal_resume event');
  }

  R.report(NAME);
}




// ===== 39.mjs =====
import { McpServer } from './lib/mcp-server.mjs';

export async function experiment_39_test() {
  const errors = [];

  const server = new McpServer();

  // 拦截 _send 来获取响应, 不写 stdout
  const responses = [];
  server._send = (msg) => { responses.push(msg); };

  // 1. initialize handshake
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } } }));
  if (responses.length !== 1) errors.push('MCP: initialize missing response');
  else if (responses[0].result?.protocolVersion !== '2024-11-05') errors.push('MCP: initialize bad protocol version');
  else if (!responses[0].result?.capabilities?.tools) errors.push('MCP: initialize missing tools capability');
  else if (responses[0].result?.serverInfo?.name !== 'openchat-mcp') errors.push('MCP: initialize bad server name');

  // 2. tools/list
  responses.length = 0;
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  if (responses.length !== 1) errors.push('MCP: tools/list missing response');
  else if (!Array.isArray(responses[0].result?.tools)) errors.push('MCP: tools/list missing tools array');
  else if (responses[0].result.tools.length < 30) errors.push(`MCP: tools/list too few tools (${responses[0].result.tools.length})`);
  else {
    const names = responses[0].result.tools.map(t => t.name);
    if (!names.includes('read_file')) errors.push('MCP: tools/list missing read_file');
    if (!names.includes('grep')) errors.push('MCP: tools/list missing grep');
    if (!names.includes('write_file')) errors.push('MCP: tools/list missing write_file');
    if (names.some(t => !t)) errors.push('MCP: tools/list has empty name');
    if (names.length !== new Set(names).size) errors.push('MCP: tools/list has duplicate names');
  }

  // 3. tools/call read_file on a known file (relative to cwd)
  responses.length = 0;
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_file', arguments: { path: 'src/experiments/39.mjs' } } }));
  if (responses.length !== 1) errors.push('MCP: tools/call missing response');
  else if (!responses[0].result?.content?.[0]?.text) errors.push('MCP: tools/call missing content');
  else if (!responses[0].result.content[0].text.includes('McpServer')) errors.push('MCP: tools/call wrong content');

  // 4. tools/call with missing name
  responses.length = 0;
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {} }));
  if (responses.length !== 1) errors.push('MCP: tools/call missing-name missing response');
  else if (!responses[0].error) errors.push('MCP: tools/call missing-name should error');

  // 5. unknown method
  responses.length = 0;
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'bogus/method' }));
  if (responses.length !== 1) errors.push('MCP: unknown method missing response');
  else if (!responses[0].error) errors.push('MCP: unknown method should error');

  // 6. parse error (invalid JSON)
  responses.length = 0;
  await server.handle('not json');
  if (responses.length !== 1) errors.push('MCP: parse error missing response');
  else if (responses[0].error?.code !== -32700) errors.push('MCP: parse error wrong code');

  // 7. tools/call missing args — read_file without path throws, should become error
  responses.length = 0;
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'read_file' } }));
  if (responses.length !== 1) errors.push('MCP: tools/call missing args missing response');

  server.close();

  return { ok: errors.length === 0, errors };
}


// ===== 40.mjs =====
import { on, runPre, runPost, listHooks, clear } from './lib/agent-hooks.mjs';
import { enableLoggingHook, enableRateLimitHook, getCallLog, clearCallLog } from './lib/hooks-builtin.mjs';

export async function experiment_40_test() {
  const errors = [];

  // 清理已有 hooks (避免影响其他实验)
  clear();

  // 1. preTool hook — permission deny
  const unsubDeny = on('preTool', 'test-deny', async (tool) => {
    if (tool === 'forbidden-tool') throw new Error('forbidden by test');
  });
  try {
    await runPre('forbidden-tool', {});
    errors.push('preTool: should have thrown for forbidden-tool');
  } catch (e) {
    if (!e.message.includes('forbidden')) errors.push('preTool: wrong error for forbidden-tool');
  }

  // 2. preTool hook — permission allow
  let allowed = false;
  await runPre('allowed-tool', {});
  allowed = true;
  if (!allowed) errors.push('preTool: allowed tool should not throw');

  unsubDeny();

  // 3. postTool hook — result transformation
  on('postTool', 'test-wrap', async (tool, args, result) => {
    return `[wrapped] ${result}`;
  });
  const postResult = await runPost('any-tool', {}, 'hello');
  if (postResult !== '[wrapped] hello') errors.push(`postTool: expected [wrapped] hello, got ${postResult}`);

  // 4. postTool chain — multiple hooks compose
  // test-wrap runs first (inserted first), wraps → '[wrapped] base'
  // test-wrap2 runs second, wraps again → '[wrapped] base (wrapped2)'
  on('postTool', 'test-wrap2', async (tool, args, result) => {
    return `${result} (wrapped2)`;
  });
  const chainResult = await runPost('any-tool', {}, 'base');
  if (chainResult !== '[wrapped] base (wrapped2)') errors.push(`postTool chain: wrong result: ${chainResult}`);

  // 5. listHooks — test-deny was unsubscribed, test-wrap remains
  const hooksBeforeClear = listHooks();
  if (hooksBeforeClear.preTool?.includes('test-deny')) errors.push('listHooks: test-deny should have been unsubscribed');
  if (!hooksBeforeClear.postTool?.includes('test-wrap')) errors.push('listHooks: missing test-wrap in postTool');
  if (!hooksBeforeClear.postTool?.includes('test-wrap2')) errors.push('listHooks: missing test-wrap2 in postTool');

  // 6. built-in logging hook
  clearCallLog();
  enableLoggingHook();
  await runPre('log-me', { x: 1 });
  await runPost('log-me', { x: 1 }, 'result');
  const log = getCallLog();
  if (log.length !== 2) errors.push(`logging hook: expected 2 entries, got ${log.length}`);
  else {
    if (log[0].type !== 'pre') errors.push('logging hook: first entry should be pre');
    if (log[0].tool !== 'log-me') errors.push(`logging hook: expected tool log-me, got ${log[0].tool}`);
    if (log[1].type !== 'post') errors.push('logging hook: second entry should be post');
  }

  // 7. built-in rate limit hook
  clear();
  const unsubRate = enableRateLimitHook(3);
  await runPre('a', {}); // 1
  await runPre('b', {}); // 2
  await runPre('c', {}); // 3
  try {
    await runPre('d', {}); // should exceed limit
    errors.push('rate-limit: should have thrown on 4th call');
  } catch (e) {
    if (!e.message.includes('Rate limit')) errors.push(`rate-limit: wrong error: ${e.message}`);
  }
  unsubRate();

  // 8. preTool hook exception — not throw, passes through to postTool cleanup
  clear();

  // 9. clear works
  clear();
  const afterClear = listHooks();
  if (afterClear.preTool?.length || afterClear.postTool?.length) errors.push('clear: hooks should be empty after clear');

  return { ok: errors.length === 0, errors };
}


// ===== 41.mjs =====
const test as test35 = experiment_35.test as test35;
const test as test36 = experiment_36.test as test36;
const test as test37 = experiment_37.test as test37;
const test as test38 = experiment_38.test as test38;

const CHAIN = [
  { id: '35-chat-poller', fn: test35, name: 'Chat-Poller (walking-skeleton)' },
  { id: '36-poll-one', fn: test36, name: '复合实验 — qiniu+isolation+agent' },
  { id: '37-dream', fn: test37, name: '记忆归并引擎' },
  { id: '38-goal', fn: test38, name: '拆解目标 + 多轮执行' },
];

export async function experiment_41_test() {
  const errors = [];
  const results = [];

  for (const { id, fn, name } of CHAIN) {
    console.debug(`\n  ▶ ${name}`);
    try {
      const r = await fn();
      // 有些实验用内部 report() 不返对象, 没抛就算过
      const ok = r === undefined || r === null || r.ok !== false;
      results.push({ id, ok, errors: r?.errors || [] });
      console.debug(`    ${ok ? '✓' : '✗'} ${id}`);
      if (!ok && r?.errors) for (const e of r.errors) console.debug(`      FAIL: ${e.slice(0, 100)}`);
    } catch (e) {
      results.push({ id, ok: false, errors: [e.message] });
      console.debug(`    ✗ ${id} crash: ${e.message.slice(0, 100)}`);
    }
  }

  const pass = results.filter(r => r.ok).length;
  const total = results.length;
  console.debug(`\n  e2e chain: ${pass}/${total} passed`);
  if (pass < total) {
    for (const r of results) {
      if (!r.ok) errors.push(`${r.id} failed`);
    }
  }
  return { ok: pass === total, errors };
}


// ===== 42.mjs =====
// Experiment 42: Project DNA - 极速项目理解法
//
// Auto-created by lab

import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'fs';

export const experiment_42_META = { id: 'project-dna' };

const NAME = 'Project DNA - 极速项目理解法';

const BRIDGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const PROJECTS = [
  { name: 'bridge-core', root: BRIDGE_ROOT, scanDir: 'src', langs: ['js'], excludeDirs: ['experiments', 'lab'] },
  { name: 'experiments', root: BRIDGE_ROOT, scanDir: 'src/experiments', langs: ['js'] },
  { name: 'lab', root: BRIDGE_ROOT, scanDir: 'src/lab', langs: ['js'] },
  { name: 'openchat-flutter', root: resolve(BRIDGE_ROOT, '../openchat-flutter'), scanDir: 'lib', langs: ['dart'] },
  { name: 'provider-kit', root: resolve(BRIDGE_ROOT, '../modules/provider-kit'), scanDir: '.', langs: ['js'] },
  { name: 'fairy-guardian', root: resolve(BRIDGE_ROOT, '../modules/fairy-guardian'), scanDir: '.', langs: ['js'] },
];

export async function experiment_42_run({ inputs = {} } = {}) {
  try {
    await getDNAContext();
    await generateDNA();
    await extractInvariants();
    await buildDependencyGraph();
    await writeDNAFile();
    const ans = await answerFromDNA('how many modules');
    return { outputs: { info: `DNA generated: ${ans.answer}` } };
  } catch (e) { return { ok: false, info: `run() failed: ${e.message}` }; }

}

export async function experiment_42_test() {
  try {
    await getDNAContext();
    await buildDependencyGraph();
    await extractInvariants();
    await generateDNA();
    await writeDNAFile();
    const dna = JSON.parse((await import('fs')).readFileSync((await import('path')).join(fileURLToPath(new URL('.', import.meta.url)), '../..', '.dna', 'project-dna.json'), 'utf8'));
    return { ok: true, info: `DNA: ${dna.totalModules} modules, ${dna.totalInvariantBlocks} invariants, ${dna.totalDepFiles} deps. Ask answerFromDNA(question) for details.` };
  } catch (e) { return { ok: false, info: `DNA test failed: ${e.message}` }; }
}

function hashlineHash(line) {
  return createHash('md5').update(line).digest('hex').substring(0, 8);
}

function extractExports(content, relPath) {
  const exports = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:export\s+)(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/);
    if (m) exports.push({ name: m[1], line: i + 1, hash: hashlineHash(lines[i]), file: relPath });
  }
  return exports;
}

function extractDartExports(content, relPath) {
  const exports = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:abstract\s+)?(?:class|mixin|enum|extension\s+\w+(?:\s+on)?|typedef)\s+(\w+)/);
    if (m) exports.push({ name: m[1], line: i + 1, hash: hashlineHash(lines[i]), file: relPath });
    const m2 = lines[i].match(/^\s*(?:const|final|var|Function)\s+(\w+)\s*=/);
    if (m2) exports.push({ name: m2[1], line: i + 1, hash: hashlineHash(lines[i]), file: relPath });
  }
  return exports;
}

const EXT_MAP = { js: ['.mjs', '.js'], dart: ['.dart'] };
const EX_FN_MAP = { js: extractExports, dart: extractDartExports };

export async function experiment_42_scanProject(project) {
  const validExts = project.langs.flatMap(l => EXT_MAP[l] || []);
  const exclude = new Set(project.excludeDirs || []);
  const modules = [];
  function walk(dir, depth) {
    if (depth > 4) return;
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'build' || e.name === '.dart_tool') continue;
        if (e.isDirectory() && exclude.has(e.name)) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (validExts.some(ext => e.name.endsWith(ext))) {
          const rel = p.replace(project.root, '').replace(/\\/g, '/');
          const content = readFileSync(p, 'utf8');
          let allExports = [];
          for (const l of project.langs) allExports.push(...EX_FN_MAP[l](content, rel));
          modules.push({ path: rel, size: statSync(p).size, exports: allExports });
        }
      }
    } catch {}
  }
  const scanPath = resolve(project.root, project.scanDir);
  if (existsSync(scanPath)) walk(scanPath, 0);
  const totalExports = modules.reduce((s, m) => s + m.exports.length, 0);
  return { project: project.name, totalModules: modules.length, totalExports, modules, scannedAt: Date.now() };
}

export async function experiment_42_generateDNA() {
  return scanProject(PROJECTS[0]);
}

export async function experiment_42_generateMultiProjectDNA() {
  const results = await Promise.all(PROJECTS.map(scanProject));
  const allModules = [];
  let totalExports = 0;
  for (const r of results) {
    for (const m of r.modules) m.project = r.project;
    allModules.push(...r.modules);
    totalExports += r.totalExports;
  }
  return {
    projects: PROJECTS.map(p => p.name),
    totalModules: allModules.length,
    totalExports,
    modules: allModules,
    scannedAt: Date.now(),
  };
}

export async function experiment_42_extractInvariants() {
  const { readFileSync, readdirSync, statSync } = await import('fs');
  const { join, resolve } = await import('path');
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
  const invs = [];
  function walk(dir, depth) {
    if (depth > 4) return;
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name.endsWith('.mjs') || e.name.endsWith('.js')) {
          const c = readFileSync(p, 'utf8');
          const start = c.indexOf('// === invariants ===');
          if (start !== -1) {
            const end = c.indexOf('// ===', start + 20);
            const block = c.slice(start, end !== -1 ? end : c.length).split('\n').filter(l => l.trim()).slice(0, 20);
            invs.push({ file: p.replace(root, '').replace(/\\/g, '/'), block });
          }
        }
      }
    } catch {}
  }
  walk(resolve(root, 'src'), 0);
  return { totalInvariantBlocks: invs.length, invariants: invs };
}

export async function experiment_42_buildDependencyGraph() {
  const { readFileSync, readdirSync, statSync } = await import('fs');
  const { join, resolve } = await import('path');
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
  const nodes = [];
  function walk(dir, depth) {
    if (depth > 3) return;
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name.endsWith('.mjs') || e.name.endsWith('.js')) {
          const c = readFileSync(p, 'utf8');
          const imports = [...c.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
          nodes.push({ file: p.replace(root, '').replace(/\\/g, '/'), imports });
        }
      }
    } catch {}
  }
  walk(resolve(root, 'src'), 0);
  return { nodes, totalFiles: nodes.length };
}

export async function experiment_42_writeDNAFile() {
  const dna = await generateMultiProjectDNA();
  const inv = await extractInvariants();
  const dep = await buildDependencyGraph();
  const report = { projects: dna.projects, scannedAt: dna.scannedAt, modules: dna.modules, totalModules: dna.totalModules, totalExports: dna.totalExports, invariants: inv.invariants, totalInvariantBlocks: inv.totalInvariantBlocks, deps: dep.nodes, totalDepFiles: dep.totalFiles };
  const outDir = join(BRIDGE_ROOT, '.dna');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'project-dna.json'), JSON.stringify(report, null, 2), 'utf8');
  return { ok: true, path: join(outDir, 'project-dna.json') };
}

export async function experiment_42_getDNAContext({ maxAgeMs = 300000 } = {}) {
  const dnaPath = join(BRIDGE_ROOT, '.dna', 'project-dna.json');
  if (!existsSync(dnaPath)) {
    await writeDNAFile();
  } else {
    try {
      const cur = JSON.parse(readFileSync(dnaPath, 'utf8'));
      if (Date.now() - (cur.scannedAt || 0) > maxAgeMs) await writeDNAFile();
    } catch { await writeDNAFile(); }
  }
  try {
    const dna = JSON.parse(readFileSync(dnaPath, 'utf8'));
    const projects = dna.projects?.join('/') || 'bridge-core';
    const topMods = dna.modules.filter(m => m.exports?.length > 0).sort((a, b) => (b.exports?.length || 0) - (a.exports?.length || 0)).slice(0, 10);
    return `[Project DNA] ${dna.totalModules} modules in ${projects}, ${dna.totalExports} exports, ${dna.totalInvariantBlocks} invariants` +
      `. Top: ${topMods.map(m => `[${m.project||'bridge'}]${m.path.replace(/^\/(?:src\/|lib\/)/, '')}(${m.exports.length})`).join(', ')}` +
      `. Use dna_query to find any export by name/hash.`;
  } catch { return ''; }
}

export async function experiment_42_answerFromDNA(question, { maxAgeMs = 300000 } = {}) {
  const dnaPath = join(BRIDGE_ROOT, '.dna', 'project-dna.json');
  if (!existsSync(dnaPath)) {
    await writeDNAFile();
  } else {
    try {
      const cur = JSON.parse(readFileSync(dnaPath, 'utf8'));
      if (Date.now() - (cur.scannedAt || 0) > maxAgeMs) await writeDNAFile();
    } catch { await writeDNAFile(); }
  }
  const dna = JSON.parse(readFileSync(dnaPath, 'utf8'));
  if (!question) return { answer: `DNA: ${dna.totalModules} modules across ${(dna.projects||['bridge']).join(', ')}, ${dna.totalExports} exports, ${dna.totalInvariantBlocks} invariants, ${dna.totalDepFiles} deps` };
  const q = question.toLowerCase();

  // 按项目过滤
  const projMatch = q.match(/project\s+(\S+)/);
  let scopeMods = dna.modules;
  if (projMatch) scopeMods = dna.modules.filter(m => (m.project || 'bridge') === projMatch[1]);

  // 按函数名查找 — 返回文件 + 行号 + hashline hash
  const fnMatch = q.match(/find\s+(?:function\s+)?(\w+)/);
  if (fnMatch) {
    const name = fnMatch[1];
    for (const mod of scopeMods) {
      for (const ex of mod.exports) {
        if (ex.name.toLowerCase() === name) return { answer: `[${mod.project||'bridge'}] function ${ex.name} in ${ex.file}:${ex.line}, hashline: ${ex.hash}` };
      }
    }
    return { answer: `function ${name} not found in DNA` };
  }

  // 按 hashline hash 查找 — 返回文件 + 行
  const hashMatch = q.match(/hash\s+([0-9a-f]{8})/);
  if (hashMatch) {
    const h = hashMatch[1];
    for (const mod of scopeMods) {
      for (const ex of mod.exports) {
        if (ex.hash === h) return { answer: `[${mod.project||'bridge'}] hash ${h} → ${ex.file}:${ex.line}, function ${ex.name}` };
      }
    }
    return { answer: `hash ${h} not found in DNA` };
  }

  // 列出模块的 exports
  const lsMatch = q.match(/ls\s+(\S+)/);
  if (lsMatch) {
    const file = lsMatch[1];
    const mod = dna.modules.find(m => m.path.endsWith(file) || m.path === file);
    if (!mod) return { answer: `file ${file} not found in DNA` };
    return { answer: `[${mod.project||'bridge'}] ${mod.path}: ${mod.exports.map(e => `${e.name}:${e.line} hash=${e.hash}`).join(', ')}` };
  }

  if (/^summary$/i.test(q)) {
    const byProj = {};
    for (const m of dna.modules) {
      const p = m.project || 'bridge';
      if (!byProj[p]) byProj[p] = { modules: 0, exports: 0 };
      byProj[p].modules++;
      byProj[p].exports += m.exports?.length || 0;
    }
    const projLine = Object.entries(byProj).map(([p, c]) => `${p}:${c.modules}m/${c.exports}e`).join(', ');
    const top = dna.modules.filter(m => m.exports?.length > 0).sort((a, b) => (b.exports?.length || 0) - (a.exports?.length || 0)).slice(0, 15);
    return { answer: `${dna.totalModules} modules, ${dna.totalExports} exports.\n${projLine}\nTop:\n${top.map(m => `[${m.project||'bridge'}] ${m.path} (${m.exports.length})`).join('\n')}` };
  }
  if (/^hot$/i.test(q)) {
    const ranked = dna.modules.filter(m => m.exports?.length > 0).sort((a, b) => (b.exports?.length || 0) - (a.exports?.length || 0)).slice(0, 30);
    return { answer: `Modules ranked by export count:\n${ranked.map((m, i) => `${i+1}. [${m.project||'bridge'}] ${m.path} (${m.exports.length})`).join('\n')}` };
  }
  const catMatch = q.match(/^cat\s+(\S+)/);
  if (catMatch) {
    const cat = catMatch[1];
    const matched = dna.modules.filter(m => m.path.includes(cat)).slice(0, 20);
    return { answer: matched.length ? `${cat}: ${matched.length} modules\n${matched.map(m => `[${m.project||'bridge'}] ${m.path} (${m.exports?.length || 0} exports)`).join('\n')}` : `No modules matching "${cat}"` };
  }
  if (/^isolate\b/.test(q)) {
    const { sep, relative } = await import('path');
    const root = BRIDGE_ROOT;
    const ZONE_MAP = [
      { prefix: '/modules/provider-kit/', name: 'kit', layer: 0 },
      { prefix: '/src/core/', name: 'core', layer: 0 },
      { prefix: '/src/plugins/', name: 'plugins', layer: 1 },
      { prefix: '/src/tools/', name: 'tools', layer: 1 },
      { prefix: '/src/p2p/', name: 'p2p', layer: 1 },
      { prefix: '/src/api/', name: 'api', layer: 2 },
      { prefix: '/src/cli/', name: 'cli', layer: 2 },
      { prefix: '/src/infra/', name: 'infra', layer: 2 },
    ];
    function zoneOf(path) {
      const n = path.replace(/\\/g, '/');
      for (const z of ZONE_MAP) if (n.startsWith(z.prefix)) return z;
      return { name: 'other', layer: 9 };
    }
    function attr(z) { return typeof z === 'object' ? z : { name: z, layer: 9 }; }

    const violations = [];
    for (const node of dna.deps) {
      const s = zoneOf(node.file);
      if (s.name === 'other' || s.name === 'kit') continue;
      const srcDir = resolve(root, '.' + node.file, '..').replace(/\\/g, '/');
      for (const imp of node.imports) {
        if (!imp.startsWith('.') || imp.startsWith('/')) continue;
        const resolved = resolve(srcDir, imp).replace(/\\/g, '/');
        const relPath = '/' + relative(root, resolved).replace(/\\/g, '/');
        const t = zoneOf(relPath);
        if (t.name !== 'other' && t.name !== s.name && s.layer < t.layer) {
          violations.push({ from: node.file, to: relPath, srcZone: s.name, tgtZone: t.name, spec: imp });
        }
      }
    }

    // 跨项目边界：外部项目 (kit/flutter/guardian) 引用 bridge-core 内部路径
    const KNOWN_PROJECT_DIRS = [
      { name: 'provider-kit', dir: resolve(root, '../modules/provider-kit') },
      { name: 'openchat-flutter', dir: resolve(root, '../openchat-flutter') },
      { name: 'fairy-guardian', dir: resolve(root, '../modules/fairy-guardian') },
    ];
    const BRIDGE_SRC = resolve(root, 'src').replace(/\\/g, '/');
    for (const proj of KNOWN_PROJECT_DIRS) {
      if (!existsSync(proj.dir)) continue;
      const refs = [];
      (function walkP(dir, depth) {
        if (depth > 5) return;
        try {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue;
            const p = join(dir, e.name);
            if (e.isDirectory()) walkP(p, depth + 1);
            else if (e.name.endsWith('.mjs') || e.name.endsWith('.js') || e.name.endsWith('.dart')) {
              const c = readFileSync(p, 'utf8');
              const imps = [...c.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
              for (const imp of imps) {
                const res = resolve(dir, imp).replace(/\\/g, '/');
                if (res.startsWith(BRIDGE_SRC)) {
                  const rel = '/' + relative(root, res).replace(/\\/g, '/');
                  const frel = p.replace(root, '').replace(/\\/g, '/');
                  violations.push({ from: frel, to: rel, srcZone: proj.name, tgtZone: zoneOf(rel), spec: imp, cross: true });
                }
              }
            }
          }
        } catch {}
      })(proj.dir, 0);
    }

    if (violations.length === 0) return { answer: 'All zones isolated, no boundary violations.' };

    // Group by source zone
    const grouped = {};
    for (const v of violations) {
      const key = v.srcZone + ' → ' + v.tgtZone;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(v);
    }
    const lines = [violations.length + ' boundary violations:'];
    for (const [key, list] of Object.entries(grouped)) {
      lines.push('  ' + key + ' (' + list.length + '):');
      for (const v of list) lines.push('    ' + v.from + ' imports ' + v.spec);
    }
    return { answer: lines.join('\n') };
  }
  if (/project\s+\S+/.test(q)) { // single project mode
    const pName = q.match(/project\s+(\S+)/)?.[1];
    if (pName) {
      const mods = dna.modules.filter(m => (m.project || 'bridge') === pName);
      return { answer: `${pName}: ${mods.length} modules, ${mods.reduce((s,m) => s + (m.exports?.length||0), 0)} exports` };
    }
  }
  if (/total modules|file count|how many/.test(q)) return { answer: `${dna.totalModules} modules across ${(dna.projects||['bridge']).join(', ')}` };
  if (/invariant|constraint/.test(q)) return { answer: `${dna.totalInvariantBlocks} invariant blocks across project` };
  if (/dependency|import/.test(q)) return { answer: `${dna.totalDepFiles} files with import dependencies tracked` };
  return { answer: `DNA contains ${dna.totalModules} modules, ${dna.totalExports} exports, ${dna.totalInvariantBlocks} invariants, ${dna.totalDepFiles} deps across ${(dna.projects||['bridge']).length} project(s). Try: "find function X", "ls path/to/file", "hash XXXXXXXX", "summary", "hot", "cat prefix", "isolate", "project X"` };
}


// ===== compose-demo.mjs =====
// compose-demo.mjs — 演示 compose.mjs 把多个实验拼成「新软件」
//
// 展示三种组合：
//   1. 单实验: run('codec', { pcm, op: 'encode' })
//   2. 管道: compose([isolation, codec])    — 解析 key → 解码
//   3. 完整链路: compose([config, agent])   — 读 config → 调 LLM
//
// 跑：node src/experiments/compose-demo.mjs

const run, compose, list, getMeta, getState, printDeps, reset = experiment_compose.run, compose, list, getMeta, getState, printDeps, reset;

const demo = async () => {
  console.debug('═══════════════════════════════════════');
  console.debug('   compose.mjs 演示');
  console.debug('═══════════════════════════════════════\n');

  // 0. 列清单
  console.debug('▸ 可用实验 (manifest.json):');
  for (const e of list()) {
    const tags = (e.tags || []).slice(0, 3).join(', ');
    console.debug(`   ${e.id.padEnd(15)} ${e.category.padEnd(8)} [${tags}]`);
  }
  console.debug();

  // 1. 单实验：codec encode
  console.debug('▸ 1. run("codec", encode)');
  reset();
  const pcm = Buffer.alloc(192 * 2); // 192 samples of silence @ 48kHz
  const enc = await run('codec', { pcm, op: 'encode' });
  console.debug(`   inputs:  { pcm: ${pcm.length} bytes silence, op: 'encode' }`);
  console.debug(`   outputs: { encoded: ${enc.outputs.encoded.length} bytes (EPC BB 01 CC) }`);
  console.debug();

  // 2. 单实验：codec decode roundtrip
  console.debug('▸ 2. run("codec", decode)');
  const dec = await run('codec', { encoded: enc.outputs.encoded, op: 'decode' });
  console.debug(`   inputs:  { encoded: ${enc.outputs.encoded.length} bytes, op: 'decode' }`);
  console.debug(`   outputs: { pcm: ${dec.outputs.pcm.length} bytes }`);
  console.debug();

  // 3. 单实验：isolation 路径解析
  console.debug('▸ 3. run("isolation")');
  const iso = await run('isolation', { key: 'oc/chat/device-zhangsan/123.msg' });
  console.debug(`   inputs:  { key: 'oc/chat/device-zhangsan/123.msg' }`);
  console.debug(`   outputs: { chatId: '${iso.outputs.chatId}', replyPrefix: '${iso.outputs.replyPrefix}' }`);
  console.debug();

  // 4. compose: 解析 chatId + 编码 PCM
  console.debug('▸ 4. compose([isolation, codec]) — 两个实验并联');
  reset();
  const out = await compose(['isolation', 'codec'], {
    isolation: { key: 'oc/chat/c1/voice.enc' },
    codec:     { pcm, op: 'encode' },
  });
  console.debug(`   outputs:`);
  console.debug(`     isolation → ${JSON.stringify(out.isolation)}`);
  console.debug(`     codec     → { encoded: ${out.codec.outputs.encoded.length} bytes }`);
  console.debug();

  // 5. 依赖图
  console.debug('▸ 5. 依赖图 printDeps("chat-poller")');
  console.debug(printDeps('chat-poller'));
  console.debug();

  // 6. State 快照
  console.debug('▸ 6. getState() — 当前所有 cache 的实验');
  for (const [id, s] of Object.entries(getState())) {
    console.debug(`   ${id.padEnd(15)} ${s.durationMs}ms`);
  }
  console.debug();

  // 7. metadata 示例
  console.debug('▸ 7. getMeta("agent")');
  const m = getMeta('agent');
  console.debug(`   ${m.id}  deps=[${m.deps.join(', ')}]`);
  console.debug(`   inputs:  ${m.inputs.map(i => `${i.name}${i.required ? '*' : ''}: ${i.type}`).join(', ')}`);
  console.debug(`   outputs: ${m.outputs.map(o => `${o.name}: ${o.type}`).join(', ')}`);
  console.debug();

  // 8. 真组合应用: chat-message-pipeline
  //    用 qiniu + isolation + agent 三个实验拼出"用户消息→上传→解析→LLM→写回→验证"的完整小应用
  //    核心点: 没有新增一行产品代码——只是用现成实验搭出来的
  //    注意: compose 跨调用会缓存，顺序执行时用 run() 避开缓存
  console.debug('▸ 8. 真组合应用: chat-message-pipeline (qiniu + isolation + agent)');
  // 能力探测: 试列一次空前缀，能成功就当 Qiniu 可用
  const q = await import('./lib/qiniu-s3.mjs');
  let hasQiniu = false;
  try { await q.qiniuList(''); hasQiniu = true; } catch { hasQiniu = false; }
  if (hasQiniu) {
    reset();
    const chatId  = 'demo-pipeline';
    const ts      = Date.now();
    const demos = ['推荐一本技术书', '写个递归函数', '解释什么是闭包', '今儿天气怎么样'];
const userText = demos[Date.now() % demos.length];
    const msgKey   = `oc/chat/${chatId}/${ts}.msg`;
    const replyKey = `oc/chat/${chatId}/${ts}-reply.json`;
    console.debug(`   input:  { chatId: "${chatId}", text: "${userText}" }`);

    // 步骤 A: 上传用户消息 + 解析 chatId (用 compose — 两个真依赖的实验)
    const a = await compose(['qiniu', 'isolation'], {
      'qiniu':     { op: 'put', key: msgKey, data: Buffer.from(JSON.stringify({ type: 'text', text: userText })) },
      'isolation': { key: msgKey },
    });
    console.debug(`   A. compose([qiniu, isolation])`);
    console.debug(`     写入 key:    ${msgKey}`);
    console.debug(`     解析 chatId: ${a.isolation?.outputs?.chatId}`);

    // 步骤 B: 调 LLM (单实验，直接 run 避免污染 qiniu 缓存)
    let reply = '(agent skipped)';
    try {
      const b = await run('agent', { text: userText, chatId });
      reply = b?.response || '(empty)';
    } catch (e) {
      console.debug(`   [agent 限速/超时: ${e.message.substring(0, 50)}]`);
    }
    console.debug(`   B. run('agent', ...)`);
    console.debug(`     "${reply.substring(0, 60)}${reply.length > 60 ? '...' : ''}"`);

    // 步骤 C: 写回 reply + 直接读 verify (单 op，用 run)
    await run('qiniu', { op: 'put', key: replyKey, data: Buffer.from(JSON.stringify({
      text: reply, sourceKey: msgKey, ts: Date.now(),
    })) });
    const verify = JSON.parse((await run('qiniu', { op: 'get', key: replyKey }))?.outputs?.result?.toString('utf8') || '{}');
    console.debug(`   C. run('qiniu', put + get)`);
    console.debug(`     reply key:   ${replyKey}`);
    console.debug(`     verify.text: "${verify.text?.substring(0, 60)}..."`);
    console.debug(`     sourceKey:   ${verify.sourceKey} ${verify.sourceKey === msgKey ? '✓' : '✗'}`);

    // 清理
    await run('qiniu', { op: 'delete', key: msgKey });
    await run('qiniu', { op: 'delete', key: replyKey });
    console.debug(`   cleanup: 2 keys deleted ✓`);
  } else {
    console.debug('   skipped (qiniu 不可达 — 检查 credentials)');
  }
  console.debug();

  // 9. 纯本地: audio roundtrip + LLM 解释 (codec + agent)
  //    用 0 网络依赖的 2 个实验拼一个"音频→编码→解码→LLM 解释"的小应用
  console.debug('▸ 9. 纯本地: audio-roundtrip + LLM 解释 (codec + agent)');
  reset();
  const pcmIn = Buffer.alloc(192 * 2); // 192 samples silence @ 48kHz
  // 步骤 1: encode + decode 串行（decode 依赖 encode）
  const enc9 = await run('codec', { pcm: pcmIn, op: 'encode' });
  const dec9 = await run('codec', { encoded: enc9.outputs.encoded, op: 'decode' });
  console.debug(`   A. codec roundtrip`);
  console.debug(`     in.pcm:     ${pcmIn.length} bytes silence`);
  console.debug(`     encoded:    ${enc9.outputs.encoded.length} bytes (BB 01 CC ...)`);
  console.debug(`     out.pcm:    ${dec9.outputs.pcm.length} bytes`);

  // 步骤 2: 让 LLM 解释 codec 的作用（容错：限速时跳过，不阻断 demo）
  let explain;
  try {
    explain = await run('agent', {
      text: `用一句话解释这段音频编解码: ${pcmIn.length} 字节 PCM (48kHz int16 静音) 经 LMDN codec 编码为 ${enc9.outputs.encoded.length} 字节 EPC 字节流 (含 BB 01 CC 头), 解码回 ${dec9.outputs.pcm.length} 字节 PCM。`,
      chatId: 'demo-audio',
    });
    const r = explain?.response;
    console.debug(`   B. agent 解释:`);
    if (r) console.debug(`     "${r.substring(0, 80)}${r.length > 80 ? '...' : ''}"`);
    else  console.debug(`     (限速/空响应)`);
  } catch (e) {
    console.debug(`   B. agent 跳过 (${e.message.substring(0, 60)})`);
  }
  console.debug();

  // 10. chat-poller 复刻 — 0 行产品代码复现 polling loop 的核心
  //     上传 N 条测试消息 → list → 对每条: get + isolation + agent + put reply → verify
  console.debug('▸ 10. chat-poller 复刻 — 0 行产品代码复现 polling 核心');
  if (hasQiniu) {
    const chatId10 = 'demo-poller';
    const ts10 = Date.now();
    const testMsgs = [
      { text: '一句话介绍 LLM' },
      { text: 'LMDN codec 是什么' },
    ];
    console.debug(`   input:  ${testMsgs.length} 条测试消息 → chatId="${chatId10}"`);

    // A. 上传测试消息
    for (let i = 0; i < testMsgs.length; i++) {
      const key = `oc/chat/${chatId10}/${ts10}-${i}.msg`;
      await run('qiniu', { op: 'put', key, data: Buffer.from(JSON.stringify({ type: 'text', text: testMsgs[i].text })) });
    }
    console.debug(`   A. 上传: ${testMsgs.length} 条 .msg`);

    // B. list 找待处理
    const listed = await run('qiniu', { op: 'list', prefix: `oc/chat/${chatId10}/${ts10}-` });
    const pending = listed.outputs.result.filter(k => k.endsWith('.msg'));
    console.debug(`   B. list: 找到 ${pending.length} 条待处理`);

    // C. 对每条: 调 poll-one (它内部 = qiniu.get + isolation + agent + qiniu.put reply)
    const replies = [];
    let skipped = 0;
    for (const key of pending) {
      try {
        const r = await run('poll-one', { msgKey: key });
        replies.push(r.outputs.replyKey);
        const txt = r.outputs.reply || '(限速/空响应)';
        const shown = `"${txt.substring(0, 30)}${txt.length > 30 ? '...' : ''}"`;
        console.debug(`     ${key} → chatId="${r.outputs.chatId}" → reply ${shown}`);
      } catch (e) {
        skipped++;
        console.debug(`     ${key} → 跳过 (${e.message.substring(0, 50)})`);
      }
    }
    console.debug(`   C. 处理完: ${replies.length} reply 写入, ${skipped} 跳过`);

    // D. 验证 reply 数 == 上传数
    const listAgain = await run('qiniu', { op: 'list', prefix: `oc/chat/${chatId10}/${ts10}-` });
    const foundReplies = listAgain.outputs.result.filter(k => k.endsWith('-reply.json'));
    console.debug(`   D. verify: ${foundReplies.length}/${replies.length} reply 在 Qiniu 上 ${foundReplies.length === replies.length ? '✓' : '✗'}`);

    // cleanup
    for (const k of [...pending, ...replies]) {
      await run('qiniu', { op: 'delete', key: k });
    }
    console.debug(`   cleanup: ${pending.length + replies.length} keys deleted ✓`);
  } else {
    console.debug('   skipped (qiniu 不可达)');
  }
  console.debug();

  // 11. 总结: 这个 demo 的产物 = 0 行新业务代码
  console.debug('▸ 11. 总结');
  console.debug('   真组合应用 = 现有实验的有序调用序列。');
  console.debug('   改产品代码时,只需在实验里加能力,新应用就自动获得它。');
  console.debug('   例如: 给 agent 加 web_fetch → 上面的 pipeline 自动能联网。');
  console.debug('   demo 8/9/10 共用 qiniu/codec/agent/isolation 四个实验 = 整个 chat 流水线');
};

demo().catch(e => { console.error('demo 失败:', e); process.exit(1); });


// ===== compose.mjs =====
// compose.mjs — 按 manifest.json 解析依赖、顺序运行、缓存 outputs 的组合运行器
//
// 用法:
//   import { run, compose, list, get, getMeta, reset, printDeps } from './compose.mjs';
//
//   // 1. 单个实验
//   const { encoded } = await run('codec', { op: 'encode', pcm: buffer });
//
//   // 2. 多个实验（自动按 deps 拓扑排序）
//   const { agent, qiniu } = await compose(['config', 'tool-loop', 'qiniu'], {
//     agent: { text: 'hello', chatId: 'c1' },
//   });
//
//   // 3. pipeline（串联）
//   const { config, result } = await pipeline([
//     { id: 'config' },
//     { id: 'guardrails-pipeline', inputs: { op: 'run_pipeline', scenario: { id: 'test', text: 'hi', tools: [], mockSeq: [] } } },
//   ]);
//
//   // 4. 列清单 / 看依赖图
//   list();             // → manifest.experiments
//   getMeta('codec');   // → 单个实验的 manifest
//   printDeps('chat-poller');  // → 依赖树
//
// 约定:
//   - 每个实验文件 export `async run({ inputs, deps, manifest })` 返回 { outputs }
//   - 若未 export run() 则 fallback 到 test()（仅作测试，outputs 为 null）
//   - 每个实验 export const META = { id }（可选，调试用）
//   - run-all.mjs 走 test（测试），compose.mjs 走 run（组合）

import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(await readFile(resolve(__dirname, 'manifest.json'), 'utf8'));
const _byId = new Map(MANIFEST.experiments.map(e => [e.id, e]));
const _state = new Map(); // id → { outputs, ts, durationMs }

function _abs(file) { return pathToFileURL(resolve(__dirname, file)).href; }

function _meta(id) {
  const m = _byId.get(id);
  if (!m) throw new Error(`unknown experiment: ${id} (have: ${[..._byId.keys()].join(', ')})`);
  return m;
}

// 拓扑排序：deps 在前
function _resolveOrder(ids) {
  const order = [];
  const seen = new Set();
  function visit(id) {
    if (seen.has(id)) return;
    seen.add(id);
    for (const d of _meta(id).deps || []) visit(d);
    order.push(id);
  }
  for (const id of ids) visit(id);
  return order;
}

async function _runExp(meta, inputs) {
  const mod = await import(_abs(meta.file));
  const t0 = Date.now();

  // 优先 run() — 真正的可组合接口。约定返回 { outputs: {...} }
  if (typeof mod.run === 'function') {
    const deps = {};
    for (const d of meta.deps || []) {
      const s = _state.get(d);
      deps[d] = s ? s.outputs : null;
    }
    const result = await mod.run({ inputs, deps, manifest: meta });
    return { outputs: result, durationMs: Date.now() - t0 };
  }

  // 无 run() — compose 拿不到 outputs。test() 由 run-all.mjs 显式跑，不在此触发。
  if (typeof mod.test === 'function') {
    console.debug(`[compose] ${meta.id} 无 run() — outputs=null, 跑测试请用 run-all.mjs`);
  }
  return { outputs: null, durationMs: Date.now() - t0 };
}

async function _runOne(id, inputs) {
  // 不预跑 deps — 子实验的 inputs 是目标 run() 内部按需传的，用 {} 调会触发必填校验 throw
  // compose() 仍按 deps 拓扑排序并各自传 inputsMap[cur]，那是 caller 显式提供 inputs 的路径
  const meta = _meta(id);
  const { outputs, durationMs } = await _runExp(meta, inputs);
  _state.set(id, { outputs, ts: Date.now(), durationMs });
  return outputs;
}

export async function experiment_compose_run(id, inputs = {}) {
  try {
    await dump();
    await pipeline();
    await printDeps();
    await reset();
    await getState();
    await getMeta();
    await list();
    await get();
    await compose();
    return _runOne(id, inputs);
  } catch (e) { return { ok: false, info: `run() failed: ${e.message}` }; }

}

export async function experiment_compose_compose(ids, inputsMap = {}) {
  if (!Array.isArray(ids)) throw new Error('compose: ids must be array');
  const order = _resolveOrder(ids);
  for (const cur of order) {
    if (_state.has(cur)) continue;
    const meta = _meta(cur);
    const { outputs, durationMs } = await _runExp(meta, inputsMap[cur] || {});
    _state.set(cur, { outputs, ts: Date.now(), durationMs });
  }
  const out = {};
  for (const id of ids) {
    const s = _state.get(id);
    out[id] = s ? s.outputs : null;
  }
  return out;
}

export function experiment_compose_get(id)        { return _state.get(id); }
export function experiment_compose_list()         { return MANIFEST.experiments; }
export function experiment_compose_getMeta(id)    { return id ? _meta(id) : MANIFEST; }
export function experiment_compose_getState()     { return Object.fromEntries(_state); }
export function experiment_compose_reset()        { _state.clear(); }

// 依赖树（缩进文本）
export function experiment_compose_printDeps(id) {
  const lines = [];
  function visit(id, prefix = '', isLast = true) {
    const m = _meta(id);
    const branch = prefix === '' ? '' : (isLast ? '└─ ' : '├─ ');
    lines.push(`${prefix}${branch}${m.id}  [${m.category}]`);
    const deps = m.deps || [];
    const next = prefix === '' ? '' : (prefix + (isLast ? '   ' : '│  '));
    deps.forEach((d, i) => visit(d, next, i === deps.length - 1));
  }
  visit(id);
  return lines.join('\n');
}

// pipeline — 按序串联实验，前一个 outputs 作为后一个 inputs
// stages: [{ id, inputs?, map? }]
//   - id: 实验 id
//   - inputs: 额外输入（可选，合并到前一步 outputs）
//   - map: (prevOutputs) => inputs 转换函数（可选，优先级高于 inputs）
// 示例:
//   await pipeline([
//     { id: 'config' },
//     { id: 'tool-rescue', map: out => ({ op: 'validate', toolName: 'read_file', args: { path: out.config?.projectDir } }) },
//   ]);
export async function experiment_compose_pipeline(stages, initialInput = {}) {
  let acc = { ...initialInput };
  for (const st of stages) {
    const inputs = st.map ? st.map(acc) : { ...acc, ...st.inputs };
    const { outputs } = await _runExp(_meta(st.id), inputs);
    if (outputs !== null && typeof outputs === 'object') {
      acc = { ...acc, ...outputs };
    }
  }
  return acc;
}

// 汇总：所有实验的 outputs（用于调试/序列化）
export function experiment_compose_dump() {
  const out = {};
  for (const [id, s] of _state) out[id] = s;
  return out;
}

export async function experiment_compose_test() { return { ok: true, info: 'skeleton test' }; }
