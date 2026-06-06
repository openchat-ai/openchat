import { qiniuGet, qiniuPut } from '../../scripts/qiniu-s3.mjs';

// === invariants ===
// - _metaCache[chatId] = { name, userSet, autoNamed, createdAt, updatedAt } | null
// - Never auto-name if userSet === true
// - Auto-name triggers: messageCount ∈ [3, 8, 16, 32, 64] (exponential backoff)
// - Name generation uses the same provider as chat (processText via external callback)
// - _meta.json written to Qiniu only when name actually changes
// - Cache miss → read from Qiniu; negative cache (null) avoids repeated misses

const META_KEY = '_meta.json';
const TRIGGER_POINTS = new Set([3, 8, 16, 32, 64]);
const _metaCache = new Map();

function metaPath(chatId) {
  return `oc/chat/${chatId}/${META_KEY}`;
}

async function readMeta(chatId) {
  if (_metaCache.has(chatId)) return _metaCache.get(chatId);
  try {
    const raw = await qiniuGet(metaPath(chatId));
    const meta = JSON.parse(raw.toString('utf8'));
    _metaCache.set(chatId, meta);
    return meta;
  } catch {
    _metaCache.set(chatId, null);
    return null;
  }
}

export async function writeMeta(chatId, meta) {
  const path = metaPath(chatId);
  const data = Buffer.from(JSON.stringify(meta), 'utf8');
  await qiniuPut(path, data);
  _metaCache.set(chatId, meta);
}

async function getOrInitMeta(chatId) {
  const meta = await readMeta(chatId);
  if (meta) return meta;
  const now = Date.now();
  const init = { name: null, userSet: false, autoNamed: false, createdAt: now, updatedAt: now };
  await writeMeta(chatId, init);
  return init;
}

export function invalidateCache(chatId) {
  _metaCache.delete(chatId);
}

// Check if auto-name should trigger based on message count
function _shouldTrigger(meta, messageCount) {
  if (!meta) return false;
  if (meta.userSet) return false;
  if (meta.autoNamed && !TRIGGER_POINTS.has(messageCount)) return false;
  return TRIGGER_POINTS.has(messageCount);
}

// Generate a name using LLM provider
// generatorFn: async (historyArray) => string — wraps processText or direct provider call
export async function autoNameIfNeeded(chatId, messageCount, generatorFn) {
  const meta = await getOrInitMeta(chatId);
  if (!_shouldTrigger(meta, messageCount)) return meta;

  try {
    const name = await generatorFn();
    if (!name || name.length < 1) return meta;
    const clean = name.replace(/["']/g, '').trim().substring(0, 20);
    meta.name = clean;
    meta.autoNamed = true;
    meta.updatedAt = Date.now();
    await writeMeta(chatId, meta);
    console.log(`[session-namer] auto-named chatId=${chatId} -> "${clean}" (msg#${messageCount})`);
  } catch (e) {
    console.warn(`[session-namer] name gen failed for ${chatId}: ${e.message}`);
  }
  return meta;
}

export { readMeta, getOrInitMeta };
