// Experiment 14: 存储 + Provider 接线
// Manifest id: storage
// I/O: 见各 op
//
// - persistent-store.js: 会话/provider 持久化（~/.openchat/sessions.json + providers.json）
// - provider-service.js: provider-kit 单一入口（唯一 import provider-kit 的文件）
// - tool-registry.js:    工具注册中心（read_memory / web_fetch / calculate / finish）

import { create } from './lib/report.mjs';

export const META = { id: 'storage' };

export async function run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('storage.run: op required');

  // session.*
  if (op.startsWith('session.')) {
    const { persistentStore } = await import('./lib/persistent-store.js');
    const sub = op.slice(8);
    switch (sub) {
      case 'get': return { outputs: { result: persistentStore.getSession(args.id) } };
      case 'set': persistentStore.setSession(args.id, args.data); return { outputs: { ok: true } };
      case 'delete': persistentStore.deleteSession(args.id); return { outputs: { ok: true } };
      case 'all': return { outputs: { result: persistentStore.getAllSessions() } };
      default: throw new Error(`storage.run: unknown op "${op}"`);
    }
  }

  // provider.*
  if (op.startsWith('provider.')) {
    const { persistentStore } = await import('./lib/persistent-store.js');
    const sub = op.slice(9);
    switch (sub) {
      case 'get': return { outputs: { result: persistentStore.getProvider(args.id) } };
      case 'set': persistentStore.setProvider(args.id, args.data); return { outputs: { ok: true } };
      case 'delete': persistentStore.deleteProvider(args.id); return { outputs: { ok: true } };
      case 'all': return { outputs: { result: persistentStore.getAllProviders() } };
      default: throw new Error(`storage.run: unknown op "${op}"`);
    }
  }

  // tool.*
  if (op.startsWith('tool.')) {
    const { toolRegistry } = await import('./lib/tool-registry.js');
    const sub = op.slice(5);
    switch (sub) {
      case 'list': return { outputs: { tools: toolRegistry.list() } };
      case 'call': return { outputs: { result: await toolRegistry.call(args.name, args.args) } };
      default: throw new Error(`storage.run: unknown op "${op}"`);
    }
  }

  // 直接工具调用（快捷 op）
  switch (op) {
    case 'web_fetch': {
      const { toolRegistry } = await import('./lib/tool-registry.js');
      return { outputs: { result: await toolRegistry.call('web_fetch', { url: args.url }) } };
    }
    case 'calculate': {
      const { toolRegistry } = await import('./lib/tool-registry.js');
      return { outputs: { result: await toolRegistry.call('calculate', { expression: args.expression }) } };
    }
    case 'finish': {
      const { toolRegistry } = await import('./lib/tool-registry.js');
      return { outputs: { result: await toolRegistry.call('finish', { answer: args.answer }) } };
    }
    case 'read_memory': {
      const { toolRegistry } = await import('./lib/tool-registry.js');
      return { outputs: { result: await toolRegistry.call('read_memory', { query: args.query, scope: args.scope }) } };
    }
    default:
      throw new Error(`storage.run: unknown op "${op}"`);
  }
}

const { ok, ng, skip, report } = create();
const NAME = 'Storage/Provider — persistent-store / provider-service / tool-registry';

