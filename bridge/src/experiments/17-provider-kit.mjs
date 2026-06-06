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
  stripThink, extractReasoning, normalizeToolCalls, parseActionFallback,
  classifyError, ProviderError, withRetry, withTimeout,
  createProvider, listPresetProviders, parseFrames, epcFromResponse,
} from 'provider-kit';

export const META = { id: 'provider-kit' };

export async function run({ inputs = {} } = {}) {
  const { op } = inputs;
  if (op === 'normalize') {
    const { raw = '', reasoning = null, toolCalls = [] } = inputs;
    return {
      outputs: {
        content: stripThink(raw),
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

  // 1a. stripThink — 基本 / 多块 / 嵌套换行 / null
  {
    const cases = [
      { in: '<think>hello</think>world',          out: 'world' },
      { in: '<think>a</think><think>b</think>c',  out: 'c' },
      { in: 'no think',                            out: 'no think' },
      { in: '',                                    out: '' },
      { in: null,                                  out: '' },
      { in: '<think>多\n行\nthink</think>after',  out: 'after' },
    ];
    let allPass = true;
    for (const c of cases) {
      if (stripThink(c.in) !== c.out) { allPass = false; ng(`stripThink 错: ${JSON.stringify(c.in)}`); }
    }
    if (allPass) ok(`stripThink: ${cases.length} cases`);
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
              content: '<think>思考中</think>Hello!',
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
      if (r.content === 'Hello!') ok('adapter.chat: stripThink 后 content 正确');
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
