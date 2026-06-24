import { createHash } from 'node:crypto';
import { qiniuList, qiniuGet, qiniuPut, qiniuDelete } from '../experiments/lib/storage-lib.mjs';
import { persistentConfig } from './core-config.mjs';
import { createProvider, epcFromMessage, encodeEpcFrame, EPC_TYPE_LLM, EPC_SUB_CONTENT, EPC_SUB_THINKING, EPC_SUB_META, EPC_SUB_ERROR } from 'provider-kit';
import { parseMsgPayload } from '../experiments/lib/misc-lib.mjs';

const POLL_MS = 3000;
const PREFIX = 'oc/chat/';
const seenKeys = new Set();
let timer = null;
const startupTs = Date.now();

// === invariants ===
// - r.epc 是 provider-kit 处理后的 EPC 二进制（已含 thinking/content/meta 帧）
// - 流式: 边收 chunk 边写 {ts}-stream.bin，结束后改名 {ts}-reply.epc + sentinel meta
// - 非流式回退: provider 无 chatStream 或调用异常 → 完整 response
// - 旁路: 默认透传 r.epc；流式时自构 EPC 帧；failback 仅在 r.epc 缺失时

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
  const ts = key.match(/(\d+)\.msg$/)[1];
  const streamKey = key.replace(/\.msg$/, '-stream.bin');
  const replyKey = key.replace(/\.msg$/, '-reply.epc');

  // === Try streaming first (provider-kit supports chatStream) ===
  if (typeof p.chatStream === 'function') {
    try {
      await processStream(p, parsed, model, streamKey, replyKey, ts);
      return;
    } catch (e) {
      console.debug(`[C1] stream fail, fallback non-stream: ${e.message}`);
    }
  }

  // === Non-streaming fallback ===
  await processNonStream(p, parsed, model, replyKey);
}

async function processStream(p, parsed, model, streamKey, replyKey, ts) {
  let epcBuf = Buffer.alloc(0);
  let lastWrite = 0;
  const WRITE_MS = 200;

  for await (const chunk of p.chatStream(model, [{ role: 'user', content: parsed.text }], { timeout: 60000 })) {
    if (chunk.type === 'thinking' && chunk.content) {
      epcBuf = Buffer.concat([epcBuf, encodeEpcFrame(EPC_TYPE_LLM, EPC_SUB_THINKING, Buffer.from(chunk.content, 'utf8'))]);
    } else if (chunk.type === 'content' && chunk.content) {
      epcBuf = Buffer.concat([epcBuf, encodeEpcFrame(EPC_TYPE_LLM, EPC_SUB_CONTENT, Buffer.from(chunk.content, 'utf8'))]);
    }
    // tool_calls 暂不处理 (chat 场景不依赖)
    const now = Date.now();
    if (now - lastWrite >= WRITE_MS) {
      await qiniuPut(streamKey, epcBuf).catch(() => {});
      lastWrite = now;
    }
  }

  // 流式结束: 写最终 replyKey，加 sentinel meta
  const meta = { mode: 'streamed', ts: Date.now(), frames: inspectEpc(epcBuf).frames, srcHash: sha8(epcBuf) };
  epcBuf = Buffer.concat([epcBuf, epcFromMessage({ meta })]);
  await qiniuPut(replyKey, epcBuf);
  // 删除 stream 文件，避免 Flutter 误判
  await qiniuDelete(streamKey).catch(() => {});
  console.debug(`[C1] stream ${ts} done bytes=${epcBuf.length} frames=${meta.frames}`);
}

async function processNonStream(p, parsed, model, replyKey) {
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
      if (sha8(epcBuf) === srcHash) {
        mode = 'passthrough';
        diag = inspectEpc(epcBuf);
      } else {
        mode = 'bypass_hash_fail';
        epcBuf = epcFromMessage({ content: r.content || '' });
        diag = inspectEpc(epcBuf);
      }
    } else {
      mode = 'fallback_no_epc';
      epcBuf = epcFromMessage({ content: r.content || '' });
      diag = inspectEpc(epcBuf);
    }
  } catch (e) {
    mode = 'error';
    epcBuf = epcFromMessage({ error: e.message });
    diag = inspectEpc(epcBuf);
  }

  const metaBuf = epcFromMessage({
    meta: { mode, srcHash, ts: Date.now(), frames: diag.frames, types: diag.types },
  });
  epcBuf = Buffer.concat([epcBuf, metaBuf]);

  await qiniuPut(replyKey, epcBuf);
  console.debug(`[C1] nonstream ${replyKey} mode=${mode} bytes=${epcBuf.length} frames=${diag.frames}`);
}
