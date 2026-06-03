/**
 * Key Resolver - bridge-side mirror of modules/provider-kit/src/core/key-resolver.js
 * 让消费方项目（openchat）注入自己的 apikey 查找逻辑
 *
 * 优先级链：explicit opts.apiKey > resolver() > persistentConfig > env
 */

let _resolver = null;

export function setKeyResolver(fn) {
  _resolver = fn;
}

export function clearKeyResolver() {
  _resolver = null;
}

export function hasKeyResolver() {
  return _resolver !== null;
}

export async function resolveApiKey(providerName, explicitKey) {
  if (explicitKey) return { key: explicitKey, source: 'explicit' };
  if (_resolver) {
    try {
      const k = await _resolver(providerName);
      if (k) return { key: k, source: 'resolver' };
    } catch (_) { /* fall through */ }
  }
  return null;
}

export default { setKeyResolver, clearKeyResolver, hasKeyResolver, resolveApiKey };
