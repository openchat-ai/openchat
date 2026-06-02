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
// - Only .enc files without "-reply" suffix are processed
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
  if (encData[0] !== 0xBB || encData[1] !== 0x01 || encData[2] !== 0xCC) {
    console.error(`[C13] invalid EPC header in ${key}`);
    return;
  }

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

async function pollLoop() {
  console.log('[skeleton] starting poll loop...');
  while (true) {
    try {
      const keys = await qiniuList(CHAT_PREFIX);
      for (const key of keys) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        if (!key.endsWith('.enc')) continue;
        if (key.includes('-reply')) continue;

        try {
          await processEnc(key);
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
