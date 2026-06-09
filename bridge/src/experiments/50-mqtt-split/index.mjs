// 50-mqtt-split/index.mjs
//
// E50: 拆任务 — connectWithRetry + restoreSubscriptions (2 轮 E40 档)
// 测弱模型 (MiniMax-M3) 在 2 轮 LLM 调用下能否端到端产出可执行的 mqtt connect+resume。
//
// 模式 (跟 34/35/40/49 一致):
//   - test() 默认走 dryRun (无 LLM, 跑 gold 验 sandbox)
//   - runLive({ repeats }) 才发真 LLM, 需 E50_LIVE=1
//   - run({ inputs }) 是 compose 契约入口

import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { create } from '../lib/report.mjs';
import { runR1, runR2, runCombined } from './sandbox.mjs';
import { scoreOne, aggregateScore, extractSource } from './scoring.mjs';
import {
  GOLD_R1_SOURCE, GOLD_R2_SOURCE,
  GOLD_SESSION_STORE_0, GOLD_SESSION_STORE_3, GOLD_TEST_ARGS,
} from './gold.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// === META ===
export const META = {
  id: '50-mqtt-split',
  name: '拆任务: connectWithRetry + restoreSubscriptions (2 轮 E40 档) — 5 件套对组合 E40 档子任务的支持验证',
  status: 'closed-loop',
  needsEnv: [],
  needsEnvLive: ['OPENCHAT_PROVIDER'],
  inputs: [
    { name: 'live', type: 'boolean', required: false, default: false,
      description: 'true = 跑真 LLM 调用; false = dryRun (默认)' },
    { name: 'repeats', type: 'number', required: false, default: 15,
      description: 'run 次数 (live 模式); 每次含 2 次 LLM call, 共 2×repeats 次' },
    { name: 'model', type: 'string', required: false, default: null,
      description: '覆盖默认 model (live 模式)' },
  ],
  outputs: [
    { name: 'aggregate', type: 'object', description: '14 维 hit rate (5+5+4)' },
    { name: 'runs', type: 'array', description: '每次 run 详细' },
    { name: 'calls', type: 'number', description: '总 LLM 调用次数 (= 2 × repeats)' },
  ],
  deps: ['mqtt-resume'],
};

// === Helpers ===
async function loadPrompt(which) {
  const filename = which === 'r1' ? 'task-r1.json' : 'task-r2.json';
  const raw = await readFile(resolve(__dirname, filename), 'utf8');
  return JSON.parse(raw).task.prompt;
}

// === LLM 客户端 (live 模式) — 复用 49 模式 ===
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
  const p = createProvider(providerId, apiKey, { timeout: 180000 });
  await p.connect(apiKey);
  return { provider: p, model };
}

