// sandbox.mjs — 把 LLM 写的 mqttSubscribe 函数跑起来, 收集它写到 socket 的字节
//
// 思路:
//   1. 用 Function 构造 + mock globals (net, renderConnect, renderSubscribe)
//   2. 注入 LLM 写的源码
//   3. 调 mqttSubscribe({...})
//   4. 限时 3s, 让 LLM 写完 CONNECT + SUBSCRIBE
//   5. 收集 mock socket 收到的所有 bytes
//
// 不真连 TCP. net.Socket 用 mock 替, write() 记录到 written[] 数组

import { TOOL_EXECUTORS, createMockSocket } from './tools.mjs';

const TEST_ARGS = {
  host: 'localhost',
  port: 1883,
  topic: 'sensor/+',
  clientId: 'test-123',
};

// === mock render tools (真调 TOOL_EXECUTORS) ===
function makeMockRenderConnect() {
  return async function renderConnect(args) {
    return TOOL_EXECUTORS.renderConnect(args);
  };
}
function makeMockRenderSubscribe() {
  return async function renderSubscribe(args) {
    return TOOL_EXECUTORS.renderSubscribe(args);
  };
}

// === mock net.Socket (返回 createMockSocket 实例) ===
function MockSocket() {
  const sock = createMockSocket();
  // 拦截 connect: 不真连, 同步触发 connect 事件
  sock.connect = function (portOrArgs, hostMaybe, callback) {
    setImmediate(() => {
      // 触发 'connect' 事件, 让 LLM 的 .on('connect', ...) 跑
      const listeners = sock._listeners?.connect || [];
      for (const l of listeners) l.call(sock);
      if (typeof callback === 'function') callback.call(sock);
    });
    return sock;
  };
  // 拦截 on/once: 记录 listeners
  sock._listeners = {};
  sock.on = function (event, listener) {
    sock._listeners[event] = sock._listeners[event] || [];
    sock._listeners[event].push(listener);
    return sock;
  };
  sock.once = sock.on;
  // 写完后允许 'data' 事件触发 (让 LLM resolve promise)
  // 我们不主动 push data, 让 LLM 等到 timeout 自然 reject
  return sock;
}

function createMockNet() {
  return {
    Socket: MockSocket,
    connect: MockSocket,  // 一些 LLM 用 net.connect() 而非 new net.Socket()
    createConnection: MockSocket,
  };
}

// === 跑 sandbox ===
export async function runSandbox(source) {
  if (!source || typeof source !== 'string') {
    return { error: 'no source', connectBytes: null, subscribeBytes: null };
  }

  // 构造 mock 上下文
  const mockNet = createMockNet();
  const renderConnect = makeMockRenderConnect();
  const renderSubscribe = makeMockRenderSubscribe();

  // 给 LLM 源码外面包一层, 注入 mocks
  // 关键: renderConnect/renderSubscribe 是 async (返回 Promise), 所以 await
  // LLM 可能用 require / import, 我们不处理 import (因为它是 ESM); 假设 LLM 用 net.Socket 全局
  const wrapped = `
    "use strict";
    const net = arguments[0].net;
    const renderConnect = arguments[0].renderConnect;
    const renderSubscribe = arguments[0].renderSubscribe;
    return (async () => {
      ${source}
      // 调 mqttSubscribe, 限时
      if (typeof mqttSubscribe !== 'function') {
        return { error: 'mqttSubscribe not defined', connectBytes: null, subscribeBytes: null };
      }
      try {
        const result = await Promise.race([
          mqttSubscribe(arguments[0].args),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 3s')), 3000)),
        ]);
        return { result };
      } catch (e) {
        return { error: e.message };
      }
    })();
  `;

  let result;
  try {
    const fn = new Function(wrapped);
    result = await fn(mockNet, renderConnect, renderSubscribe, { args: TEST_ARGS });
  } catch (e) {
    return { error: 'compile or runtime: ' + e.message, connectBytes: null, subscribeBytes: null };
  }

  // 现在 result 里有 error 或 result (mqttSubscribe 返回值)
  // 我们要拿的是 mock socket 的 written bytes
  // 但 mock socket 是 LLM 在自己的 scope 里创建的, sandbox 拿不到
  // 解决: 通过 mockNet.Socket 的 wrapper 收集所有实例的 written
  // 简化: 让 LLM 用全局 mockNet.Socket 拿到的所有 socket 实例的 written 字节
  // 我们存一个全局 list
  if (!globalThis.__E39_SOCKETS__) globalThis.__E39_SOCKETS__ = [];
  // 跑完后从全局收集
  const allWritten = globalThis.__E39_SOCKETS__.flatMap((s) => s.writtenBytes());
  // 清空下次再用
  globalThis.__E39_SOCKETS__ = [];

  // 分析 bytes: 前 22 字节应是 CONNECT (test-123 clientId), 后面应是 SUBSCRIBE
  // 我们根据第一个字节判断 packet 类型, 切片
  // 0x10 = CONNECT, 0x82 = SUBSCRIBE
  // 用 findPackets 找 packet 边界 (variable length encoding)
  const packets = findPackets(allWritten);

  return {
    error: result?.error || null,
    packets,
    allWrittenLength: allWritten.length,
    result: result?.result !== undefined ? String(result.result).slice(0, 100) : null,
  };
}

