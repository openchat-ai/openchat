import { createHash } from 'node:crypto';
import { qiniuList, qiniuGet, qiniuPut } from '../experiments/lib/storage-lib.mjs';
import { persistentConfig } from './core-config.mjs';
import { createProvider, parseEpcPayload, epcFromMessage } from 'provider-kit';
import { parseMsgPayload } from '../experiments/lib/misc-lib.mjs';

const POLL_MS = 3000;
const PREFIX = 'oc/chat/';
const seenKeys = new Set();
let timer = null;
const startupTs = Date.now();

// === invariants ===
// - r.epc 是 provider-kit 处理后的 EPC 二进制（已含 thinking/content/meta 帧）
// - 默认策略: 透传 r.epc，零变换
// - 仅当 r.epc 缺失/损坏/调用异常时降级到 epcFromMessage
// - 末尾追加 sentinel meta 帧标记 mode + frames 计数，下游可验证

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

function sha8(buf) {
  return createHash('md5').update(buf).digest('hex').slice(0, 8);
}

function inspectEpc(buf) {
  const out = { frames: 0, types: [], totalBytes: buf.length };
  let off = 0;
  while (off + 8 <= buf.length) {
    if (buf[off] !== 0xBB) break;
    const t = buf[off + 1], s = buf[off + 2];
    const pl = (buf[off + 3] << 16) | (buf[off + 4] << 8) | buf[off + 5];
    if (off + 6 + pl + 2 > buf.length) break;
    out.frames++;
    out.types.push(`${t.toString(16)}/${s.toString(16)}`);
    off += 6 + pl + 2;
  }
  return out;
}

async function pollOnce(p) {
  let keys;
  try { keys = await qiniuList(PREFIX); } catch { return; }
  const ts = (k) => { const m = k.match(/(\d+)\.msg$/); return m ? parseInt(m[1], 10) : 0; };
  keys = keys
    .filter(k => k.endsWith('.msg') && !seenKeys.has(k))
    // 只处理本次 bridge 启动后到达的消息 (防御: 不重试历史遗留失败)
    .filter(k => ts(k) >= startupTs)
    .sort((a, b) => ts(b) - ts(a));
  for (const k of keys) {
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
  const rk = key.replace(/\.msg$/, '-reply.epc');

  let epcBuf;
  let mode = 'unknown';
  let diag = {};
  let srcHash = '';

  try {
    const r = await p.chat(model, [{ role: 'user', content: parsed.text }], { timeout: 30000 });

    if (r.epc && r.epc.length > 0) {
      // === BYPASS: r.epc 已是 provider-kit 处理好的 EPC，直接透传 ===
      srcHash = sha8(r.epc);
      epcBuf = r.epc;
      // 旁路校验: 透传后 hash 必须不变（理论上不会变，但检查防御性）
      if (sha8(epcBuf) === srcHash) {
        mode = 'passthrough';
        diag = inspectEpc(epcBuf);
      } else {
        // 透传 hash 校验失败 — 不可能但防御性降级
        mode = 'bypass_hash_fail';
        epcBuf = epcFromMessage({ content: r.content || '' });
        diag = inspectEpc(epcBuf);
      }
    } else {
      // === FALLBACK: r.epc 缺失，降级用 r.content 构造 ===
      mode = 'fallback_no_epc';
      epcBuf = epcFromMessage({ content: r.content || '' });
      diag = inspectEpc(epcBuf);
    }
  } catch (e) {
    // === ERROR path: 显式 error 帧，下游可识别 ===
    mode = 'error';
    epcBuf = epcFromMessage({ error: e.message });
    diag = inspectEpc(epcBuf);
  }

  // === SENTINEL: 追加 meta 帧标记 mode + 帧数 ===
  const metaBuf = epcFromMessage({
    meta: { mode, srcHash, ts: Date.now(), frames: diag.frames, types: diag.types },
  });
  epcBuf = Buffer.concat([epcBuf, metaBuf]);

  await qiniuPut(rk, epcBuf);
  console.debug(`[C1] ${key} mode=${mode} bytes=${epcBuf.length} frames=${diag.frames} srcHash=${srcHash}`);
}
