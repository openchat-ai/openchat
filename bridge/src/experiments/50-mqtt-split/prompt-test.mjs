// 50-mqtt-split/prompt-test.mjs
//
// 1-min mini-test: same E49 task but with extreme "force code" prompt.
// Compare 2 conditions:
//   A. Original E49 prompt (verbose, has skeleton)
//   B. Minimal "force code" prompt: NO prose allowed
//
// 2 calls each, 4 total. Total time ~3-4 min.
// Hypothesis: if B works but A doesn't, prompt design is the issue.

import { readFile, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { persistentConfig } from '../../core/persistent-config.js';
import { createProvider } from 'provider-kit';
import { runR1 } from './sandbox.mjs';
import { extractSource } from './scoring.mjs';
import { GOLD_TEST_ARGS } from './gold.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Original E49 prompt (verbose)
const e49Task = JSON.parse(await readFile(resolve(__dirname, '../49-mqtt-resume/task.json'), 'utf8'));
const originalPrompt = e49Task.task.prompt;

// Minimal "force code" prompt
const minimalPrompt = `Write ONLY a single \`\`\`js code block\`\`\` containing this function. No prose before, no prose after, no thinking, no explanation.

\`\`\`js
async function connectWithResume({host, port, clientId, sessionStore}) {
  // 1. Connect via net.connect, write CONNECT, retry 3 times on error
  // 2. After broker accepts, call sessionStore.getSubscriptions(clientId)
  // 3. For each stored sub, write SUBSCRIBE
  // 4. Return {connId: clientId, restoredCount, subscriptions: subs}
  // Globals: renderConnect({protoName, protoLevel, connectFlags, keepAlive, clientId}) -> {bytes, type, length}
  //          renderSubscribe({packetId, subscriptions}) -> {bytes, type, length}
  //          net.connect({host, port}, onConnect) factory
}
\`\`\`

Output ONLY the code block. Nothing else.`;

const cfg = persistentConfig.config;
const prov = cfg.providers?.[cfg.current.provider];
const p = createProvider(cfg.current.provider, prov.apiKey, { timeout: 180000 });
await p.connect(prov.apiKey);
const useModel = cfg.current.model || prov.defaultModel || prov.model;
console.log('model:', useModel);

async function llmCall(prompt, label) {
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      p.chat(useModel, [{ role: 'user', content: prompt }], { extra: { max_tokens: 16000 } }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout-180s')), 180000)),
    ]);
    const out = r?.content || r?.message?.content || '';
    const ms = Date.now() - t0;
    const src = extractSource(out);
    const hasFnDecl = src && /async\s+function\s+connectWithResume\s*\(/.test(src);
    const hasCode = src && /\{[\s\S]*\}/.test(src) && !/^[\s\S]*Wait, /.test(src);
    let sandboxOk = null;
    if (hasFnDecl) {
      const sa = await runR1({ source: src, testArgs: GOLD_TEST_ARGS, refuseConnackCount: 0 });
      sandboxOk = !sa.error && sa.packets && sa.packets.length > 0;
    }
    console.log(`  [${label}] ${ms}ms srcLen=${out.length} extracted=${src?.length || 0} hasFnDecl=${!!hasFnDecl} hasCode=${!!hasCode} sandboxOk=${sandboxOk}`);
    return { label, ms, srcLen: out.length, extractedLen: src?.length || 0, hasFnDecl: !!hasFnDecl, hasCode: !!hasCode, sandboxOk };
  } catch (e) {
    return { label, ms: Date.now() - t0, err: e.message || String(e) };
  }
}

const results = [];
console.log('\n=== A. Original E49 prompt (verbose, has skeleton) ===');
for (let i = 0; i < 2; i++) {
  const r = await llmCall(originalPrompt, `A.${i}`);
  results.push(r);
}

console.log('\n=== B. Minimal "force code" prompt ===');
for (let i = 0; i < 2; i++) {
  const r = await llmCall(minimalPrompt, `B.${i}`);
  results.push(r);
}

console.log('\n=== SUMMARY ===');
const a = results.filter(r => r.label.startsWith('A.'));
const b = results.filter(r => r.label.startsWith('B.'));
const fmt = (xs, k) => xs.filter(x => x[k]).length;
console.log(`A (original): hasFnDecl=${fmt(a, 'hasFnDecl')}/2, hasCode=${fmt(a, 'hasCode')}/2, sandboxOk=${fmt(a, 'sandboxOk')}/2`);
console.log(`B (minimal): hasFnDecl=${fmt(b, 'hasFnDecl')}/2, hasCode=${fmt(b, 'hasCode')}/2, sandboxOk=${fmt(b, 'sandboxOk')}/2`);

await writeFile(resolve(__dirname, 'prompt-test.json'), JSON.stringify({ results, summary: { a, b } }, null, 2));
console.log('saved: prompt-test.json');
