import { createHash } from 'node:crypto';
import { qiniuList, qiniuGet, qiniuPut, qiniuDelete } from '../experiments/lib/storage-lib.mjs';
import { persistentConfig } from './core-config.mjs';
import { createProvider, epcFromMessage, encodeEpcFrame, EPC_TYPE_LLM, EPC_SUB_CONTENT, EPC_SUB_THINKING, EPC_SUB_META, EPC_SUB_ERROR } from 'provider-kit';
import { parseChatPayload } from '../experiments/lib/misc-lib.mjs';

const POLL_MS = 3000;
const PREFIX = 'oc/chat/';
const seenKeys = new Set();
let timer = null;
const startupTs = Date.now();

// === invariants ===
// - r.epc 是 provider-kit 处理后的 EPC 二进制（已含 thinking/content/meta 帧）
// - 流式: 边收 chunk 边写 {ts}-stream.bin，结束后写 {ts}-reply.epc + sentinel meta
// - 非流式回退: provider 无 chatStream 或调用异常 → 完整 response
// - BYPASS 门（流式）: 每 chunk encodeEpcFrame → validateEpcFrame → 失败则 bypassText 入 meta
// - BYPASS 门（非流式）: validateEpcBuffer(r.epc) → 失败则 raw text 入 meta bypassText
// - bypass=true 时 meta.bypassText 含原始 LLM 文本，Flutter 直接显示（零 EPC content 处理）
// - 语音: on-device ASR 转文字后走 .epc, 桥上不处理 .enc（仅用于本地播放）

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

// === BYPASS GATE: validate EPC frame structure ===
function validateEpcFrame(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 9) return false;
  if (buf[0] !== 0xBB || buf[buf.length - 1] !== 0x7E) return false;
  const plen = (buf[3] << 16) | (buf[4] << 8) | buf[5];
  if (6 + plen + 2 !== buf.length) return false;
  let cs = 0;
  for (let i = 1; i < buf.length - 2; i++) cs ^= buf[i];
  return cs === buf[buf.length - 2];
}

// === BYPASS GATE: validate multi-frame EPC buffer ===
function validateEpcBuffer(buf) {
  let off = 0;
  while (off + 8 <= buf.length) {
    if (buf[off] !== 0xBB) return false;
    const plen = (buf[off + 3] << 16) | (buf[off + 4] << 8) | buf[off + 5];
    if (off + 6 + plen + 2 > buf.length) return false;
    const frame = buf.subarray(off, off + 6 + plen + 2);
    if (!validateEpcFrame(frame)) return false;
    off += 6 + plen + 2;
  }
  return off === buf.length;
}

async function pollOnce(p) {
  let keys;
  try { keys = await qiniuList(PREFIX); } catch { return; }
  const tsEpc = (k) => { const m = k.match(/(\d+)\.epc$/); return m ? parseInt(m[1], 10) : 0; };
  const tsEnc = (k) => { const m = k.match(/(\d+)\.enc$/); return m ? parseInt(m[1], 10) : 0; };
  const epcKeys = keys
    .filter(k => k.endsWith('.epc') && !k.endsWith('-reply.epc') && !seenKeys.has(k))
    .filter(k => tsEpc(k) >= startupTs)
    .sort((a, b) => tsEpc(b) - tsEpc(a));
  for (const k of epcKeys) {
    seenKeys.add(k);
    processOne(p, k).catch(e => console.debug('[C1] epc fail:', e.message));
  }
}

async function processOne(p, key) {
  const raw = await qiniuGet(key);
  if (!raw || !raw.length) return;
  const parsed = parseChatPayload(key, raw);
  if (!parsed) return;
  const model = persistentConfig.getCurrentModel();
  const ts = key.match(/(\d+)\.epc$/)[1];
  const streamKey = key.replace(/\.epc$/, '-stream.bin');
  const replyKey = key.replace(/\.epc$/, '-reply.epc');

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
  let bypassed = false;
  let bypassText = '';

  for await (const chunk of p.chatStream(model, [{ role: 'user', content: parsed.text }], { timeout: 60000 })) {
    // === BYPASS ENTRY: capture raw chunk content ===
    const rawText = chunk.content || '';
    const isThinking = chunk.type === 'thinking';
    const isContent = chunk.type === 'content';

    // === PROCESSING ===
    let frame = null;
    let frameOk = false;
    if (isThinking && rawText) {
      frame = encodeEpcFrame(EPC_TYPE_LLM, EPC_SUB_THINKING, Buffer.from(rawText, 'utf8'));
      frameOk = validateEpcFrame(frame);
    } else if (isContent && rawText) {
      frame = encodeEpcFrame(EPC_TYPE_LLM, EPC_SUB_CONTENT, Buffer.from(rawText, 'utf8'));
      frameOk = validateEpcFrame(frame);
    }

    if (frame && frameOk) {
      // === BYPASS EXIT: processing verified → safe to use ===
      epcBuf = Buffer.concat([epcBuf, frame]);
    } else if (rawText) {
      // === BYPASS FALLBACK: zero processing, raw text stored in meta ===
      bypassed = true;
      bypassText += rawText;
    }
    // tool_calls 暂不处理 (chat 场景不依赖)

    await qiniuPut(streamKey, epcBuf).catch(() => {});
  }

  const meta = { mode: 'streamed', bypass: bypassed, bypassText: bypassed ? bypassText : undefined, ts: Date.now(), frames: inspectEpc(epcBuf).frames, srcHash: sha8(epcBuf) };
  epcBuf = Buffer.concat([epcBuf, epcFromMessage({ meta })]);
  await qiniuPut(replyKey, epcBuf);
  // 删除 stream 文件，避免 Flutter 误判
  await qiniuDelete(streamKey).catch(() => {});
  console.debug(`[C1] stream ${ts} done bytes=${epcBuf.length} frames=${meta.frames} bypass=${bypassed}`);
}

async function processNonStream(p, parsed, model, replyKey) {
  let epcBuf;
  let mode = 'unknown';
  let bypass = false;
  let diag = {};
  let rawContent = '';

  try {
    const r = await p.chat(model, [{ role: 'user', content: parsed.text }], { timeout: 30000 });

    if (r.epc && r.epc.length > 0) {
      // === BYPASS ENTRY: r.epc is provider-kit's EPC output ===
      // === BYPASS EXIT: validate structural integrity ===
      const epcValid = validateEpcBuffer(r.epc);
      if (epcValid) {
        mode = 'passthrough';
        epcBuf = r.epc;
        diag = inspectEpc(epcBuf);
      } else {
        // === BYPASS FALLBACK: raw content in meta, zero EPC processing ===
        mode = 'bypass_epc_invalid';
        bypass = true;
        rawContent = r.content || '';
        epcBuf = Buffer.alloc(0);
        diag = { frames: 0, types: [] };
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
    meta: { mode, bypass, bypassText: bypass ? rawContent : undefined, srcHash: '', ts: Date.now(), frames: diag.frames, types: diag.types },
  });
  epcBuf = Buffer.concat([epcBuf, metaBuf]);

  await qiniuPut(replyKey, epcBuf);
  console.debug(`[C1] nonstream ${replyKey} mode=${mode} bypass=${bypass} bytes=${epcBuf.length} frames=${diag.frames}`);
}

// 语音: on-device ASR 转文字后走 .epc，桥上无语音处理