// === mock socket 注册: 让所有 mock socket 都加到 globalThis list ===
// 修补上面的 MockSocket, 把它生成的 socket 注册到 globalThis
function createMockNetV2() {
  function MockSocket() {
    const sock = createMockSocket();
    if (!globalThis.__E39_SOCKETS__) globalThis.__E39_SOCKETS__ = [];
    globalThis.__E39_SOCKETS__.push(sock);
    let connectFired = false;
    let dataFired = false;
    sock.connect = function (...args) {
      if (connectFired) return sock;
      connectFired = true;
      setImmediate(() => {
        try {
          const listeners = sock._listeners?.connect || [];
          for (const l of listeners) l.call(sock);
          const cb = args.find((a) => typeof a === 'function');
          if (cb) cb.call(sock);
        } catch (e) {
          // LLM callback 抛错 (例如 socket=undefined) — 不让进程崩, 转成 'error' 事件
          const errListeners = sock._listeners?.error || [];
          for (const l of errListeners) l.call(sock, e);
        }
      });
      return sock;
    };
    // 写完后, 模拟 broker 响应
    // 第 1 次写 (CONNECT): 回复 CONNACK 0x20 0x02 0x00 0x00
    // 第 2 次写 (SUBSCRIBE): 回复 PUBLISH (测试消息) 0x30 len topic_len topic payload
    // 数据通过 'data' 事件派发
    const origWrite = sock.write.bind(sock);
    let writeCount = 0;
    sock.write = function (data, encodingOrCallback, maybeCallback) {
      // Node 真实 write(data, [encoding], callback) — mock 也要支持 callback
      const callback = typeof encodingOrCallback === 'function' ? encodingOrCallback : maybeCallback;
      const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8';
      origWrite(data, encoding);
      writeCount++;
      if (callback) setImmediate(() => {
        try { callback(); } catch (e) {
          const errListeners = sock._listeners?.error || [];
          for (const l of errListeners) l.call(sock, e);
        }
      });  // 模拟 flush 后触发
      if (writeCount === 1) {
        // 模拟 CONNACK
        setImmediate(() => {
          if (dataFired) return;
          dataFired = true;
          const listeners = sock._listeners?.data || [];
          const connack = Buffer.from([0x20, 0x02, 0x00, 0x00]);
          try { for (const l of listeners) l.call(sock, connack); } catch (e) { /* LLM data 处理器挂了, 忽略 */ }
        });
      } else if (writeCount === 2) {
        // 模拟 broker 推一条 PUBLISH
        setImmediate(() => {
          if (dataFired) return;
          dataFired = true;
          const topic = 'sensor/+';
          const payload = Buffer.from('test-msg', 'utf8');
          // PUBLISH 0x30 + len + topic_len(2) + topic + payload
          const topicLenBuf = Buffer.alloc(2);
          topicLenBuf.writeUInt16BE(Buffer.byteLength(topic, 'utf8'), 0);
          const rem = Buffer.concat([topicLenBuf, Buffer.from(topic, 'utf8'), payload]);
          const remLen = rem.length;
          // 简化: 假定 remLen < 128, 用 1 字节
          const publish = Buffer.concat([Buffer.from([0x30, remLen]), rem]);
          const listeners = sock._listeners?.data || [];
          try { for (const l of listeners) l.call(sock, publish); } catch (e) { /* LLM data 处理器挂了, 忽略 */ }
        });
      }
    };
    sock._listeners = {};
    sock.on = function (event, listener) {
      sock._listeners[event] = sock._listeners[event] || [];
      sock._listeners[event].push(listener);
      return sock;
    };
    sock.once = function (event, listener) {
      // once 走 on 同样路径, 但标记只跑 1 次
      const wrapped = (...args) => {
        listener.apply(sock, args);
        // 移除
        sock._listeners[event] = (sock._listeners[event] || []).filter((l) => l !== wrapped);
      };
      sock._listeners[event] = sock._listeners[event] || [];
      sock._listeners[event].push(wrapped);
      return sock;
    };
    return sock;
  }
  // net.connect / net.createConnection 是工厂函数 (不 new) — 创建 socket 并自动 connect
  function factoryConnect(...args) {
    const sock = new MockSocket();
    sock.connect(...args);
    return sock;
  }
  return { Socket: MockSocket, connect: factoryConnect, createConnection: factoryConnect };
}

