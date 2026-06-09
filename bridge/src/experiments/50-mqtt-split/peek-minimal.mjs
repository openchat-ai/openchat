// 50-mqtt-split/peek-minimal.mjs
// See what minimal prompt gets (1 call)

import { persistentConfig } from '../../core/persistent-config.js';
import { createProvider } from 'provider-kit';

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

const t0 = Date.now();
const r = await Promise.race([
  p.chat(useModel, [{ role: 'user', content: minimalPrompt }], { extra: { max_tokens: 16000 } }),
  new Promise((_, rej) => setTimeout(() => rej(new Error('timeout-180s')), 180000)),
]);
const out = r?.content || r?.message?.content || '';
console.log('ms=', Date.now() - t0, 'srcLen=', out.length);
const m = out.match(/```(?:js|javascript)?\s*([\s\S]*?)```/);
const src = m ? m[1].trim() : null;
console.log('=== EXTRACTED SOURCE (' + (src?.length || 0) + ' chars) ===');
console.log(src);
