// Experiment 51: Feature Flag — 分层回退 env→local→remote→disk→hardcoded
//
// 基于 CCB growthbook.ts 模式精简实现。
// 五层回退：env 覆盖 → 本地门控 → 远程评估 → 磁盘缓存 → 硬编码默认值
// 同步读取 + 异步刷新，无外部依赖。
//
// I/O (compose 契约):
//   { op, flag?, value?, overrides? }
//   → { outputs: { value?, source?, all?, history? } }

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { create } from './lib/report.mjs';

export const META = { id: 'feature-flag' };

const NAME = 'Feature Flag — 分层回退 env→local→remote→disk→hardcoded';

// ── 硬编码默认值 ──
const HARDCODED = {
  voice_mode: false,
  debug_tools: true,
  multi_agent: false,
  chat_auto_naming: true,
  audio_fallback_chain: false,
  skill_loader: true,
  teach_me: true,
  dream_consolidation: false,
};

// ── 磁盘缓存路径 ──
const CACHE_DIR = resolve(homedir(), '.openchat');
const CACHE_FILE = resolve(CACHE_DIR, 'feature-flags.json');

// ── 状态 ──
let _localOverrides = {};
let _remoteCache = null;
let _diskCache = null;
let _initialized = false;
let _initPromise = null;
let _pendingExposures = new Set();
let _loggedExposures = new Set();
let _listeners = [];
let _refreshTimer = null;

// ── 内部解析 ──

function _getEnvOverride(flag) {
  const key = `FEATURE_${flag.toUpperCase()}`;
  const raw = process.env[key];
  if (raw === undefined) return undefined;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return raw;
}

function _resolveSync(flag) {
  // ① env 覆盖
  const envVal = _getEnvOverride(flag);
  if (envVal !== undefined) return { value: envVal, source: 'env' };

  // ② 本地门控 (runtime in-memory)
  if (Object.prototype.hasOwnProperty.call(_localOverrides, flag)) {
    return { value: _localOverrides[flag], source: 'local' };
  }

  // ③ 远程评估缓存 (in-memory)
  if (_remoteCache && Object.prototype.hasOwnProperty.call(_remoteCache, flag)) {
    return { value: _remoteCache[flag], source: 'remote' };
  }

  // ④ 磁盘缓存
  if (_diskCache && Object.prototype.hasOwnProperty.call(_diskCache, flag)) {
    return { value: _diskCache[flag], source: 'disk' };
  }

  // ⑤ 硬编码默认值
  if (Object.prototype.hasOwnProperty.call(HARDCODED, flag)) {
    return { value: HARDCODED[flag], source: 'hardcoded' };
  }

  return { value: false, source: 'hardcoded' };
}

// ── 磁盘 I/O ──

async function _loadDiskCache() {
  try {
    if (existsSync(CACHE_FILE)) {
      const raw = await readFile(CACHE_FILE, 'utf8');
      _diskCache = JSON.parse(raw);
      return;
    }
  } catch {}
  _diskCache = null;
}

async function _saveDiskCache() {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(_remoteCache || {}, null, 2), 'utf8');
  } catch {}
}

// ── 远程评估（模拟） ──

async function _fetchRemote() {
  // placeholder: 实际场景对接 GrowthBook / LaunchDarkly API
  // 这里返回一个延迟 100ms 的模拟值
  await new Promise(r => setTimeout(r, 100));
  return {
    voice_mode: true,
    chat_auto_naming: true,
    skill_loader: false,
  };
}

function _notifyListeners() {
  for (const fn of _listeners) {
    try { fn(); } catch {}
  }
}

// ── 初始化 ──

async function _ensureInit() {
  if (_initialized) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    await _loadDiskCache();
    try {
      const remote = await _fetchRemote();
      _remoteCache = remote;
      await _saveDiskCache();
    } catch {
      // 远程失败：使用磁盘缓存（或硬编码）
    }
    _initialized = true;
    _initPromise = null;
    _notifyListeners();
  })();
  return _initPromise;
}

// ── Public API ──

