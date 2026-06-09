// src/experiments/lib/mqtt-render-tools.mjs
//
// Pure byte-rendering functions for MQTT 3.1.1 wire format.
// LLM-callable: weak model doesn't have to compute packet bytes manually.
// Used by 49-mqtt-resume as global functions injected into the sandbox.
//
// Contract:
//   - renderConnect / renderSubscribe are SYNC, return { bytes: Buffer, type, length }
//   - LLM is told in the prompt to use `await` for both calls (await on a non-Promise
//     just returns the value, so this is safe and matches LLM expectations)
//   - All input validation throws synchronously with descriptive messages
//   - Re-exports wstr/u16/wrem/drem so downstream experiments don't need to import
//     from 33-mqtt-auto (which is a "deeper" experiment with its own concerns)
//
// Byte layouts (MQTT 3.1.1 §3.1 / §3.8):
//   CONNECT:    [0x10] [remLen] [wstr(protoName)] [protoLevel] [connectFlags] [u16(keepAlive)] [wstr(clientId)]
//   SUBSCRIBE:  [0x82] [remLen] [u16(packetId)] [wstr(topic) qos, ...]
//
// Usage from 49-mqtt-resume/sandbox.mjs:
//   import { renderConnect, renderSubscribe } from '../lib/mqtt-render-tools.mjs';
//   fn(mockNet, renderConnect, renderSubscribe, { testArgs, sessionStore });

// === Wire format helpers (pure, no I/O) ===

export function wstr(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([u16(b.length), b]);
}

export function u16(v) {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff) {
    throw new Error(`u16: value must be 0-65535, got ${v}`);
  }
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v);
  return b;
}

export function wrem(v) {
  if (!Number.isInteger(v) || v < 0) {
    throw new Error(`wrem: value must be non-negative integer, got ${v}`);
  }
  const b = [];
  do {
    let d = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) d |= 0x80;
    b.push(d);
  } while (v > 0);
  return Buffer.from(b.length ? b : [0]);
}

export function drem(buf, off) {
  let v = 0, m = 1, o = off;
  let byte;
  do {
    if (o >= buf.length) return { value: -1, consumed: 0 };
    byte = buf[o++];
    v += (byte & 0x7F) * m;
    m *= 0x80;
    if (o - off > 4) return { value: -1, consumed: 0 };
  } while (byte & 0x80);
  return { value: v, consumed: o - off };
}

// === LLM-callable render tools ===

/**
 * Render an MQTT 3.1.1 CONNECT packet.
 * @param {Object} args
 * @param {string} args.protoName   - Protocol name, "MQTT" for 3.1.1
 * @param {number} args.protoLevel  - Protocol level, 4 for MQTT 3.1.1
 * @param {number} args.connectFlags - Connect flags byte 0-255 (e.g. 0x02 = cleanSession)
 * @param {number} args.keepAlive   - Keep-alive interval in seconds
 * @param {string} args.clientId    - Client identifier
 * @returns {{ bytes: Buffer, type: string, length: number }}
 */
export function renderConnect({ protoName, protoLevel, connectFlags, keepAlive, clientId }) {
  if (typeof protoName !== 'string') throw new Error('renderConnect: protoName must be string');
  if (typeof protoLevel !== 'number' || !Number.isInteger(protoLevel) || protoLevel < 0 || protoLevel > 255) {
    throw new Error('renderConnect: protoLevel must be 0-255');
  }
  if (typeof connectFlags !== 'number' || !Number.isInteger(connectFlags) || connectFlags < 0 || connectFlags > 255) {
    throw new Error('renderConnect: connectFlags must be 0-255');
  }
  if (typeof keepAlive !== 'number' || !Number.isInteger(keepAlive) || keepAlive < 0 || keepAlive > 65535) {
    throw new Error('renderConnect: keepAlive must be 0-65535');
  }
  if (typeof clientId !== 'string') throw new Error('renderConnect: clientId must be string');

  const vh = Buffer.concat([
    wstr(protoName),
    Buffer.from([protoLevel, connectFlags]),
    u16(keepAlive),
  ]);
  const payload = wstr(clientId);
  const remaining = vh.length + payload.length;
  const remLen = wrem(remaining);
  return {
    bytes: Buffer.concat([Buffer.from([0x10]), remLen, vh, payload]),
    type: 'CONNECT',
    length: 1 + remLen.length + remaining,
  };
}

/**
 * Render an MQTT 3.1.1 SUBSCRIBE packet.
 * @param {Object} args
 * @param {number} args.packetId - Packet identifier 1-65535
 * @param {Array<{topic: string, qos: number}>} args.subscriptions
 * @returns {{ bytes: Buffer, type: string, length: number }}
 */
export function renderSubscribe({ packetId, subscriptions }) {
  if (typeof packetId !== 'number' || !Number.isInteger(packetId) || packetId < 1 || packetId > 65535) {
    throw new Error('renderSubscribe: packetId must be 1-65535');
  }
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    throw new Error('renderSubscribe: subscriptions must be non-empty array');
  }
  for (let i = 0; i < subscriptions.length; i++) {
    const s = subscriptions[i];
    if (!s || typeof s.topic !== 'string') {
      throw new Error(`renderSubscribe: subscriptions[${i}].topic must be string`);
    }
    if (typeof s.qos !== 'number' || ![0, 1, 2].includes(s.qos)) {
      throw new Error(`renderSubscribe: subscriptions[${i}].qos must be 0, 1, or 2`);
    }
  }

  const payload = Buffer.concat(
    subscriptions.flatMap((s) => [wstr(s.topic), Buffer.from([s.qos])])
  );
  const vh = u16(packetId);
  const remaining = vh.length + payload.length;
  const remLen = wrem(remaining);
  return {
    bytes: Buffer.concat([Buffer.from([0x82]), remLen, vh, payload]),
    type: 'SUBSCRIBE',
    length: 1 + remLen.length + remaining,
  };
}
