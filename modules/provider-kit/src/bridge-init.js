/**
 * bridge-init.js — bridge config → connected provider
 *
 * 单一权威入口:读 ~/.config/openchat/config.json (NEW),回退 ~/.openchat/config.json (OLD)
 * 解析 current + providers,按 fallback 链 createProvider + connect
 * 所有 LLM 连接 (chat/tool-call/orchestrator) 一律走这里,bridge 不再持有 provider 创建逻辑
 *
 * Rule: any LLM call MUST go through provider-kit (kit 接管 config + connect)
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createProvider } from './providers/openai-compatible.js';

const NEW_CONFIG = process.env.OPENCHAT_CONFIG
  || join(homedir(), '.config', 'openchat', 'config.json');
const OLD_CONFIG = join(homedir(), '.openchat', 'config.json');

export function getConfigPaths() {
  return { NEW_CONFIG, OLD_CONFIG };
}

// === invariants ===
//   - loadBridgeConfig 不写盘,纯读
//   - pickFallback 返回的顺序 = current provider 在前,其他按 providers 字典序
//   - getActiveProvider 失败时 throw,绝不返 null (caller 显式处理)
//   - fallbacks 至少 1 项 (抛错时已校验)
// === end invariants ===

export function loadBridgeConfig() {
  for (const file of [NEW_CONFIG, OLD_CONFIG]) {
    try {
      if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`[bridge-init] read ${file}: ${e.message}`);
    }
  }
  return null;
}

export function pickFallback(config) {
  if (!config) throw new Error('bridge-init: no config');
  const cur = config.current || {};
  const list = [];
  if (cur.provider && cur.model) list.push({ name: cur.provider, model: cur.model });
  for (const [name, p] of Object.entries(config.providers || {})) {
    if (!p?.apiKey || name === cur.provider) continue;
    list.push({ name, model: p.defaultModel || p.model });
  }
  if (!list.length) throw new Error('bridge-init: no provider with apiKey');
  return list;
}

export async function getActiveProvider({ silent = false } = {}) {
  const config = loadBridgeConfig();
  const fallbacks = pickFallback(config);
  let lastErr;
  for (const fb of fallbacks) {
    const pcfg = config.providers?.[fb.name] || {};
    try {
      const provider = createProvider(fb.name, pcfg.apiKey, { baseUrl: pcfg.baseUrl });
      await provider.connect(pcfg.apiKey);
      if (!silent) console.debug(`[bridge-init] ${fb.name}/${fb.model} connected`);
      return { provider, model: fb.model, fallbacks, config };
    } catch (e) {
      lastErr = e;
      if (!silent) console.error(`[bridge-init] ${fb.name} failed: ${e.message?.slice(0, 60)}`);
    }
  }
  throw new Error(`bridge-init: all providers failed (last: ${lastErr?.message})`);
}

// 连接指定 name 的 provider (供运行时 fallback 切换用,不查 fallbacks 表)
export async function connectByName(name, config, { silent = false } = {}) {
  const pcfg = config?.providers?.[name] || {};
  const provider = createProvider(name, pcfg.apiKey, { baseUrl: pcfg.baseUrl });
  await provider.connect(pcfg.apiKey).catch((e) => {
    if (!silent) console.error(`[bridge-init] connect ${name} failed: ${e.message?.slice(0, 60)}`);
  });
  return provider;
}
