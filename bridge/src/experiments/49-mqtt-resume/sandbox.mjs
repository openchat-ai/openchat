// 49-mqtt-resume/sandbox.mjs
//
// LLM-code sandbox: takes the LLM's connectWithResume source, wraps it in a
// Function constructor with mock globals, runs it, collects packets.
//
// Rebuilt per C-PLAN-REPORT §2 row 5 (JS 整合脚手架) — 5 件套 §5:
//   (a) prompt forbids require/import/module.exports (in task.json)
//   (b) preprocessSource strips CommonJS / ESM import/export lines defensively
//   (c) mock `net.connect` is a FACTORY (not a constructor)
//   (d) `socket.write(buf, callback)` accepts a callback (real Node API)
//   (e) setImmediate callbacks wrapped in try-catch (no process crash on LLM bugs)
//
// Broker is VIRTUAL (no real TCP): the mock net tracks attemptCount and fires
// 'error' on first N attempts (when refuseConnackCount > 0) instead of 'connect'.
// This isolates the LLM retry test from network/timing flakiness.

import { renderConnect, renderSubscribe } from '../lib/mqtt-render-tools.mjs';

// === Preprocess: strip CommonJS / ESM boilerplate ===
// Defensive — prompt should already forbid these, but LLM may slip.
export function preprocessSource(source) {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (/^const\s+\{?\s*\w+(\s*,\s*\w+)*\s*\}?\s*=\s*require\s*\(/.test(t)) return false;
      if (/^const\s+\w+\s*=\s*require\s*\(/.test(t)) return false;
      if (/^let\s+\{?\s*\w+(\s*,\s*\w+)*\s*\}?\s*=\s*require\s*\(/.test(t)) return false;
      if (/^let\s+\w+\s*=\s*require\s*\(/.test(t)) return false;
      if (/^import\s+.*\s+from\s+['"]/.test(t)) return false;
      if (/^export\s+/.test(t)) return false;
      if (/^module\.exports\s*=/.test(t)) return false;
      return true;
    })
    .join('\n')
    .replace(/^\s*export\s+(async\s+function|function|const|let|var)\s/gm, '$1 ');
}

// === Mock net: factory + write callback + try-catch wrappers ===
//
// collector: optional array; each MockSocket instance pushes itself to it
//            so the caller can inspect written bytes after the run
function createMockNetV2({ refuseConnackCount = 0 } = {}, collector = null) {
  // attemptCount is per-mock-net-instance; each run gets a fresh count
  let attemptCount = 0;

  function MockSocket() {
    const sock = {
      _writtenBytes: [],
      _listeners: {},
      destroyed: false,
    };
    sock.writtenBytes = () => sock._writtenBytes;

    let connectFired = false;
    sock.connect = function (...args) {
      if (connectFired) return sock;
      connectFired = true;
      attemptCount++;
      const shouldRefuse = attemptCount <= refuseConnackCount;

      setImmediate(() => {
        try {
          if (shouldRefuse) {
            // Simulate CONNACK refused: fire 'error' event (LLM's on('error') catches)
            const errListeners = sock._listeners.error || [];
            const err = new Error(`CONNACK refused: code=5`);
            for (const l of errListeners) l.call(sock, err);
            return;
          }
          // 'connect' event listeners
          const listeners = sock._listeners.connect || [];
          for (const l of listeners) l.call(sock);
          // The connect callback (2nd arg to net.connect or sock.connect)
          for (const a of args) {
            if (typeof a === 'function') {
              try { a.call(sock); } catch (e) {
                const errListeners = sock._listeners.error || [];
                for (const l of errListeners) l.call(sock, e);
              }
              break;
            }
          }
        } catch (e) {
          const errListeners = sock._listeners.error || [];
          for (const l of errListeners) l.call(sock, e);
        }
      });
      return sock;
    };

    sock.write = function (data, encodingOrCallback, maybeCallback) {
      // Real Node: socket.write(data, [encoding], [callback])
      const callback = typeof encodingOrCallback === 'function' ? encodingOrCallback : maybeCallback;
      const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8';
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding);
      sock._writtenBytes.push(buf);
      if (callback) {
        setImmediate(() => {
          try { callback(); } catch (e) {
            const errListeners = sock._listeners.error || [];
            for (const l of errListeners) l.call(sock, e);
          }
        });
      }
    };

    sock.on = function (event, listener) {
      sock._listeners[event] = sock._listeners[event] || [];
      sock._listeners[event].push(listener);
      return sock;
    };
    sock.once = function (event, listener) {
      const wrapped = (...args) => {
        listener.apply(sock, args);
        sock._listeners[event] = (sock._listeners[event] || []).filter((l) => l !== wrapped);
      };
      sock._listeners[event] = sock._listeners[event] || [];
      sock._listeners[event].push(wrapped);
      return sock;
    };
    sock.end = function () { /* no-op for mock */ return sock; };
    sock.destroy = function () { sock.destroyed = true; return sock; };

    if (collector) collector.push(sock);
    return sock;
  }

  // Real Node net.connect / createConnection are FACTORIES — create socket + auto-connect
  function factoryConnect(...args) {
    const sock = new MockSocket();
    sock.connect(...args);
    return sock;
  }

  return { Socket: MockSocket, connect: factoryConnect, createConnection: factoryConnect };
}

// === Parse MQTT bytes into packet boundaries ===
// MQTT 3.1.1 §2.1: fixed header = [type+flags] [remLen (variable)] [variable header] [payload]
// Variable-length encoding: each byte uses lower 7 bits, MSB=1 means "more bytes"
// Returns: array of { type, bytes } where type is the upper 4 bits of the first byte
function findPackets(bytes) {
  const packets = [];
  let i = 0;
  while (i < bytes.length) {
    const type = bytes[i] >> 4;
    let remLen = 0;
    let multiplier = 1;
    let j = i + 1;
    while (j < bytes.length) {
      const b = bytes[j];
      remLen += (b & 0x7f) * multiplier;
      j++;
      if ((b & 0x80) === 0) break;
      multiplier *= 128;
      if (multiplier > 128 * 128 * 128) break;  // malformed guard
    }
    const totalLen = (j - i) + remLen;
    if (totalLen > bytes.length - i) break;  // truncated — stop here
    packets.push({ type, bytes: Buffer.from(bytes.subarray(i, i + totalLen)) });
    i += totalLen;
  }
  return packets;
}

// === Run LLM source in sandbox ===
// Returns structured result: { source, runtimeMs, error?, packets, bytesObserved, returnValue }
export async function runSandbox({ source, testArgs, sessionStore, refuseConnackCount = 0, timeout = 15000 }) {
  if (!source || typeof source !== 'string') {
    return { source, runtimeMs: 0, error: 'no source', packets: [], bytesObserved: Buffer.alloc(0), returnValue: null };
  }

  const cleaned = preprocessSource(source);
  const collector = [];
  const mockNet = createMockNetV2({ refuseConnackCount }, collector);
  const start = Date.now();

  const wrapped = `
    "use strict";
    const net = arguments[0];
    const renderConnect = arguments[1];
    const renderSubscribe = arguments[2];
    const testArgs = arguments[3];
    const sessionStore = arguments[4];
    return (async () => {
      ${cleaned}
      if (typeof connectWithResume !== 'function') {
        return { error: 'connectWithResume not defined' };
      }
      try {
        // LLM's connectWithResume takes a single args object: {host, port, clientId, sessionStore}
        const fullArgs = Object.assign({}, testArgs, { sessionStore });
        const result = await Promise.race([
          connectWithResume(fullArgs),
          new Promise((_, rej) => setTimeout(() => rej(new Error('sandbox-timeout-${timeout}ms')), ${timeout})),
        ]);
        return { ok: true, result };
      } catch (e) {
        return { error: e.message || String(e) };
      }
    })();
  `;

  let result;
  try {
    const fn = new Function(wrapped);
    result = await fn(mockNet, renderConnect, renderSubscribe, testArgs, sessionStore);
  } catch (e) {
    return {
      source,
      runtimeMs: Date.now() - start,
      error: 'compile-or-runtime: ' + (e.message || String(e)),
      packets: [],
      bytesObserved: Buffer.alloc(0),
      returnValue: null,
    };
  }

  const bytesObserved = Buffer.concat(collector.flatMap((s) => s._writtenBytes));
  const packets = findPackets(bytesObserved);
  return {
    source,
    runtimeMs: Date.now() - start,
    error: result?.error || null,
    packets,
    bytesObserved,
    returnValue: result?.ok ? result.result : null,
  };
}
