// Chat poller: polls oc/chat/ for .enc/.msg files, generates AI replies.
// Runs in-process as part of the main Bridge (no child process).
// See apps/bridge/skeleton.mjs for the original standalone version.

import LmdnCodec from '../core/audio/lmdn-codec.mjs';
import { qiniuList, qiniuGet, qiniuPut } from '../../../apps/bridge/skeleton-qiniu.mjs';
import { processText, initProvider, generateSessionName } from '../../../apps/bridge/skeleton-agent.mjs';
import { autoNameIfNeeded, invalidateCache } from './session-namer.mjs';

// === invariants ===
// - Polls oc/chat/ every POLL_INTERVAL_MS
// - Processes .enc (lmdn voice) and .msg (text, EPC BB 00 DD) files
// - Skips files with "-reply" suffix
// - seenKeys persists in memory only (process restart re-scans)
// - _msgCount[chatId] tracks processed messages for auto-name trigger
// - Messages older than MAX_AGE_MS are skipped to avoid reprocessing dead sessions
// - Concurrent processing is limited to MAX_CONCURRENT to avoid blocking the poll loop
// - _inFlight set prevents re-processing the same key before it finishes

const POLL_INTERVAL_MS = 2000;
const MAX_AGE_MS = 15 * 60 * 1000; // skip messages older than 15 minutes
const MAX_CONCURRENT = 3;
const CHAT_PREFIX = 'oc/chat/';
const seenKeys = new Set();
const _inFlight = new Set();
const _msgCount = {}; // chatId → processed message count

let _codec = null;
let _started = false;

/** Parse timestamp from key like oc/chat/chatId/1234567890.msg */
function _tsFromKey(key) {
  const name = key.split('/').pop() || '';
  const num = parseInt(name.split('.')[0], 10);
  return isNaN(num) ? 0 : num;
}

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
    const r = await processText(parsed.text, chatId);
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

  // auto-name session after reply
  _msgCount[chatId] = (_msgCount[chatId] || 0) + 1;
  const nameGen = () => generateSessionName(chatId);
  autoNameIfNeeded(chatId, _msgCount[chatId], nameGen).catch(() => {});
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
    const r = await processText(text, chatId);
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

  // auto-name session after reply
  _msgCount[chatId] = (_msgCount[chatId] || 0) + 1;
  const nameGen = () => generateSessionName(chatId);
  autoNameIfNeeded(chatId, _msgCount[chatId], nameGen).catch(() => {});
}

async function _processOne(key) {
  if (_inFlight.has(key)) return;
  _inFlight.add(key);
  try {
    const raw = await qiniuGet(key);
    if (!raw || raw.length === 0) return;
    if (key.endsWith('.enc')) {
      await _handleEnc(key, raw);
    } else {
      await _handleMsg(key, raw);
    }
  } catch (err) {
    console.error(`[chat-poller] process error for ${key}:`, err.message);
  } finally {
    _inFlight.delete(key);
  }
}

async function _pollLoop() {
  console.log('[chat-poller] starting...');
  while (true) {
    try {
      const keys = await qiniuList(CHAT_PREFIX);
      const now = Date.now();
      const pending = [];
      for (const key of keys) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        if (!key.endsWith('.enc') && !key.endsWith('.msg')) continue;
        if (key.includes('-reply')) continue;
        // Skip messages older than MAX_AGE_MS to avoid reprocessing dead sessions
        const age = now - _tsFromKey(key);
        if (age > MAX_AGE_MS) continue;
        pending.push(key);
      }
      // Fire-and-forget up to MAX_CONCURRENT at a time
      for (let i = 0; i < pending.length; i += MAX_CONCURRENT) {
        const batch = pending.slice(i, i + MAX_CONCURRENT);
        await Promise.allSettled(batch.map(_processOne));
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

  const codec = new LmdnCodec();
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
