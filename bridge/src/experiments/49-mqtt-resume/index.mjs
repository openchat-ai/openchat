// 49-mqtt-resume/index.mjs
//
// E49: connectWithResume — 5 件套 scaffold 在 "持久化 + 重试" 档的横向验证
// 测 LLM 能否:
//   1. 写带 retry 循环的 connect 函数
//   2. 失败重试 (subTestB: 前 2 次 broker 拒绝, 第 3 次成功)
//   3. 从 sessionStore 读 subscriptions 重新订阅
//   4. 11 维评分 100%
//
// 模式 (跟 34/35/40 一致):
//   - test() 默认走 dryRun (无 LLM, 跑 gold 验 sandbox)
//   - runLive({ repeats }) 才发真 LLM, 需 E49_LIVE=1
//   - run({ inputs }) 是 compose 契约入口

import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { create } from '../lib/report.mjs';
import { renderConnect, renderSubscribe } from '../lib/mqtt-render-tools.mjs';
import { runSandbox } from './sandbox.mjs';
import { scoreOne, aggregateScore, extractSource } from './scoring.mjs';
import { GOLD_SOURCE, GOLD_SESSION_STORE, GOLD_TEST_ARGS } from './gold.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// === META ===

export const META = {
  id: '49-mqtt-resume',
  name: 'MQTT connectWithResume — 5 件套在 "持久化 + 重试" 档的验证',
  status: 'closed-loop',
  needsEnv: [],
  needsEnvLive: ['OPENCHAT_PROVIDER'],
  inputs: [
    { name: 'live', type: 'boolean', required: false, default: false,
      description: 'true = 跑真 LLM 调用; false = dryRun (默认)' },
    { name: 'repeats', type: 'number', required: false, default: 15,
      description: 'LLM 调用次数 (live 模式)' },
    { name: 'model', type: 'string', required: false, default: null,
      description: '覆盖默认 model (live 模式)' },
  ],
  outputs: [
    { name: 'aggregate', type: 'object', description: '11 维 hit rate' },
    { name: 'runs', type: 'array', description: '每次 run 详细' },
    { name: 'calls', type: 'number', description: '总 LLM 调用次数' },
  ],
  deps: ['mqtt-auto'],
};

// === Helpers ===

async function loadPrompt() {
  const raw = await readFile(resolve(__dirname, 'task.json'), 'utf8');
  return JSON.parse(raw).task.prompt;
}

// Verify renderConnect/renderSubscribe produce correct bytes (independent of sandbox)
async function verifyRenderTools() {
  // CONNECT: 22 bytes, first byte 0x10, protoName "MQTT", clientId "test-123"
  const c = renderConnect({ protoName: 'MQTT', protoLevel: 4, connectFlags: 2, keepAlive: 60, clientId: 'test-123' });
  if (c.length !== 22) throw new Error(`renderConnect length=${c.length}, expected 22`);
  if (c.bytes[0] !== 0x10) throw new Error(`renderConnect[0]=${c.bytes[0]}, expected 0x10`);

  // SUBSCRIBE: at least 6 bytes (1+1+2+2+topic+qos)
  const s = renderSubscribe({ packetId: 1, subscriptions: [{ topic: 'a', qos: 0 }] });
  if (s.length < 6) throw new Error(`renderSubscribe length=${s.length}, expected >=6`);
  if (s.bytes[0] !== 0x82) throw new Error(`renderSubscribe[0]=${s.bytes[0]}, expected 0x82`);

  return { connectBytes: 22, subscribeMinBytes: 6 };
}

// === LLM 客户端 (live 模式) — 复用 34 模式 ===

