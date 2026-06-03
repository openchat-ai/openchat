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
import { processText, initProvider } from './skeleton-agent.mjs';

// === invariants ===
// - All cross-device data flows through Qiniu, never direct connection
// - Bridge polls oc/chat/ every POLL_INTERVAL_MS
// - Processes .enc (lmdn voice) and .msg (text, EPC BB 00 DD) files
// - Skips files with "-reply" suffix
// - Reply is JSON text uploaded to oc/chat/$chatId/$ts-reply.json
// - seenKeys persists in memory only (process restart re-scans)
// - LLM session is created once via initProvider(); reused per call

const POLL_INTERVAL_MS = 2000;
const CHAT_PREFIX = 'oc/chat/';
const seenKeys = new Set();

const codec = new SkeletonCodec();
await codec.initialize();
console.log('[skeleton] codec ready @ 24kHz');

try {
  await initProvider();
} catch (e) {
  console.error('[skeleton] initProvider FAILED:', e.message);
  console.error('[skeleton] will fall back to canned replies');
}

// On startup: mark only replied files as seen. Unreplied .msg/.enc are processed.
async function primeSeenKeys() {
  try {
    const keys = await qiniuList(CHAT_PREFIX);
    const replies = keys.filter(k => k.includes('-reply.json'));
    const repliedSources = new Set();
    for (const r of replies) {
      seenKeys.add(r);
      try {
        const data = await qiniuGet(r);
        if (data) repliedSources.add(JSON.parse(data.toString('utf8')).sourceKey);
      } catch {}
    }
    for (const k of keys) {
      if (k.includes('-reply.json')) continue;
      if (repliedSources.has(k)) seenKeys.add(k);
    }
    console.log(`[skeleton] primed seenKeys: ${seenKeys.size} replied, ${keys.length - seenKeys.size} unproc pending`);
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
  if (encData[0] !== 0xBB || encData[2] !== 0xCC) {
    console.error(`[C13] invalid EPC header in ${key}: dir=0x${encData[1]?.toString(16)} type=0x${encData[2]?.toString(16)}`);
    return;
  }

  const decoded = await codec.decode(Buffer.from(encData));
  console.log(`[C13b] decoded pcm=${decoded.pcm.length}B score=${decoded.score.length}`);

  const text = '[用户发来一段语音消息]'; // v0: no STT yet
  console.log(`[C13c] text=${text} (STT not wired, using placeholder)`);

  let response = '';
  let toolCalls = [];
  let errMsg = null;
  try {
    const r = await processText(text);
    response = r.response || '';
    toolCalls = r.toolCalls || [];
  } catch (e) {
    errMsg = e.message;
    console.error(`[C13c] processText error: ${e.message}`);
  }
  const reply = response || (errMsg ? `[agent error] ${errMsg}` : '(agent returned empty)');
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
  } catch (e) {
    errMsg = e.message;
    console.error(`[C13c] processText error: ${e.message}`);
  }
  const reply = response || (errMsg ? `[agent error] ${errMsg}` : '(agent returned empty)');
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