// === dryRun: 验证 gold 通过所有 14 维 ===
export async function runDryRun() {
  // 1. 校验两个 prompt
  const r1Prompt = await loadPrompt('r1');
  const r2Prompt = await loadPrompt('r2');
  if (r1Prompt.length > 1500) {
    throw new Error(`R1 prompt too long: ${r1Prompt.length} chars (target < 1500)`);
  }
  if (r2Prompt.length > 1500) {
    throw new Error(`R2 prompt too long: ${r2Prompt.length} chars (target < 1500)`);
  }

  // 2. 跑 gold R1 (subA: refuse=0, subB: refuse=2)
  const r1subA = await runR1({
    source: GOLD_R1_SOURCE,
    testArgs: GOLD_TEST_ARGS,
    refuseConnackCount: 0,
  });
  const r1subB = await runR1({
    source: GOLD_R1_SOURCE,
    testArgs: GOLD_TEST_ARGS,
    refuseConnackCount: 2,
  });

  // 3. 跑 gold R2 (subA: 0 stored, subB: 3 stored)
  const r2subA = await runR2({
    source: GOLD_R2_SOURCE,
    testArgs: GOLD_TEST_ARGS,
    sessionStore: GOLD_SESSION_STORE_0,
    refuseConnackCount: 0,
  });
  const r2subB = await runR2({
    source: GOLD_R2_SOURCE,
    testArgs: GOLD_TEST_ARGS,
    sessionStore: GOLD_SESSION_STORE_3,
    refuseConnackCount: 0,
  });

  // 4. 跑 gold Combined (A: 0 stored + refuse=0, B: 3 stored + refuse=2)
  const combinedA = await runCombined({
    r1Source: GOLD_R1_SOURCE, r2Source: GOLD_R2_SOURCE,
    testArgs: GOLD_TEST_ARGS, sessionStore: GOLD_SESSION_STORE_0,
    refuseConnackCount: 0,
  });
  const combinedB = await runCombined({
    r1Source: GOLD_R1_SOURCE, r2Source: GOLD_R2_SOURCE,
    testArgs: GOLD_TEST_ARGS, sessionStore: GOLD_SESSION_STORE_3,
    refuseConnackCount: 2,
  });

  // 5. 14 维评分
  const r1LlmOutput = '```js\n' + GOLD_R1_SOURCE + '\n```';
  const r2LlmOutput = '```js\n' + GOLD_R2_SOURCE + '\n```';
  const dims = scoreOne({ r1LlmOutput, r2LlmOutput, r1subA, r1subB, r2subA, r2subB, combinedA, combinedB });

  // 6. 验证 gold 14/14
  const fail = Object.entries(dims).filter(([k, v]) => k.startsWith('_') ? false : v !== 1);
  if (fail.length > 0) {
    throw new Error(`gold failed dims: ${fail.map(([k]) => k).join(', ')} — sandbox or scoring is broken, do NOT run live`);
  }

  return {
    aggregate: aggregateScore([dims]),
    runs: [{ dims, r1subA, r1subB, r2subA, r2subB, combinedA, combinedB }],
    calls: 0,
    dryRun: true,
    checks: {
      r1PromptChars: r1Prompt.length,
      r2PromptChars: r2Prompt.length,
    },
  };
}

// === live 模式: 跑真 LLM 多次 ===
async function llmCallWithTimeout(chat, model, prompt, timeoutMs = 240000) {
  const r = await Promise.race([
    chat.provider.chat(model, [{ role: 'user', content: prompt }], { extra: { max_tokens: 16000 } }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('llm-timeout-240s')), timeoutMs)),
  ]);
  return r?.content || r?.message?.content || '';
}

