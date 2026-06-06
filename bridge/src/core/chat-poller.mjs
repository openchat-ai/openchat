// Chat poller: polls oc/chat/ for .enc/.msg files, generates AI replies.
// Runs in-process as part of the main Bridge (no child process).

import LmdnCodec from '../core/audio/lmdn-codec.mjs';
import { qiniuList, qiniuGet, qiniuPut } from '../../scripts/qiniu-s3.mjs';
import { processText, initProvider, generateSessionName } from '../../scripts/skeleton-agent.mjs';
import { autoNameIfNeeded } from './session-namer.mjs';
import { run as composeRun } from '../experiments/compose.mjs';

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

// === deps (overridable for testing) ===
// Production code calls _deps.x; tests use _setDeps({ x: mock }) to inject.
const _deps = {
  qiniuList,
  qiniuGet,
  qiniuPut,
  processText,
  generateSessionName,
  autoNameIfNeeded,
  LmdnCodec,
  composeRun,  // 可注入: 测试时 mock 整个 compose 派发
};

export function _setDeps(overrides) {
  Object.assign(_deps, overrides);
}

export function _resetDeps() {
  _deps.qiniuList = qiniuList;
  _deps.qiniuGet = qiniuGet;
  _deps.qiniuPut = qiniuPut;
  _deps.processText = processText;
  _deps.generateSessionName = generateSessionName;
  _deps.autoNameIfNeeded = autoNameIfNeeded;
  _deps.LmdnCodec = LmdnCodec;
  _deps.composeRun = composeRun;
}

export function _getDeps() { return { ..._deps }; }

/** Parse timestamp from key like oc/chat/chatId/1234567890.msg */
export function tsFromKey(key) {
  const name = key.split('/').pop() || '';
  const num = parseInt(name.split('.')[0], 10);
  return isNaN(num) ? 0 : num;
}

/** Strip EPC header (if present) and parse JSON .msg payload. Returns {text,chatId,ts} or null. */
export function parseMsgPayload(key, raw) {
  let payload = raw;
  // EPC header: BB ?? [length 3 bytes] ... payload
  if (raw[0] === 0xBB && raw.length >= 8) {
    const pl = (raw[3] << 16) | (raw[4] << 8) | raw[5];
    payload = raw.slice(6, 6 + pl);
  }
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
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  return { text: msg.text, chatId, ts: 0 };
}

/** Handle a .msg file: parse → call agent → upload reply. */
export async function handleMessage(key, raw) {
  const parsed = parseMsgPayload(key, raw);
  if (!parsed) return;
  console.log(`[chat-poller] text=${parsed.text.substring(0, 80)}`);

  // 业务下沉到 poll-one 复合实验 (qiniu + isolation + agent)
  const r = await _deps.composeRun('poll-one', { msgKey: key, text: parsed.text, chatId: parsed.chatId });
  const reply = { reply: r.outputs.reply, replyKey: r.outputs.replyKey, error: r.outputs.error, sourceKey: key, chatId: parsed.chatId };
  _afterReply(parsed.chatId, reply);
  return reply;
}

/** Handle a .enc file: validate EPC header → decode → call agent → upload reply. */
export async function handleVoice(key, raw) {
  if (!_codec) return null;
  if (raw[0] !== 0xBB || raw[2] !== 0xCC) {
    console.error(`[chat-poller] invalid EPC header in ${key}`);
    return null;
  }
  const decoded = await _codec.decode(Buffer.from(raw));
  if (!decoded || !decoded.pcm || decoded.pcm.length === 0) return null;
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  const text = '[用户发来一段语音消息]';
  console.log(`[chat-poller] voice decoded ${decoded.pcm.length}B -> text placeholder`);

  const reply = await _agentAndUpload(text, chatId, key);
  _afterReply(chatId, reply);
  return reply;
}

/** Process one key: download → dispatch to handleMessage or handleVoice. Dedup via _inFlight. */
export async function processOne(key) {
  if (_inFlight.has(key)) return { skipped: 'in-flight' };
  _inFlight.add(key);
  try {
    const raw = await _deps.qiniuGet(key);
    if (!raw || raw.length === 0) return { skipped: 'empty' };
    if (key.endsWith('.enc')) {
      return await handleVoice(key, raw);
    }
    return await handleMessage(key, raw);
  } catch (err) {
    console.error(`[chat-poller] process error for ${key}:`, err.message);
    return { error: err.message };
  } finally {
    _inFlight.delete(key);
  }
}

// === internal helpers ===

// voice 路径的 agent + upload (不经过 poll-one，因为 .enc 的 replyKey 派生不同)
async function _agentAndUpload(text, chatId, key) {
  let reply = '';
  let agentError = null;
  try {
    const r = await _deps.processText(text, chatId);
    reply = r?.response || '';
  } catch (e) {
    agentError = e.message;
  }
  const replyKey = key.replace(/\.enc$/, '-reply.json');
  const replyText = reply || (agentError ? `[agent error] ${agentError}` : '(empty)');
  const payload = { text: replyText, sourceKey: key, ts: Date.now(), ...(agentError && { error: agentError }) };
  await _deps.qiniuPut(replyKey, Buffer.from(JSON.stringify(payload), 'utf8'));
  return { reply: replyText, replyKey, error: agentError, sourceKey: key, chatId };
}

function _afterReply(chatId, reply) {
  if (!reply) return;
  _msgCount[chatId] = (_msgCount[chatId] || 0) + 1;
  const nameGen = () => _deps.generateSessionName(chatId);
  _deps.autoNameIfNeeded(chatId, _msgCount[chatId], nameGen).catch(() => {});
}

// === poll loop (long-running) ===

async function _pollLoop() {
  console.log('[chat-poller] starting...');
  while (true) {
    try {
      const keys = await _deps.qiniuList(CHAT_PREFIX);
      const now = Date.now();
      const pending = [];
      for (const key of keys) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        if (!key.endsWith('.enc') && !key.endsWith('.msg')) continue;
        if (key.includes('-reply')) continue;
        const age = now - tsFromKey(key);
        if (age > MAX_AGE_MS) continue;
        pending.push(key);
      }
      for (let i = 0; i < pending.length; i += MAX_CONCURRENT) {
        const batch = pending.slice(i, i + MAX_CONCURRENT);
        await Promise.allSettled(batch.map(processOne));
      }
    } catch (err) {
      console.error('[chat-poller] poll error:', err.message);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function _primeSeenKeys() {
  try {
    const keys = await _deps.qiniuList(CHAT_PREFIX);
    const replies = keys.filter(k => k.includes('-reply.json'));
    const repliedSources = new Set();
    for (const r of replies) {
      seenKeys.add(r);
      try {
        const data = await _deps.qiniuGet(r);
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

  const codec = new _deps.LmdnCodec();
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
