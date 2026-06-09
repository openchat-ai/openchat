// 50-mqtt-split/sandbox.mjs
//
// LLM-code sandbox for 2-round split. Three runners:
//   runR1       — R1 alone (r1SandboxRan, r1RetriesSurvivedFailure)
//   runR2       — R2 alone (r2SandboxRan, r2PacketsCorrect)
//   runCombined — R1 + R2 in one sandbox (combined 4 dims)
//
// Built on E49 sandbox pattern (preprocessSource + createMockNetV2 + findPackets),
// re-implemented in this file to keep E50 self-contained.
//
// Sandbox principles (5 件套 §5):
//   (a) prompt forbids require/import/module.exports
//   (b) preprocessSource strips CommonJS / ESM import/export defensively
//   (c) mock `net.connect` is a FACTORY (not a constructor)
//   (d) `socket.write(buf, callback)` accepts a callback
//   (e) setImmediate callbacks wrapped in try-catch

import { renderConnect, renderSubscribe } from '../lib/mqtt-render-tools.mjs';
import { preprocessSource } from '../49-mqtt-resume/sandbox.mjs';

// === Mock net: factory + write callback + try-catch wrappers ===
// Same pattern as E49, re-implemented here for self-containment.
// Collector: array; each MockSocket instance pushes itself to it
function createMockNetV2({ refuseConnackCount = 0 } = {}, collector = null) {
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
            const errListeners = sock._listeners.error || [];
            const err = new Error(`CONNACK refused: code=5`);
            for (const l of errListeners) l.call(sock, err);
            return;
          }
          const listeners = sock._listeners.connect || [];
          for (const l of listeners) l.call(sock);
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
    sock.end = function () { return sock; };
    sock.destroy = function () { sock.destroyed = true; return sock; };

    if (collector) collector.push(sock);
    return sock;
  }

  function factoryConnect(...args) {
    const sock = new MockSocket();
    sock.connect(...args);
    return sock;
  }

  return {
    Socket: MockSocket,
    connect: factoryConnect,
    createConnection: factoryConnect,
    _attemptCount: () => attemptCount,
  };
}

// === Parse MQTT bytes into packet boundaries ===
// (Same as E49 — MQTT 3.1.1 §2.1 fixed header parsing)
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
      if (multiplier > 128 * 128 * 128) break;
    }
    const totalLen = (j - i) + remLen;
    if (totalLen > bytes.length - i) break;
    packets.push({ type, bytes: Buffer.from(bytes.subarray(i, i + totalLen)) });
    i += totalLen;
  }
  return packets;
}

// === Helper: build a wrapped IIFE that runs LLM code with given args ===
// The wrapper exposes: net, renderConnect, renderSubscribe, testArgs, sessionStore, prebuiltConn (for R2)
function buildWrapper({ cleaned, fnName, argsExpr, postRun, extraDecls = '' }) {
  return `
    "use strict";
    const net = arguments[0];
    const renderConnect = arguments[1];
    const renderSubscribe = arguments[2];
    const testArgs = arguments[3];
    const sessionStore = arguments[4];
    const prebuiltConn = arguments[5];
    ${extraDecls}
    return (async () => {
      ${cleaned}
      if (typeof ${fnName} !== 'function') {
        return { error: '${fnName} not defined' };
      }
      try {
        const result = await Promise.race([
          ${fnName}(${argsExpr}),
          new Promise((_, rej) => setTimeout(() => rej(new Error('sandbox-timeout-15000ms')), 15000)),
        ]);
        return { ok: true, result };
      } catch (e) {
        return { error: e.message || String(e) };
      }
    })();
  `;
}