async function createChatClient() {
  const { persistentConfig } = await import('../../core/persistent-config.js');
  const { createProvider } = await import('provider-kit');
  const cfg = persistentConfig.config;
  const providerId = cfg.current?.provider;
  if (!providerId) throw new Error('config.current.provider missing');
  const prov = cfg.providers?.[providerId];
  if (!prov) throw new Error(`config.providers.${providerId} missing`);
  const apiKey = prov.apiKey;
  if (!apiKey) throw new Error(`config.providers.${providerId}.apiKey missing`);
  const model = cfg.current?.model || prov.defaultModel || prov.model;
  // 49 prompt 1608 chars 容易撞 60s default timeout (§4.1). Override to 180s.
  const p = createProvider(providerId, apiKey, { timeout: 180000 });
  await p.connect(apiKey);
  return { provider: p, model };
}

// === dryRun: 验证 render tools + gold 通过 sandbox + 11 维评分 ===

export async function runDryRun() {
  // 1. 验证 render tools 字节
  const renderCheck = await verifyRenderTools();

  // 2. 校验 task.json prompt
  const prompt = await loadPrompt();
  if (prompt.length > 2000) {
    throw new Error(`prompt too long: ${prompt.length} chars (target < 2000)`);
  }
  if (prompt.split('\n').length > 80) {
    throw new Error(`prompt too many lines: ${prompt.split('\n').length} (target < 80)`);
  }

  // 3. 跑 gold 通过 sandbox (subTestA + subTestB)
  const goldArgs = { ...GOLD_TEST_ARGS, port: 1883 };
  const sandboxA = await runSandbox({
    source: GOLD_SOURCE,
    testArgs: goldArgs,
    sessionStore: GOLD_SESSION_STORE,
    refuseConnackCount: 0,
  });
  const sandboxB = await runSandbox({
    source: GOLD_SOURCE,
    testArgs: goldArgs,
    sessionStore: GOLD_SESSION_STORE,
    refuseConnackCount: 2,
  });

  // 4. 11 维评分
  const llmOutput = '```js\n' + GOLD_SOURCE + '\n```';
  const dims = scoreOne({ llmOutput, sandboxA, sandboxB });

  // 5. 验证 gold 11/11
  const fail = Object.entries(dims).filter(([k, v]) => k !== '_source' && v !== 1);
  if (fail.length > 0) {
    throw new Error(`gold failed dims: ${fail.map(([k]) => k).join(', ')} — sandbox or scoring is broken, do NOT run live`);
  }

  return {
    aggregate: aggregateScore([dims]),
    runs: [{ dims, source: GOLD_SOURCE, sandboxA, sandboxB }],
    calls: 0,
    dryRun: true,
    checks: {
      renderCheck,
      promptChars: prompt.length,
      promptLines: prompt.split('\n').length,
    },
  };
}

// === live 模式: 跑真 LLM 多次 ===

export async function runLive({ repeats = 15, model = null } = {}) {
  const chat = await createChatClient();
  const useModel = model || chat.model;
  const prompt = await loadPrompt();
  const goldArgs = { ...GOLD_TEST_ARGS, port: 1883 };
  const runs = [];
  let totalCalls = 0;

  for (let i = 0; i < repeats; i++) {
    const start = Date.now();
    let llmOutput = null;
    let sandboxA = null;
    let sandboxB = null;
    let dims = null;
    let llmError = null;

    try {
      // 240s 硬上限 per run (§4.1 长 prompt 风险: 60-180s 是常见区间)
      // max_tokens: 16000 (M3 默认 4096, M3 容易 over-think 然后 truncated)
      const r = await Promise.race([
        chat.provider.chat(useModel, [
          { role: 'user', content: prompt },
        ], { extra: { max_tokens: 16000 } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('llm-timeout-240s')), 240000)),
      ]);
      llmOutput = r?.content || r?.message?.content || '';
      totalCalls++;

      const source = extractSource(llmOutput);
      if (!source) throw new Error('no source extracted from LLM output');

      // Run both sub-tests in parallel
      [sandboxA, sandboxB] = await Promise.all([
        runSandbox({ source, testArgs: goldArgs, sessionStore: GOLD_SESSION_STORE, refuseConnackCount: 0 }),
        runSandbox({ source, testArgs: goldArgs, sessionStore: GOLD_SESSION_STORE, refuseConnackCount: 2 }),
      ]);
    } catch (e) {
      llmError = e.message || String(e);
    }

    if (llmOutput) {
      dims = scoreOne({ llmOutput, sandboxA, sandboxB });
    } else {
      // LLM failed or no output — score all dims as 0
      dims = {
        sourceExtracted: 0, functionShapeOk: 0,
        usesRenderConnect: 0, renderConnectArgsOk: 0,
        usesRenderSubscribe: 0, renderSubscribeArgsOk: 0,
        attemptsRetry: 0, readsSessionStore: 0,
        sandboxRan: 0, packetsCorrect: 0, retriesSurvivedFailure: 0,
      };
    }
    runs.push({ i, runtimeMs: Date.now() - start, dims, llmError, sandboxAError: sandboxA?.error, sandboxBError: sandboxB?.error });
  }

  return {
    aggregate: aggregateScore(runs.map((r) => r.dims)),
    runs,
    calls: totalCalls,
    model: useModel,
  };
}