export async function run({ inputs = {} } = {}) {
  const { op, flag, value, overrides } = inputs;

  switch (op) {
    case 'get': {
      if (!flag) throw new Error('flag required for get');
      const result = _resolveSync(flag);
      return { outputs: result };
    }

    case 'get_cached': {
      if (!flag) throw new Error('flag required');
      await _ensureInit();
      const result = _resolveSync(flag);
      return { outputs: result };
    }

    case 'list': {
      await _ensureInit();
      const all = {};
      for (const key of Object.keys(HARDCODED)) {
        all[key] = _resolveSync(key);
      }
      // 动态 flag（不在硬编码中的）
      const dynamic = new Set();
      if (_remoteCache) for (const k of Object.keys(_remoteCache)) dynamic.add(k);
      if (_diskCache) for (const k of Object.keys(_diskCache)) dynamic.add(k);
      for (const key of dynamic) {
        if (!(key in HARDCODED)) all[key] = _resolveSync(key);
      }
      return { outputs: { all } };
    }

    case 'set': {
      if (!flag) throw new Error('flag required');
      _localOverrides[flag] = value;
      return { outputs: { value, source: 'local' } };
    }

    case 'clear': {
      if (flag) {
        delete _localOverrides[flag];
      } else {
        _localOverrides = {};
      }
      return { outputs: { ok: true } };
    }

    case 'refresh': {
      try {
        const remote = await _fetchRemote();
        _remoteCache = remote;
        await _saveDiskCache();
        _notifyListeners();
        return { outputs: { ok: true, source: 'remote' } };
      } catch (e) {
        return { outputs: { ok: false, source: 'remote', error: e.message } };
      }
    }

    case 'status': {
      return {
        outputs: {
          initialized: _initialized,
          localOverrides: Object.keys(_localOverrides).length,
          remoteCached: _remoteCache ? Object.keys(_remoteCache).length : 0,
          diskCached: _diskCache ? Object.keys(_diskCache).length : 0,
          listenerCount: _listeners.length,
        },
      };
    }

    case 'on_change': {
      if (typeof value === 'function') _listeners.push(value);
      return { outputs: { ok: true } };
    }

    default:
      throw new Error(`unknown op: ${op}`);
  }
}

// ── 安全性门控（skip remote eval） ──

export function checkGate_CACHED_MAY_BE_STALE(gate) {
  const { value } = _resolveSync(gate);
  return Boolean(value);
}

// ── 测试 ──

export async function test() {
  const { ok, ng, report } = create();
  let pass = true;

  // ① env 覆盖
  process.env.FEATURE_VOICE_MODE = 'false';
  const r1 = _resolveSync('voice_mode');
  if (r1.value === false && r1.source === 'env') ok('env override works');
  else { ng(`env override: got ${r1.source} = ${r1.value}`); pass = false; }
  delete process.env.FEATURE_VOICE_MODE;

  // ② 本地门控（无 env 时生效）
  await run({ inputs: { op: 'set', flag: 'audio_fallback_chain', value: true } });
  const r2 = _resolveSync('audio_fallback_chain');
  if (r2.value === true && r2.source === 'local') ok('local override works');
  else { ng(`local override: got ${r2.source} = ${r2.value}`); pass = false; }
  _localOverrides = {};

  // ③ 远程评估
  _remoteCache = { debug_tools: false };
  _initialized = true;
  const r3 = _resolveSync('debug_tools');
  if (r3.value === false && r3.source === 'remote') ok('remote eval works');
  else { ng(`remote eval: got ${r3.source} = ${r3.value}`); pass = false; }
  _remoteCache = null;
  _initialized = false;

  // ④ 磁盘缓存
  _diskCache = { multi_agent: true };
  const r4 = _resolveSync('multi_agent');
  if (r4.value === true && r4.source === 'disk') ok('disk cache works');
  else { ng(`disk cache: got ${r4.source} = ${r4.value}`); pass = false; }
  _diskCache = null;

  // ⑤ 硬编码默认值
  const r5 = _resolveSync('teach_me');
  if (r5.value === true && r5.source === 'hardcoded') ok('hardcoded default works');
  else { ng(`hardcoded: got ${r5.source} = ${r5.value}`); pass = false; }

  // ⑥ 不存在 flag 返回 false
  const r6 = _resolveSync('nonexistent_flag');
  if (r6.value === false && r6.source === 'hardcoded') ok('nonexistent flag returns false');
  else { ng(`nonexistent: got ${r6.source} = ${r6.value}`); pass = false; }

  // ⑦ get_cached 异步初始化
  const r7 = await run({ inputs: { op: 'get_cached', flag: 'debug_tools' } });
  if (r7.outputs.value === true && r7.outputs.source) ok('get_cached async works');
  else { ng(`get_cached: got ${JSON.stringify(r7.outputs)}`); pass = false; }

  // ⑧ list 返回所有
  const r8 = await run({ inputs: { op: 'list' } });
  const keys = Object.keys(r8.outputs.all);
  if (keys.length >= Object.keys(HARDCODED).length) ok(`list returns ${keys.length} flags`);
  else { ng(`list: got ${keys.length} flags, expected >= ${Object.keys(HARDCODED).length}`); pass = false; }

  // ⑨ status
  const r9 = await run({ inputs: { op: 'status' } });
  if (typeof r9.outputs.initialized === 'boolean') ok('status works');
  else { ng(`status: missing initialized`); pass = false; }

  report(NAME);
  return pass;
}
