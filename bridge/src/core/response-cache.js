import { createHash } from 'crypto';

const MAX_SIZE = 500;
const TTL_MS = 7 * 24 * 3600 * 1000;
const store = new Map();

function makeKey(text, model) {
  return createHash('sha256')
    .update(text.trim().toLowerCase() + '|' + model)
    .digest('hex')
    .slice(0, 16);
}

function isCacheable(text) {
  if (!text || text.length > 50) return false;
  return /^[\u4e00-\u9fff\w\s,.\?!]+$/.test(text);
}

function get(text, model) {
  const key = makeKey(text, model);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    store.delete(key);
    return null;
  }
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

function set(text, model, value) {
  if (!isCacheable(text)) return;
  const key = makeKey(text, model);
  if (store.has(key)) store.delete(key);
  store.set(key, { value, ts: Date.now() });
  if (store.size > MAX_SIZE) {
    const firstKey = store.keys().next().value;
    store.delete(firstKey);
  }
}

export { get, set, isCacheable };
