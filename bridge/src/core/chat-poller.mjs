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
    const reasoning = pickReasoning(epc, r.raw);
    const reply = { text, meta: {} };
    if (reasoning) reply.reasoning = reasoning;
    await qiniuPut(rk, Buffer.from(JSON.stringify(reply), 'utf8'));
  } catch (e) {
    await qiniuPut(rk, Buffer.from(JSON.stringify({ text: '', error: e.message }), 'utf8')).catch(() => {});
  }
}

const REASONING_KEYS = [
  'reasoning', 'reasoning_content', 'reasoningContent',
  'thinking', 'thought', 'chainOfThought', 'chain_of_thought',
  'cot', 'analysis', 'inner_monologue', 'innerMonologue',
  'reflexion', 'reflection', 'scratchpad', 'plan',
];

function pickReasoning(epc, raw) {
  if (epc?.reasoningContent) return epc.reasoningContent;
  const details = raw?.choices?.[0]?.message?.reasoning_details;
  if (Array.isArray(details)) {
    const t = details.find(d => d?.type === 'reasoning.text' && d.text);
    if (t) return t.text;
  }
  const msg = raw?.choices?.[0]?.message;
  if (!msg || typeof msg !== 'object') return '';
  for (const k of REASONING_KEYS) {
    const v = msg[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}
