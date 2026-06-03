// Chat poller: polls oc/chat/ for .enc/.msg files, generates AI replies.
// Runs in-process as part of the main Bridge (no child process).
// See apps/bridge/skeleton.mjs for the original standalone version.

import { SkeletonCodec } from '../../../apps/bridge/skeleton-codec.mjs';
import { qiniuList, qiniuGet, qiniuPut } from '../../../apps/bridge/skeleton-qiniu.mjs';
import { processText, initProvider } from '../../../apps/bridge/skeleton-agent.mjs';

// === invariants ===
// - Polls oc/chat/ every POLL_INTERVAL_MS
// - Processes .enc (lmdn voice) and .msg (text, EPC BB 00 DD) files
// - Skips files with "-reply" suffix
// - Reply is JSON text uploaded to oc/chat/$chatId/$ts-reply.json
// - seenKeys persists in memory only (process restart re-scans)

const POLL_INTERVAL_MS = 2000;
const CHAT_PREFIX = 'oc/chat/';
const seenKeys = new Set();

let _codec = null;
let _started = false;

function _processMsg(key, payload, chatId, ts) {
  let msg;
  try {
    msg = JSON.parse(payload.toString('utf8'));
  } catch (e) {
    console.error(`[chat-poller] invalid msg JSON in ${key}: ${e.message}`);
    return null;
  }
  if (msg.type !== 'text' || !msg.text) {
    console.warn(`[chat-poller] unexpected msg format in ${key}`);
    return null;
  }
  return { text: msg.text, chatId, ts };
}

async function _handleMsg(key, raw) {
  let payload = raw;
  if (raw[0] === 0xBB && raw.length >= 8) {
    const pl = (raw[3] << 16) | (raw[4] << 8) | raw[5];
    payload = raw.slice(6, 6 + pl);
  }
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  const parsed = _processMsg(key, payload, chatId, 0);
  if (!parsed) return;
  console.log(`[chat-poller] text=${parsed.text.substring(0, 80)}`);

  let response = '', toolCalls = [], errMsg = null;
  try {
    const r = await processText(parsed.text);
    response = r.response || '';
    toolCalls = r.toolCalls || [];
  } catch (e) {
    errMsg = e.message;
    console.error(`[chat-poller] processText error: ${e.message}`);
  }
  const reply = response || (errMsg ? `[agent error] ${errMsg}` : '(agent returned empty)');
  const replyKey = `oc/chat/${chatId}/${Date.now()}-reply.json`;
  await qiniuPut(replyKey, Buffer.from(JSON.stringify({
    text: reply, toolCalls, sourceKey: key, ts: Date.now(), ...(errMsg && { error: errMsg }),
  }), 'utf8'));
  console.log(`[chat-poller] reply="${reply.substring(0, 60)}" -> ${replyKey}`);
}

async function _handleEnc(key, raw) {
  if (!_codec) return;
  console.log(`[chat-poller] downloaded voice ${key}`);
  if (raw[0] !== 0xBB || raw[2] !== 0xCC) {
    console.error(`[chat-poller] invalid EPC header in ${key}`);
    return;
  }
  const decoded = await _codec.decode(Buffer.from(raw));
  if (!decoded || !decoded.pcm || decoded.pcm.length === 0) return;
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  const text = '[用户发来一段语音消息]';
  console.log(`[chat-poller] voice decoded ${decoded.pcm.length}B -> text placeholder`);

  let response = '', toolCalls = [], errMsg = null;
  try {
    const r = await processText(text);
    response = r.response || '';
    toolCalls = r.toolCalls || [];
  } catch (e) {
    errMsg = e.message;
    console.error(`[chat-poller] processText error: ${e.message}`);
  }
  const reply = response || (errMsg ? `[agent error] ${errMsg}` : '(agent returned empty)');
  const replyKey = `oc/chat/${chatId}/${Date.now()}-reply.json`;
  await qiniuPut(replyKey, Buffer.from(JSON.stringify({
    text: reply, toolCalls, sourceKey: key, ts: Date.now(), ...(errMsg && { error: errMsg }),
  }), 'utf8'));
  console.log(`[chat-poller] voice reply="${reply.substring(0, 60)}" -> ${replyKey}`);
}

async function _pollLoop() {
  console.log('[chat-poller] starting...');
  while (true) {
    try {
      const keys = await qiniuList(CHAT_PREFIX);
      for (const key of keys) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        if (!key.endsWith('.enc') && !key.endsWith('.msg')) continue;
        if (key.includes('-reply')) continue;
        try {
          const raw = await qiniuGet(key);
          if (!raw || raw.length === 0) continue;
          if (key.endsWith('.enc')) {
            await _handleEnc(key, raw);
            continue;
          }
          await _handleMsg(key, raw);
        } catch (err) {
          console.error(`[chat-poller] process error for ${key}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[chat-poller] poll error:', err.message);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function _primeSeenKeys() {
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
    console.log(`[chat-poller] primed: ${seenKeys.size} seen, ${keys.length - seenKeys.size} pending`);
  } catch (e) {
    console.warn('[chat-poller] prime failed:', e.message);
  }
}

export async function startChatPoll() {
  if (_started) return;
  _started = true;

  const codec = new SkeletonCodec();
  await codec.initialize();
  _codec = codec;
  console.log('[chat-poller] codec ready');

  try {
    await initProvider();
  } catch (e) {
    console.error('[chat-poller] initProvider FAILED:', e.message);
    console.error('[chat-poller] will fall back to canned replies');
  }

  await _primeSeenKeys();
  _pollLoop().catch(console.error);
}
