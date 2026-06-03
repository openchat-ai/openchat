// Bridge side skeleton: polls oc/chat/ for *.enc, processes via lmdn+agent,
// writes back *-reply.json. NO WebSocket, NO IP needed.
//
// Architecture: Qiniu-as-Signaling. Bridge can run anywhere (PC, server, NAS).
// Phone and Bridge communicate purely via Qiniu object storage.
//
// Usage: node apps/bridge/skeleton.mjs
//
// See docs/WALKING-SKELETON-SPEC.md for full data flow.

import { SkeletonCodec } from './skeleton-codec.mjs';
import { qiniuList, qiniuGet, qiniuPut } from './skeleton-qiniu.mjs';
import { processText } from './skeleton-agent.mjs';

// === invariants ===
// - All cross-device data flows through Qiniu, never direct connection
// - Bridge polls oc/chat/ every POLL_INTERVAL_MS
// - Processes .enc (lmdn voice) and .msg (text, EPC BB 00 DD) files
// - Skips files with "-reply" suffix
// - Reply is JSON text uploaded to oc/chat/$chatId/$ts-reply.json
// - seenKeys persists in memory only (process restart re-scans)

const POLL_INTERVAL_MS = 2000;
const CHAT_PREFIX = 'oc/chat/';
const seenKeys = new Set();

const codec = new SkeletonCodec();
await codec.initialize();
console.log('[skeleton] codec ready @ 24kHz');

// On startup, mark existing files as seen to avoid replaying history
async function primeSeenKeys() {
  try {
    const keys = await qiniuList(CHAT_PREFIX);
    for (const k of keys) seenKeys.add(k);
    console.log(`[skeleton] primed seenKeys with ${keys.length} existing entries`);
  } catch (e) {
    console.warn('[skeleton] prime failed:', e.message);
  }
}

async function processEnc(key) {
  console.log(`[C13] downloaded ${key}`);

  const encData = await qiniuGet(key);
  if (!encData || encData.length === 0) {
    console.warn(`[C13] empty enc, skip ${key}`);
    return;
  }

  let text = '';
  if (key.endsWith('.msg')) {
    // Text message: EPC header BB 00 DD, payload is JSON
    if (encData[0] !== 0xBB || encData[2] !== 0xDD) {
      console.error(`[C13] invalid text EPC header in ${key}`);
      return;
    }
    const pl = (encData[3] << 16) | (encData[4] << 8) | encData[5];
    const payload = Buffer.from(encData.slice(6, 6 + pl));
    try {
      const obj = JSON.parse(payload.toString('utf8'));
      text = obj.text || '';
    } catch (e) {
      console.error(`[C13] text payload parse fail: ${e.message}`);
      return;
    }
    console.log(`[C13c] text="${text.substring(0, 80)}"`);
  } else {
    // Voice message: EPC header BB 01 CC, payload is lmdn
    if (encData[0] !== 0xBB || encData[1] !== 0x01 || encData[2] !== 0xCC) {
      console.error(`[C13] invalid EPC header in ${key}`);
      return;
    }
    const decoded = await codec.decode(Buffer.from(encData));
    console.log(`[C13b] decoded pcm=${decoded.pcm.length}B score=${decoded.score.length}`);
    text = '你好'; // v0: hard-code STT
    console.log(`[C13c] text=${text} (STT hard-coded)`);
  }

  let response = '';
  let toolCalls = [];
  let errMsg = null;
  try {
    const r = await processText(text);
    response = r.response || '';
    toolCalls = r.toolCalls || [];
    console.log(`[C13d] toolCalls=${toolCalls.length}`);
  } catch (e) {
    errMsg = e.message;
    console.error(`[C13d] agent error: ${errMsg}`);
  }

  const reply = response || '(agent returned empty)';
  console.log(`[C13e] reply="${reply.substring(0, 80)}"`);

  // Derive chatId from key: oc/chat/<chatId>/<ts>.enc
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  const ts = Date.now();
  const replyKey = `oc/chat/${chatId}/${ts}-reply.json`;

  const payload = {
    text: reply,
    toolCalls,
    sourceKey: key,
    ts,
    ...(errMsg && { error: errMsg }),
  };
  await qiniuPut(replyKey, Buffer.from(JSON.stringify(payload), 'utf8'));
  console.log(`[C13f] uploaded ${replyKey}`);
}
  if (encData[0] !== 0xBB) {
    console.error(`[C13] invalid EPC header in ${key}: got 0x${encData[0].toString(16)}, expected 0xBB`);
    return;
  }
  const epcVersion = encData[1];
  const epcType = encData[2];
  console.log(`[C13] EPC v=${epcVersion} type=${epcType} size=${encData.length}B`);

  const decoded = await codec.decode(Buffer.from(encData));
  console.log(`[C13b] decoded pcm=${decoded.pcm.length}B score=${decoded.score.length}`);

  const text = '你好'; // v0: hard-code STT
  console.log(`[C13c] text=${text}`);

  let response = '';
  let toolCalls = [];
  let errMsg = null;
  try {
    const r = await processText(text);
    response = r.response || '';
    toolCalls = r.toolCalls || [];
    console.log(`[C13d] toolCalls=${toolCalls.length}`);
  } catch (e) {
    errMsg = e.message;
    console.error(`[C13d] agent error: ${errMsg}`);
  }

  const reply = response || '(agent returned empty)';
  console.log(`[C13e] reply="${reply.substring(0, 80)}"`);

  // Derive chatId from key: oc/chat/<chatId>/<ts>.enc
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  const ts = Date.now();
  const replyKey = `oc/chat/${chatId}/${ts}-reply.json`;

  const payload = {
    text: reply,
    toolCalls,
    sourceKey: key,
    ts,
    ...(errMsg && { error: errMsg }),
  };
  await qiniuPut(replyKey, Buffer.from(JSON.stringify(payload), 'utf8'));
  console.log(`[C13f] uploaded ${replyKey}`);
}

