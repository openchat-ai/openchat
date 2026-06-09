// 50-mqtt-split/best-of-n.mjs
//
// Best-of-N test: 5 calls with minimal prompt.
// Hypothesis: M3 in some calls will write compilable code, some won't.
// Time: ~5-8 min (5 calls × ~100-150s each).

import { readFile, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { persistentConfig } from '../../core/persistent-config.js';
import { createProvider } from 'provider-kit';
import { runR1 } from './sandbox.mjs';
import { extractSource } from './scoring.mjs';
import { GOLD_TEST_ARGS } from './gold.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

async function oneCall(idx) {
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      p.chat(useModel, [{ role: 'user', content: minimalPrompt }], { extra: { max_tokens: 16000 } }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout-180s')), 180000)),
    ]);
    const out = r?.content || r?.message?.content || '';
    const ms = Date.now() - t0;
    const src = extractSource(out);
    const hasFnDecl = !!(src && /async\s+function\s+connectWithResume\s*\(/.test(src));
    let sandboxOk = null, sandboxErr = null, packetCount = 0;
    if (hasFnDecl) {
      const sa = await runR1({ source: src, testArgs: GOLD_TEST_ARGS, refuseConnackCount: 0 });
      sandboxOk = !sa.error && sa.packets && sa.packets.length > 0;
      sandboxErr = sa.error;
      packetCount = sa.packets?.length || 0;
    }
    return { idx, ms, srcLen: out.length, extractedLen: src?.length || 0, hasFnDecl, sandboxOk, sandboxErr, packetCount };
  } catch (e) {
    return { idx, ms: Date.now() - t0, err: e.message || String(e) };
  }
}

const N = 5;
const results = [];
for (let i = 0; i < N; i++) {
  const r = await oneCall(i);
  const summary = r.err
    ? `err=${r.err}`
    : `srcLen=${r.srcLen} extracted=${r.extractedLen} hasFnDecl=${r.hasFnDecl} sandboxOk=${r.sandboxOk} pkts=${r.packetCount} err=${r.sandboxErr || '-'}`;
  console.log(`[${i + 1}/${N}] ${r.ms}ms ${summary}`);
  results.push(r);
}

const valid = results.filter(r => !r.err);
const hasFnDecl = valid.filter(r => r.hasFnDecl);
const sandboxOk = valid.filter(r => r.sandboxOk);
console.log('\n=== SUMMARY (best-of-5 minimal prompt) ===');
console.log(`valid: ${valid.length}/${N}`);
console.log(`hasFnDecl: ${hasFnDecl.length}/${N}`);
console.log(`sandboxOk: ${sandboxOk.length}/${N}`);

await writeFile(resolve(__dirname, 'best-of-n.json'), JSON.stringify({ results, summary: { n: N, valid: valid.length, hasFnDecl: hasFnDecl.length, sandboxOk: sandboxOk.length } }, null, 2));
console.log('saved: best-of-n.json');