export async function runLive({ repeats = 15, model = null } = {}) {
  const chat = await createChatClient();
  const useModel = model || chat.model;
  const r1Prompt = await loadPrompt('r1');
  const r2Prompt = await loadPrompt('r2');
  const runs = [];
  let totalCalls = 0;

  for (let i = 0; i < repeats; i++) {
    const start = Date.now();
    let r1LlmOutput = null;
    let r2LlmOutput = null;
    let r1subA = null, r1subB = null, r2subA = null, r2subB = null;
    let combinedA = null, combinedB = null;
    let llmError = null;

    try {
      // Round 1: connectWithRetry
      try {
        r1LlmOutput = await llmCallWithTimeout(chat, useModel, r1Prompt);
        totalCalls++;
        const r1Source = extractSource(r1LlmOutput);
        if (!r1Source) throw new Error('no source extracted from R1 LLM output');
        [r1subA, r1subB] = await Promise.all([
          runR1({ source: r1Source, testArgs: GOLD_TEST_ARGS, refuseConnackCount: 0 }),
          runR1({ source: r1Source, testArgs: GOLD_TEST_ARGS, refuseConnackCount: 2 }),
        ]);
      } catch (e) {
        if (!llmError) llmError = `R1: ${e.message || String(e)}`;
      }

      // Round 2: restoreSubscriptions (only run if R1 produced source)
      try {
        r2LlmOutput = await llmCallWithTimeout(chat, useModel, r2Prompt);
        totalCalls++;
        const r2Source = extractSource(r2LlmOutput);
        if (!r2Source) throw new Error('no source extracted from R2 LLM output');
        [r2subA, r2subB] = await Promise.all([
          runR2({ source: r2Source, testArgs: GOLD_TEST_ARGS, sessionStore: GOLD_SESSION_STORE_0 }),
          runR2({ source: r2Source, testArgs: GOLD_TEST_ARGS, sessionStore: GOLD_SESSION_STORE_3 }),
        ]);
      } catch (e) {
        const err = `R2: ${e.message || String(e)}`;
        llmError = llmError ? `${llmError}; ${err}` : err;
      }

      // Combined (only if both R1 and R2 produced source)
      if (r1LlmOutput && r2LlmOutput) {
        const r1Source = extractSource(r1LlmOutput);
        const r2Source = extractSource(r2LlmOutput);
        if (r1Source && r2Source) {
          [combinedA, combinedB] = await Promise.all([
            runCombined({
              r1Source, r2Source,
              testArgs: GOLD_TEST_ARGS, sessionStore: GOLD_SESSION_STORE_0,
              refuseConnackCount: 0,
            }),
            runCombined({
              r1Source, r2Source,
              testArgs: GOLD_TEST_ARGS, sessionStore: GOLD_SESSION_STORE_3,
              refuseConnackCount: 2,
            }),
          ]);
        }
      }
    } catch (e) {
      llmError = e.message || String(e);
    }

    const dims = scoreOne({ r1LlmOutput, r2LlmOutput, r1subA, r1subB, r2subA, r2subB, combinedA, combinedB });
    runs.push({
      i,
      runtimeMs: Date.now() - start,
      dims,
      llmError,
      r1subAError: r1subA?.error, r1subBError: r1subB?.error,
      r2subAError: r2subA?.error, r2subBError: r2subB?.error,
      combinedAError: combinedA?.error, combinedBError: combinedB?.error,
    });
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

// === test() ===
const { ok, ng, skip, report } = create();
const NAME = '50-mqtt-split (dryRun 默认, live 需 E50_LIVE=1)';

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
  let r;
  try {
    r = await runDryRun();
    ok(`dryRun 跑通: gold 14/14, R1 prompt ${r.checks.r1PromptChars} chars, R2 prompt ${r.checks.r2PromptChars} chars`);
    console.log('[50-dryRun] checks:', JSON.stringify(r.checks));
  } catch (e) {
    ng(`dryRun 失败: ${e.message}`);
    return report(NAME);
  }

  if (process.env.E50_LIVE === '1') {
    try {
      const live = await runLive({ repeats: 3 });
      const agg = live.aggregate;
      ok(`live 跑完 ${live.calls} 次 (model=${live.model})`);
      ok(`overall=${agg.overall.toFixed(3)}`);
      ok(`r1SandboxRan=${agg.r1SandboxRan.toFixed(3)}, r1RetriesSurvivedFailure=${agg.r1RetriesSurvivedFailure.toFixed(3)}`);
      ok(`r2SandboxRan=${agg.r2SandboxRan.toFixed(3)}, r2PacketsCorrect=${agg.r2PacketsCorrect.toFixed(3)}`);
      ok(`combinedSandboxRan=${agg.combinedSandboxRan.toFixed(3)}, combinedRetries=${agg.combinedRetries.toFixed(3)}, combinedPackets=${agg.combinedPackets.toFixed(3)}, combinedEndToEnd=${agg.combinedEndToEnd.toFixed(3)}`);
      const outPath = resolve(__dirname, 'live-3sample.json');
      await writeFile(outPath, JSON.stringify(live, null, 2));
      ok(`saved: live-3sample.json`);
      console.log('[50-live]', JSON.stringify(agg));
    } catch (e) {
      ng(`live 失败: ${e.message}`);
    }
  } else {
    const art = await loadLiveArtifact();
    if (art) {
      const a = art.data.aggregate;
      ok(`loaded live artifact: ${art.name} (n=${a.n}, overall=${a.overall.toFixed(3)})`);
    } else {
      skip('no live artifact yet (set E50_LIVE=1 to generate)');
    }
  }

  return report(NAME);
}

// CLI entry: `node index.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  test().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