async function processMsg(key) {
  console.log(`[C13] downloaded text ${key}`);
  const raw = await qiniuGet(key);
  if (!raw || raw.length === 0) {
    console.warn(`[C13] empty msg, skip ${key}`);
    return;
  }
  // Strip EPC header: 0xBB + dir(1) + type(1) + len(3) + payload + cs(1) + 0x7E
  let payload = raw;
  if (raw[0] === 0xBB && raw.length >= 8) {
    const pl = (raw[3] << 16) | (raw[4] << 8) | raw[5];
    payload = raw.slice(6, 6 + pl);
  }
  let msg;
  try {
    msg = JSON.parse(payload.toString('utf8'));
  } catch (e) {
    console.error(`[C13] invalid msg JSON in ${key}: ${e.message}`);
    return;
  }
  if (msg.type !== 'text' || !msg.text) {
    console.warn(`[C13] unexpected msg format in ${key}`);
    return;
  }

  const text = msg.text;
  console.log(`[C13c] text=${text.substring(0, 80)}`);

  let response = '';
  let toolCalls = [];
  let errMsg = null;
  try {
    const r = await processText(text);
    response = r.response || '';
    toolCalls = r.toolCalls || [];
    console.log(`[C13d] toolCalls=${toolCalls.length}`);
  } catch (e) {
    errMsg = e.message;
    console.error(`[C13d] agent error: ${errMsg}`);
  }

  const reply = response || '(agent returned empty)';
  console.log(`[C13e] reply="${reply.substring(0, 80)}"`);

  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  const ts = Date.now();
  const replyKey = `oc/chat/${chatId}/${ts}-reply.json`;

  const replyPayload = {
    text: reply,
    toolCalls,
    sourceKey: key,
    ts,
    ...(errMsg && { error: errMsg }),
  };
  await qiniuPut(replyKey, Buffer.from(JSON.stringify(replyPayload), 'utf8'));
  console.log(`[C13f] uploaded ${replyKey}`);
}

async function pollLoop() {
  console.log('[skeleton] starting poll loop...');
  while (true) {
    try {
      const keys = await qiniuList(CHAT_PREFIX);
      for (const key of keys) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        // Accept .enc (voice, lmdn) and .msg (text, EPC BB 00 DD)
        if (!key.endsWith('.enc') && !key.endsWith('.msg')) continue;
        if (key.includes('-reply')) continue;
        if (!key.endsWith('.enc') && !key.endsWith('.msg')) continue;

        try {
          if (key.endsWith('.enc')) {
            await processEnc(key);
          } else {
            await processMsg(key);
          }
        } catch (err) {
          console.error(`[skeleton] process error for ${key}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[skeleton] poll error:', err.message);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

await primeSeenKeys();
pollLoop().catch(console.error);