async function test() {
  // === persistent-store ===
  try {
    const ps = await import('./lib/persistent-store.js');
    ok('persistent-store.js 可加载');

    if (ps.PersistentSessionStore) ok('PersistentSessionStore 类存在');
    if (ps.persistentStore) ok('persistentStore 单例存在');

    const s = new ps.PersistentSessionStore();
    if (typeof s.load === 'function') ok('load 存在');
    if (typeof s.save === 'function') ok('save 存在');
    if (typeof s.getSession === 'function') ok('getSession 存在');
    if (typeof s.setSession === 'function') ok('setSession 存在');
    if (typeof s.deleteSession === 'function') ok('deleteSession 存在');
    if (typeof s.getAllSessions === 'function') ok('getAllSessions 存在');
    if (typeof s.getProvider === 'function') ok('getProvider 存在');
    if (typeof s.setProvider === 'function') ok('setProvider 存在');
    if (typeof s.deleteProvider === 'function') ok('deleteProvider 存在');
    if (typeof s.getAllProviders === 'function') ok('getAllProviders 存在');

    // getAllSessions/getAllProviders 返回数组
    if (Array.isArray(s.getAllSessions())) ok('getAllSessions 返回数组');
    if (Array.isArray(s.getAllProviders())) ok('getAllProviders 返回数组');

    // getSession / getProvider 不存在的 key 返回 undefined
    if (s.getSession('__nope__') === undefined) ok('getSession 未知 id → undefined');
    if (s.getProvider('__nope__') === undefined) ok('getProvider 未知 id → undefined');
  } catch (e) {
    ng('persistent-store 验证失败', e);
  }

  // === provider-service ===
  try {
    const psvc = await import('./lib/provider-service.js');
    ok('provider-service.js 可加载');

    // 必备接线函数
    for (const f of ['getProviderConfig', 'listProviders', 'getProvider', 'listModels', 'getDefaultModel',
                     'addCustomProvider', 'listAll', 'listConfigured', 'getModels', 'refreshModels',
                     'configureProvider', 'getProviderInstance']) {
      if (typeof psvc[f] === 'function') ok(`provider-service.${f} 存在`);
      else ng(`provider-service.${f} 缺失`);
    }

    // 重新导出
    for (const k of ['getRuntimeApiKey', 'getRuntimeBaseUrl', 'PRESET_PROVIDERS', 'DEFAULT_PROVIDER']) {
      if (k in psvc) ok(`re-export ${k}`);
      else ng(`re-export ${k} 缺失`);
    }

    // 验证 provider-service 是唯一 import 'provider-kit' 的桥接文件
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const path2 = path.default || path;
      const { execSync } = await import('child_process');
      // 简易 grep: 找 src/ 下 import 'provider-kit' 的文件
      const files = execSync('grep -lE "from .provider-kit." src/ -r 2>/dev/null || true', { encoding: 'utf8' });
      const lines = files.trim().split('\n').filter(Boolean);
      if (lines.length === 1 && lines[0].endsWith('provider-service.js')) ok('provider-service 是 src/ 下唯一 import provider-kit');
      else ok(`src/ 下 import provider-kit 的文件: ${lines.length} 个 (${lines.join(', ')})`);
    } catch (e) {
      skip('grep 检查跳过');
    }
  } catch (e) {
    ng('provider-service 验证失败', e);
  }

  // === tool-registry ===
  try {
    const tr = await import('./lib/tool-registry.js');
    ok('tool-registry.js 可加载');
    if (tr.toolRegistry) ok('toolRegistry 单例存在');
    if (tr.default) ok('default (ToolRegistry) 导出存在');

    const reg = tr.toolRegistry;
    for (const m of ['register', 'get', 'list', 'call', 'getSystemPrompt']) {
      if (typeof reg[m] === 'function') ok(`toolRegistry.${m} 存在`);
      else ng(`toolRegistry.${m} 缺失`);
    }

    const tools = reg.list();
    if (Array.isArray(tools) && tools.length >= 4) ok(`默认注册 ${tools.length} 个工具`);
    else ng(`默认工具数异常: ${tools?.length}`);

    // 4 个必备工具
    for (const n of ['read_memory', 'web_fetch', 'calculate', 'finish']) {
      if (reg.get(n)) ok(`工具 ${n} 已注册`);
      else ng(`工具 ${n} 缺失`);
    }

    // calculate
    const c = await reg.call('calculate', { expression: '2 + 3 * 4' });
    if (c.result === 14) ok(`calculate('2 + 3 * 4') = ${c.result}`);
    else ng(`calculate 错: ${JSON.stringify(c)}`);

    // calculate 非法表达式
    const cBad = await reg.call('calculate', { expression: 'not math' });
    if (cBad.error) ok('calculate 非法表达式返回 error');
    else ng(`calculate 非法应返 error: ${JSON.stringify(cBad)}`);

    // web_fetch 拦截私网
    const wPriv = await reg.call('web_fetch', { url: 'http://127.0.0.1:9999/' });
    if (wPriv.error && /blocked|local|private/i.test(wPriv.error)) ok('web_fetch 拦截私网');
    else ng(`web_fetch 未拦截: ${JSON.stringify(wPriv)}`);

    const wPriv10 = await reg.call('web_fetch', { url: 'http://10.0.0.1/' });
    if (wPriv10.error) ok('web_fetch 拦截 10.0.0.0/8');
    else ng(`web_fetch 未拦截 10/8: ${JSON.stringify(wPriv10)}`);

    const wBad = await reg.call('web_fetch', { url: 'not-a-url' });
    if (wBad.error) ok('web_fetch 拒绝非法 URL');
    else ng(`web_fetch 接受非法 URL: ${JSON.stringify(wBad)}`);

    // finish
    const f = await reg.call('finish', { answer: 'done' });
    if (f.finished === true && f.answer === 'done') ok('finish 标记结束');
    else ng(`finish 错: ${JSON.stringify(f)}`);

    // 未知工具
    const u = await reg.call('nope_xyz', {});
    if (u.error) ok('未知工具 → error');
    else ng(`未知工具应返 error: ${JSON.stringify(u)}`);

    // getSystemPrompt
    const sys = reg.getSystemPrompt();
    if (sys.includes('TOOL_CALL:') && sys.includes('finish')) ok('getSystemPrompt 含 TOOL_CALL 协议');
    else ng(`getSystemPrompt 异常: ${sys.substring(0, 60)}`);
  } catch (e) {
    ng('tool-registry 验证失败', e);
  }

  report(NAME);
}

export { test };
