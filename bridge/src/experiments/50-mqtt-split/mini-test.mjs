// 50-mqtt-split/mini-test.mjs
//
// Quick mini-experiment to test 2 hypotheses:
//   H1: Model is fine, but preprocessSource doesn't strip reasoning prefixes
//   H2: Multiple samples (best-of-3) helps even without scaffold changes
//
// Runs 3-5 E49 calls in ~1-2 minutes. Outputs comparison:
//   - Run with current preprocessSource
//   - Run with reasoning-strip preprocessSource
//
// Time budget: ~2-3 min total (3 LLM calls × ~30-60s each)

import { writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { renderConnect, renderSubscribe } from '../lib/mqtt-render-tools.mjs';
import { extractSource } from './scoring.mjs';
import { runR1, runR2, runCombined } from './sandbox.mjs';
import { GOLD_SESSION_STORE_3, GOLD_TEST_ARGS } from './gold.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// === Reasoning-strip preprocessor ===
// Strips "Wait, " / "Let me " / "Hmm, " / "Actually, " prefixes that the LLM
// tends to write INSIDE the code block at the start.
function stripReasoning(src) {
  if (!src) return src;
  // Find the first line that LOOKS like a declaration (function / async function / const / let / var)
  // and drop everything before it
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^(async\s+function|function|const|let|var|export)\s/.test(t)) {
      return lines.slice(i).join('\n');
    }
  }
  return src;
}

// Enhanced preprocessSource: original + strip reasoning
const { preprocessSource: originalPreprocess } = await import('../49-mqtt-resume/sandbox.mjs');
function preprocessEnhanced(source) {
  const cleaned = originalPreprocess(source);
  return stripReasoning(cleaned);
}

// === LLM client ===
async function createChatClient() {
  const { persistentConfig } = await import('../../core/persistent-config.js');
  const { createProvider } = await import('provider-kit');
  const cfg = persistentConfig.config;
  const providerId = cfg.current?.provider;
  const prov = cfg.providers?.[providerId];
  const apiKey = prov.apiKey;
  const model = cfg.current?.model || prov.defaultModel || prov.model;
  const p = createProvider(providerId, apiKey, { timeout: 180000 });
  await p.connect(apiKey);
  return { provider: p, model };
}

async function llmCall(chat, model, prompt) {
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      chat.provider.chat(model, [{ role: 'user', content: prompt }], { extra: { max_tokens: 16000 } }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('llm-timeout-180s')), 180000)),
    ]);
    const out = r?.content || r?.message?.content || '';
    return { out, ms: Date.now() - t0, err: null };
  } catch (e) {
    return { out: '', ms: Date.now() - t0, err: e.message || String(e) };
  }
}

// === Load E49 task.json (the original E49 prompt) ===
const e49Task = JSON.parse(await readFile(resolve(__dirname, '../49-mqtt-resume/task.json'), 'utf8'));
const e49Prompt = e49Task.task.prompt;

console.log('=== Mini test: 3 E49 calls ===');
console.log('prompt chars:', e49Prompt.length);

const chat = await createChatClient();
const useModel = chat.model;
console.log('model:', useModel);

const results = [];
for (let i = 0; i < 3; i++) {
  console.log(`\n--- run ${i + 1}/3 ---`);
  const { out, ms, err } = await llmCall(chat, useModel, e49Prompt);
  if (err) {
    console.log(`  LLM ERROR: ${err} (${ms}ms)`);
    results.push({ i, rt_ms: ms, llmErr: err, hasFnDecl_raw: false, hasFnDecl_stripped: false, sandboxOk_stripped: false });
    continue;
  }
  const source = extractSource(out);
  console.log(`  LLM: ${ms}ms, srcLen=${out.length}, extractedSrcLen=${source?.length || 0}`);

  // Check if extracted source has function declaration
  const hasFnDecl = source && /async\s+function\s+connectWithResume\s*\(/.test(source);
  console.log(`  hasFnDecl (raw extract): ${hasFnDecl ? 'YES' : 'no'}`);

  // Try reasoning-strip preprocessing
  let stripped = null;
  let strippedHasFnDecl = false;
  if (source) {
    stripped = stripReasoning(source);
    strippedHasFnDecl = /async\s+function\s+connectWithResume\s*\(/.test(stripped);
    console.log(`  strippedSrcLen=${stripped.length}, hasFnDecl (after reasoning-strip): ${strippedHasFnDecl ? 'YES' : 'no'}`);
  }

  // Try running sandbox with the stripped source
  let sandboxOk = null;
  if (strippedHasFnDecl) {
    const sa = await runR1({ source: stripped, testArgs: GOLD_TEST_ARGS, refuseConnackCount: 0 });
    sandboxOk = !sa.error && sa.packets && sa.packets.length > 0;
    console.log(`  sandboxRan (with reasoning-strip): ${sandboxOk ? 'YES ✓' : 'no'} (${sa.packets?.length || 0} packets, err=${sa.error || '-'})`);
  }

  results.push({
    i,
    rt_ms: ms,
    srcLen_raw: out.length,
    srcLen_extracted: source?.length || 0,
    hasFnDecl_raw: !!hasFnDecl,
    hasFnDecl_stripped: strippedHasFnDecl,
    sandboxOk_stripped: sandboxOk,
  });
}

console.log('\n=== SUMMARY ===');
console.log('raw  functionShape:', results.filter(r => r.hasFnDecl_raw).length, '/', results.length);
console.log('strip functionShape:', results.filter(r => r.hasFnDecl_stripped).length, '/', results.length);
console.log('strip sandboxRan:  ', results.filter(r => r.sandboxOk_stripped).length, '/', results.length);

const out = { prompt: e49Prompt.slice(0, 100) + '...', model: useModel, results, summary: {
  rawFnShape: results.filter(r => r.hasFnDecl_raw).length,
  strippedFnShape: results.filter(r => r.hasFnDecl_stripped).length,
  strippedSandboxRan: results.filter(r => r.sandboxOk_stripped).length,
  n: results.length,
}};
await writeFile(resolve(__dirname, 'mini-test.json'), JSON.stringify(out, null, 2));
console.log('saved: mini-test.json');
