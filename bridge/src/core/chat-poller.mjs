import { qiniuList, qiniuGet, qiniuPut } from '../experiments/lib/storage-lib.mjs';
import { persistentConfig } from './core-config.mjs';
import { createProvider, parseEpcPayload } from 'provider-kit';
import { parseMsgPayload } from '../experiments/lib/misc-lib.mjs';

const POLL_MS = 3000;
const PREFIX = 'oc/chat/';
const seenKeys = new Set();
let timer = null;

function getProvider() {
  const name = persistentConfig.getCurrentProvider();
  const key = persistentConfig.getApiKey(name);
  const model = persistentConfig.getCurrentModel();
  if (!key) return null;
  const p = createProvider(name, key, { defaultModel: model });
  p.connect(key).catch(() => {});
  return p;
}

export async function startChatPoll() {
  const p = getProvider();
  if (!p) return;
  loop(p);
}

function loop(p) {
  pollOnce(p).catch(() => {}).finally(() => {
    timer = setTimeout(() => loop(p), POLL_MS);
  });
}

export function stop() {
  if (timer) { clearTimeout(timer); timer = null; }
}

async function pollOnce(p) {
  let keys;
  try { keys = await qiniuList(PREFIX); } catch { return; }
  for (const k of keys) {
    if (!k.endsWith('.msg') || seenKeys.has(k)) continue;
    seenKeys.add(k);
    processOne(p, k).catch(e => console.debug('[C1] fail:', e.message));
  }
}

async function processOne(p, key) {
  const raw = await qiniuGet(key);
  if (!raw || !raw.length) return;
  const parsed = parseMsgPayload(key, raw);
  if (!parsed) return;
  const model = persistentConfig.getCurrentModel();
  const rk = key.replace(/\.msg$/, '-reply.json');
  try {
    const r = await p.chat(model, [{ role: 'user', content: parsed.text }], { timeout: 30000 });
    const epc = parseEpcPayload(r.epc);
    const text = epc.content || r.content || '';
    const reply = { text, meta: {} };
    if (epc.reasoningContent) reply.reasoning = epc.reasoningContent;
    await qiniuPut(rk, Buffer.from(JSON.stringify(reply), 'utf8'));
  } catch (e) {
    await qiniuPut(rk, Buffer.from(JSON.stringify({ text: '', error: e.message }), 'utf8')).catch(() => {});
  }
}
