const _inFlight = new Set();
const MAX_IN_FLIGHT = 50;
const _deps = {};

export function _setDeps(overrides) {
  Object.assign(_deps, overrides);
}

export function _resetDeps() {
  Object.keys(_deps).forEach(k => delete _deps[k]);
}

export function _getDeps() { return { ..._deps }; }

export function parseMsgPayload(key, raw) {
  let payload = raw;
  if (raw[0] === 0xBB && raw.length >= 8) {
    const pl = (raw[3] << 16) | (raw[4] << 8) | raw[5];
    payload = raw.slice(6, 6 + pl);
  }
  let msg;
  try {
    msg = JSON.parse(payload.toString('utf8'));
  } catch {
    return null;
  }
  if (msg.type !== 'text' || !msg.text) return null;
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  return { text: msg.text, chatId, ts: 0 };
}

export async function processOne(key) {
  if (_inFlight.size >= MAX_IN_FLIGHT) return { skipped: 'backpressure' };
  if (_inFlight.has(key)) return { skipped: 'in-flight' };
  _inFlight.add(key);
  try {
    const raw = await _deps.qiniuGet(key);
    if (!raw || raw.length === 0) return { skipped: 'empty' };
    const parsed = parseMsgPayload(key, raw);
    if (!parsed) return { skipped: 'unparseable' };
    const r = await _deps.composeRun('poll-one', { msgKey: key, text: parsed.text, chatId: parsed.chatId });
    const reply = { reply: r.outputs.reply, replyKey: r.outputs.replyKey, error: r.outputs.error, sourceKey: key, chatId: parsed.chatId };
    return reply;
  } catch (err) {
    return { error: err.message };
  } finally {
    _inFlight.delete(key);
  }
}