// === Runner 1: R1 alone ===
// Returns { source, runtimeMs, error?, packets, bytesObserved, returnValue, attemptCount }
export async function runR1({ source, testArgs, refuseConnackCount = 0, timeout = 15000 }) {
  if (!source || typeof source !== 'string') {
    return { source, runtimeMs: 0, error: 'no source', packets: [], bytesObserved: Buffer.alloc(0), returnValue: null, attemptCount: 0 };
  }

  const cleaned = preprocessSource(source);
  const collector = [];
  const mockNet = createMockNetV2({ refuseConnackCount }, collector);
  const start = Date.now();

  const wrapped = buildWrapper({
    cleaned,
    fnName: 'connectWithRetry',
    argsExpr: 'testArgs',
    postRun: null,
  });

  let result;
  try {
    const fn = new Function(wrapped);
    result = await fn(mockNet, renderConnect, renderSubscribe, testArgs, null, null);
  } catch (e) {
    return {
      source,
      runtimeMs: Date.now() - start,
      error: 'compile-or-runtime: ' + (e.message || String(e)),
      packets: [],
      bytesObserved: Buffer.alloc(0),
      returnValue: null,
      attemptCount: mockNet._attemptCount(),
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
    attemptCount: mockNet._attemptCount(),
  };
}

// === Runner 2: R2 alone ===
// Builds a mock socket manually (no net.connect needed), wraps in conn, calls restoreSubscriptions.
// Returns { source, runtimeMs, error?, packets, bytesObserved, returnValue }
export async function runR2({ source, testArgs, sessionStore, refuseConnackCount = 0, timeout = 15000 }) {
  if (!source || typeof source !== 'string') {
    return { source, runtimeMs: 0, error: 'no source', packets: [], bytesObserved: Buffer.alloc(0), returnValue: null };
  }

  const cleaned = preprocessSource(source);
  const collector = [];
  // Build a "pre-connected" mock socket. We don't use the net factory here —
  // R2 is supposed to use a conn that's already connected (handed off from R1).
  const mockNet = createMockNetV2({ refuseConnackCount: 0 }, collector);
  const preSocket = new mockNet.Socket();
  // Mark it as if 'connect' has already fired (no-op since R2 doesn't listen for connect)

  const start = Date.now();
  const conn = { socket: preSocket, clientId: testArgs.clientId };

  const wrapped = buildWrapper({
    cleaned,
    fnName: 'restoreSubscriptions',
    argsExpr: '({conn: prebuiltConn, sessionStore})',
    postRun: null,
  });

  let result;
  try {
    const fn = new Function(wrapped);
    result = await fn(
      mockNet, renderConnect, renderSubscribe,
      testArgs, sessionStore, /* prebuiltConn */ conn
    );
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

// === Runner 3: Combined (R1 + R2 in one sandbox) ===
// Single IIFE: R1 first, then R2 with R1's returned conn. Shared mockNet, shared collector.
// Returns { source, runtimeMs, error?, packets, bytesObserved, r1Return, r2Return, attemptCount }
export async function runCombined({ r1Source, r2Source, testArgs, sessionStore, refuseConnackCount = 0, timeout = 15000 }) {
  if (!r1Source || !r2Source) {
    return {
      runtimeMs: 0,
      error: !r1Source ? 'no r1 source' : 'no r2 source',
      packets: [],
      bytesObserved: Buffer.alloc(0),
      r1Return: null,
      r2Return: null,
      attemptCount: 0,
    };
  }

  const cleanedR1 = preprocessSource(r1Source);
  const cleanedR2 = preprocessSource(r2Source);
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
      // === R1 source ===
      ${cleanedR1}
      if (typeof connectWithRetry !== 'function') {
        return { error: 'connectWithRetry not defined' };
      }
      // === R2 source ===
      ${cleanedR2}
      if (typeof restoreSubscriptions !== 'function') {
        return { error: 'restoreSubscriptions not defined' };
      }
      try {
        const r1Result = await Promise.race([
          connectWithRetry(testArgs),
          new Promise((_, rej) => setTimeout(() => rej(new Error('sandbox-timeout-r1-15000ms')), 15000)),
        ]);
        if (!r1Result || typeof r1Result.socket === 'undefined') {
          return { error: 'R1 did not return a conn object' };
        }
        const r2Result = await Promise.race([
          restoreSubscriptions({ conn: r1Result, sessionStore }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('sandbox-timeout-r2-15000ms')), 15000)),
        ]);
        return { ok: true, r1Result, r2Result };
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
      runtimeMs: Date.now() - start,
      error: 'compile-or-runtime: ' + (e.message || String(e)),
      packets: [],
      bytesObserved: Buffer.alloc(0),
      r1Return: null,
      r2Return: null,
      attemptCount: mockNet._attemptCount(),
    };
  }

  const bytesObserved = Buffer.concat(collector.flatMap((s) => s._writtenBytes));
  const packets = findPackets(bytesObserved);
  return {
    runtimeMs: Date.now() - start,
    error: result?.error || null,
    packets,
    bytesObserved,
    r1Return: result?.ok ? result.r1Result : null,
    r2Return: result?.ok ? result.r2Result : null,
    attemptCount: mockNet._attemptCount(),
  };
}
