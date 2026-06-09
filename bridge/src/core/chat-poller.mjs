// Chat poller: polls oc/chat/ for .enc/.msg files, generates AI replies.
// Runs in-process as part of the main Bridge (no child process).

import LmdnCodec from '../core/audio/lmdn-codec.mjs';
import { qiniuList, qiniuGet, qiniuPut } from '../../scripts/qiniu-s3.mjs';
import { processText, initProvider, generateSessionName } from '../../scripts/tool-loop.mjs';
import { readFile } from 'fs/promises';
import { autoNameIfNeeded } from './session-namer.mjs';
import { run as composeRun } from '../experiments/compose.mjs';
import { generate as genId, createSpan, endSpan, formatLog } from '../tools/request-id.mjs';

let _quiet = false;
export function setQuiet(v) { _quiet = v; }

function _log(...args) { if (!_quiet) console.log(...args); }
function _warn(...args) { if (!_quiet) console.warn(...args); }

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
const MAX_IN_FLIGHT = 20; // backpressure: reject if more than this many in-flight
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
    _warn(`[chat-poller] unexpected msg format in ${key}`);
    return null;
  }
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  return { text: msg.text, chatId, ts: 0 };
}

/** Handle a .msg file: parse → call agent → upload reply. */
export async function handleMessage(key, raw, reqId) {
  reqId = reqId || genId();
  const parsed = parseMsgPayload(key, raw);
  if (!parsed) return;
  _log(formatLog(reqId, `text=${parsed.text.substring(0, 80)}`));

  const span = createSpan(reqId, 'composeRun');
  try {
    const r = await _deps.composeRun('poll-one', { msgKey: key, text: parsed.text, chatId: parsed.chatId });
    const reply = { reply: r.outputs.reply, replyKey: r.outputs.replyKey, error: r.outputs.error, sourceKey: key, chatId: parsed.chatId };
    _afterReply(parsed.chatId, reply);
    _log(formatLog(reqId, `reply=${(r.outputs.reply || '').slice(0, 40)}`));
    return reply;
  } finally { endSpan(span); }
}

/** Handle a .enc file: validate EPC header → decode → call agent → upload reply. */
export async function handleVoice(key, raw, reqId) {
  reqId = reqId || genId();
  if (!_codec) return null;
  if (raw[0] !== 0xBB || raw[2] !== 0xCC) {
    console.error(formatLog(reqId, `invalid EPC header in ${key}`));
    return null;
  }
  const decoded = await _codec.decode(Buffer.from(raw));
  if (!decoded || !decoded.pcm || decoded.pcm.length === 0) return null;
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  const text = '[用户发来一段语音消息]';
  _log(formatLog(reqId, `voice decoded ${decoded.pcm.length}B -> text placeholder`));

  const reply = await _agentAndUpload(text, chatId, key, reqId);
  _afterReply(chatId, reply);
  return reply;
}

/** Process one key: download → dispatch to handleMessage or handleVoice. Dedup via _inFlight. */
export async function processOne(key) {
  const reqId = genId();
  if (_inFlight.size >= MAX_IN_FLIGHT) return { skipped: 'backpressure' };
  if (_inFlight.has(key)) return { skipped: 'in-flight' };
  _inFlight.add(key);
  _log(formatLog(reqId, `start ${key}`));
  const span = createSpan(reqId, 'processOne');
  try {
    const raw = await _deps.qiniuGet(key);
    if (!raw || raw.length === 0) return { skipped: 'empty' };
    const r = key.endsWith('.enc') ? await handleVoice(key, raw, reqId) : await handleMessage(key, raw, reqId);
    _log(formatLog(reqId, `done ${key}`));
    return r;
  } catch (err) {
    console.error(formatLog(reqId, `error ${key}: ${err.message}`));
    return { error: err.message };
  } finally {
    _inFlight.delete(key);
    endSpan(span);
  }
}

// === internal helpers ===

// voice 路径的 agent + upload (不经过 poll-one，因为 .enc 的 replyKey 派生不同)
async function _agentAndUpload(text, chatId, key, reqId) {
  reqId = reqId || genId();
  let reply = '';
  let agentError = null;
  const span = createSpan(reqId, 'agentAndUpload');
  try {
    const r = await _deps.processText(text, chatId);
    reply = r?.response || '';
    _log(formatLog(reqId, `agent reply: ${reply.slice(0, 40)}`));
  } catch (e) {
    agentError = e.message;
    console.error(formatLog(reqId, `agent error: ${e.message}`));
  } finally { endSpan(span); }
  const replyKey = key.replace(/\.enc$/, '-reply.json');
  const replyText = reply || (agentError ? `[agent error] ${agentError}` : '(empty)');
  const payload = { text: replyText, sourceKey: key, ts: Date.now(), ...(agentError && { error: agentError }) };
  await _deps.qiniuPut(replyKey, Buffer.from(JSON.stringify(payload), 'utf8'));
  _log(formatLog(reqId, `uploaded ${replyKey}`));
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
  if (!_quiet) _log('[chat-poller] starting...');
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
    _log(`[chat-poller] primed: ${seenKeys.size} seen, ${keys.length - seenKeys.size} pending`);
  } catch (e) {
    _warn('[chat-poller] prime failed:', e.message);
  }
}

// 自动上传 SDUI 配置到 Qiniu（非关键，失败不阻塞）
async function _uploadSduiConfig() {
  try {
    const content = await readFile(new URL('../../../docs/config/audio.json', import.meta.url), 'utf8');
    await _deps.qiniuPut('oc/config/audio.json', Buffer.from(content, 'utf8'));
    _log('[chat-poller] SDUI config uploaded');
  } catch (e) {
    // 不阻塞启动
  }
}

export async function startChatPoll() {
  if (_started) return;
  _started = true;

  const codec = new _deps.LmdnCodec();
  await codec.initialize();
  _codec = codec;
  _log('[chat-poller] codec ready');

  try {
    await initProvider();
  } catch (e) {
    console.error('[chat-poller] initProvider FAILED:', e.message);
    console.error('[chat-poller] will fall back to canned replies');
  }

  // 启动时自动上传 SDUI 配置到 Qiniu（非关键，失败不阻塞）
  _uploadSduiConfig().catch(() => {});

  await _primeSeenKeys();
  _pollLoop().catch(console.error);
}