// === compose 契约入口 ===

export async function run({ inputs = {} } = {}) {
  const { live = false, ...rest } = inputs;
  if (live) {
    return { outputs: await runLive(rest) };
  }
  return { outputs: await runDryRun() };
}

// === test() — 跟 34 模式一致, dryRun 跑通才进 live ===

const { ok, ng, skip, report } = create();
const NAME = '49-mqtt-resume (dryRun 默认, live 需 E49_LIVE=1)';

async function loadLiveArtifact() {
  const candidates = ['live-15run.json', 'live-run.json', 'live-3run.json'];
  for (const name of candidates) {
    const p = resolve(__dirname, name);
    try {
      const raw = await readFile(p, 'utf8');
      return { name, data: JSON.parse(raw) };
    } catch { /* try next */ }
  }
  return null;
}

async function test() {
  // dryRun 路径
  let r;
  try {
    r = await runDryRun();
    ok(`dryRun 跑通: gold 11/11, render tools 字节正确, prompt ${r.checks.promptChars} chars`);
    console.log('[49-dryRun] checks:', JSON.stringify(r.checks));
  } catch (e) {
    ng(`dryRun 失败: ${e.message}`);
    return report(NAME);
  }

  // live 路径 — 仅在 E49_LIVE=1 时跑
  if (process.env.E49_LIVE === '1') {
    try {
      const live = await runLive({ repeats: 3 });
      const agg = live.aggregate;
      ok(`live 跑完 ${live.calls} 次 (model=${live.model})`);
      ok(`overall=${agg.overall.toFixed(3)}, packetsCorrect=${agg.packetsCorrect.toFixed(3)}, retriesSurvivedFailure=${agg.retriesSurvivedFailure.toFixed(3)}`);
      // 保存 artifact
      const outPath = resolve(__dirname, 'live-3sample.json');
      await writeFile(outPath, JSON.stringify(live, null, 2));
      ok(`saved: live-3sample.json`);
      console.log('[49-live]', JSON.stringify(agg));
    } catch (e) {
      ng(`live 失败: ${e.message}`);
    }
  } else {
    skip('live 模式需 E49_LIVE=1 (跳过)');
  }

  // 历史 live artifact 摘要
  const artifact = await loadLiveArtifact();
  if (artifact) {
    const d = artifact.data;
    const a = d.aggregate;
    if (a) {
      ok(`历史 [${artifact.name}] n=${a.n}: overall=${a.overall.toFixed(3)}, packetsCorrect=${a.packetsCorrect.toFixed(3)}, retriesSurvivedFailure=${a.retriesSurvivedFailure.toFixed(3)}`);
    }
  } else {
    skip('无 live artifact');
  }

  report(NAME);
}

export { test };
