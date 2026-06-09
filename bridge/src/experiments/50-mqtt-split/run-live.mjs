// 50-mqtt-split/run-live.mjs
//
// One-off live runner with:
//   - 180s per-LLM timeout (down from 240s in index.mjs)
//   - print progress to stdout after each iteration
//   - incremental save to live-15run.json after each iteration
//
// Usage: node --input-type=module run-live.mjs
// Env: E50_LIVE=1 (any value) to enable; OPENCHAT_PROVIDER etc from persistentConfig

import { writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runR1, runR2, runCombined } from './sandbox.mjs';
import { scoreOne, aggregateScore, extractSource } from './scoring.mjs';
import {
  GOLD_SESSION_STORE_0, GOLD_SESSION_STORE_3, GOLD_TEST_ARGS,
} from './gold.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, 'live-15run.json');

async function loadPrompt(which) {
  const filename = which === 'r1' ? 'task-r1.json' : 'task-r2.json';
  const raw = await (await import('fs/promises')).readFile(resolve(__dirname, filename), 'utf8');
  return JSON.parse(raw).task.prompt;
}

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
  const p = createProvider(providerId, apiKey, { timeout: 150000 });
  await p.connect(apiKey);
  return { provider: p, model };
}

async function llmCall(chat, model, prompt, label) {
  const t0 = Date.now();
  const r = await Promise.race([
    chat.provider.chat(model, [{ role: 'user', content: prompt }], { extra: { max_tokens: 16000 } }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('llm-timeout-180s')), 180000)),
  ]);
  const out = r?.content || r?.message?.content || '';
  console.log(`    [${label}] ${Date.now() - t0}ms, srcLen=${out.length}`);
  return out;
}

const REPEATS = 15;

const chat = await createChatClient();
const useModel = chat.model;
const r1Prompt = await loadPrompt('r1');
const r2Prompt = await loadPrompt('r2');
const runs = [];
let totalCalls = 0;

for (let i = 0; i < REPEATS; i++) {
  const start = Date.now();
  let r1LlmOutput = null;
  let r2LlmOutput = null;
  let r1subA = null, r1subB = null, r2subA = null, r2subB = null;
  let combinedA = null, combinedB = null;
  let llmError = null;

  try {
    // Round 1
    try {
      r1LlmOutput = await llmCall(chat, useModel, r1Prompt, `R1.${i}`);
      totalCalls++;
      const r1Source = extractSource(r1LlmOutput);
      if (!r1Source) throw new Error('no source extracted from R1 LLM output');
      [r1subA, r1subB] = await Promise.all([
        runR1({ source: r1Source, testArgs: GOLD_TEST_ARGS, refuseConnackCount: 0 }),
        runR1({ source: r1Source, testArgs: GOLD_TEST_ARGS, refuseConnackCount: 2 }),
      ]);
      console.log(`    [R1.${i}] subA.packets=${r1subA.packets?.length || 0} subB.packets=${r1subB.packets?.length || 0} subB.attemptCount=${r1subB.attemptCount}`);
    } catch (e) {
      const err = `R1: ${e.message || String(e)}`;
      llmError = llmError ? `${llmError}; ${err}` : err;
    }

    // Round 2
    try {
      r2LlmOutput = await llmCall(chat, useModel, r2Prompt, `R2.${i}`);
      totalCalls++;
      const r2Source = extractSource(r2LlmOutput);
      if (!r2Source) throw new Error('no source extracted from R2 LLM output');
      [r2subA, r2subB] = await Promise.all([
        runR2({ source: r2Source, testArgs: GOLD_TEST_ARGS, sessionStore: GOLD_SESSION_STORE_0 }),
        runR2({ source: r2Source, testArgs: GOLD_TEST_ARGS, sessionStore: GOLD_SESSION_STORE_3 }),
      ]);
      console.log(`    [R2.${i}] subA.packets=${r2subA.packets?.length || 0} subB.packets=${r2subB.packets?.length || 0} subB.restoredCount=${r2subB.returnValue?.restoredCount}`);
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
        console.log(`    [C.${i}] A.packets=${combinedA.packets?.length || 0} B.packets=${combinedB.packets?.length || 0} B.attemptCount=${combinedB.attemptCount} B.r2Count=${combinedB.r2Return?.restoredCount}`);
      }
    }
  } catch (e) {
    llmError = e.message || String(e);
  }

  const dims = scoreOne({ r1LlmOutput, r2LlmOutput, r1subA, r1subB, r2subA, r2subB, combinedA, combinedB });
  const hits = Object.entries(dims).filter(([k, v]) => k.startsWith('_') ? false : v === 1).map(([k]) => k);
  console.log(`  i=${i} rt=${Date.now() - start}ms hits=${hits.length}/14 err=${llmError || '-'} ${hits.length > 0 ? '[' + hits.join(',') + ']' : ''}`);

  runs.push({
    i,
    runtimeMs: Date.now() - start,
    dims,
    llmError,
    r1subAError: r1subA?.error, r1subBError: r1subB?.error,
    r2subAError: r2subA?.error, r2subBError: r2subB?.error,
    combinedAError: combinedA?.error, combinedBError: combinedB?.error,
  });

  // Incremental save after each iteration
  const partial = { aggregate: aggregateScore(runs.map((r) => r.dims)), runs, calls: totalCalls, model: useModel, partial: true };
  await writeFile(OUT_PATH, JSON.stringify(partial, null, 2));
  console.log(`    saved partial (${i + 1}/${REPEATS})`);
}

const final = { aggregate: aggregateScore(runs.map((r) => r.dims)), runs, calls: totalCalls, model: useModel };
await writeFile(OUT_PATH, JSON.stringify(final, null, 2));
console.log('=== FINAL ===');
console.log(JSON.stringify(final.aggregate, null, 2));
console.log('saved:', OUT_PATH);