// === 找 packet 边界 (variable length 编码) ===
function findPackets(bytes) {
  const packets = [];
  let i = 0;
  while (i < bytes.length) {
    const type = bytes[i];
    // 读 remaining length (变长)
    let remLen = 0;
    let multiplier = 1;
    let j = i + 1;
    while (j < bytes.length) {
      const b = bytes[j];
      remLen += (b & 0x7f) * multiplier;
      j++;
      if ((b & 0x80) === 0) break;
      multiplier *= 128;
      if (multiplier > 128 * 128 * 128) break;  // 防 malformed
    }
    const totalLen = (j - i) + remLen;
    if (totalLen > bytes.length - i) break;  // 截断
    packets.push({ type, bytes: bytes.slice(i, i + totalLen) });
    i += totalLen;
  }
  return packets;
}

// === 预处理源码: 剥掉 LLM 写的 require / import / export 行 ===
// sandbox 注入 mock 在 scope 里, LLM 写 `const net = require('net')` 会拿真 net 创真 socket (失败)
// export 是 ESM 关键字, Function 构造器是 script 模式不接受
function preprocessSource(source) {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (/^const\s+\{?\s*\w+(\s*,\s*\w+)*\s*\}?\s*=\s*require\s*\(/.test(t)) return false;
      if (/^const\s+\w+\s*=\s*require\s*\(/.test(t)) return false;
      if (/^let\s+\{?\s*\w+(\s*,\s*\w+)*\s*\}?\s*=\s*require\s*\(/.test(t)) return false;
      if (/^let\s+\w+\s*=\s*require\s*\(/.test(t)) return false;
      if (/^import\s+.*\s+from\s+['"]/.test(t)) return false;
      if (/^export\s+/.test(t)) return false;  // export async function mqttSubscribe → async function mqttSubscribe
      if (/^module\.exports\s*=/.test(t)) return false;  // CommonJS — 残留会让 Function 构造器编译挂
      return true;
    })
    .join('\n')
    // 修常见 typo: "export async function X" → "async function X" (filter 已剥, 但多行 export 残留)
    .replace(/^\s*export\s+(async\s+function|function|const|let|var)\s/gm, '$1 ');
}

// === 重新导出: 用 V2 net (注册到 globalThis) ===
export async function runSandboxV2(source) {
  if (!source || typeof source !== 'string') {
    return { error: 'no source', packets: [] };
  }
  const cleaned = preprocessSource(source);
  globalThis.__E39_SOCKETS__ = [];
  const mockNet = createMockNetV2();
  const renderConnect = makeMockRenderConnect();
  const renderSubscribe = makeMockRenderSubscribe();

  const wrapped = `
    "use strict";
    const net = arguments[0];
    const renderConnect = arguments[1];
    const renderSubscribe = arguments[2];
    const testArgs = arguments[3];
    return (async () => {
      ${cleaned}
      if (typeof mqttSubscribe !== 'function') {
        return { error: 'mqttSubscribe not defined' };
      }
      try {
        const result = await Promise.race([
          mqttSubscribe(testArgs),
          new Promise((_, rej) => setTimeout(() => rej(new Error('sandbox-timeout-3s')), 3000)),
        ]);
        return { ok: true, result: typeof result };
      } catch (e) {
        return { error: 'sandbox-err: ' + e.message };
      }
    })();
  `;

  let result;
  try {
    const fn = new Function(wrapped);
    result = await fn(mockNet, renderConnect, renderSubscribe, TEST_ARGS);
  } catch (e) {
    globalThis.__E39_SOCKETS__ = [];
    return { error: 'compile: ' + e.message, packets: [] };
  }

  const allWritten = (globalThis.__E39_SOCKETS__ || []).flatMap((s) => s.writtenBytes());
  globalThis.__E39_SOCKETS__ = [];
  const packets = findPackets(allWritten);
  return { ...result, packets, allWrittenLength: allWritten.length };
}
