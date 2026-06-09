import net from 'net';
import { create } from '../lib/report.mjs';

export const META = { id: 'mqtt-auto' };

// === MQTT 3.1.1 wire helpers ===

function wstr(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([u16(b.length), b]);
}

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v);
  return b;
}

function wrem(v) {
  const b = [];
  do {
    let d = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) d |= 0x80;
    b.push(d);
  } while (v > 0);
  return Buffer.from(b.length ? b : [0]);
}

function drem(buf, off) {
  let v = 0, m = 1, o = off;
  let byte;
  do {
    byte = buf[o++];
    v += (byte & 0x7F) * m;
    m *= 0x80;
    if (o - off > 4) return { value: -1, consumed: 0 };
  } while (byte & 0x80);
  return { value: v, consumed: o - off };
}

// === session management ===

let nextConnId = 1;
const sessions = new Map();

class Session {
  constructor(socket, keepAlive, onClose, initialBuf) {
    this.socket = socket;
    this.keepAlive = keepAlive;
    this.onClose = onClose;
    this.connId = nextConnId++;
    this._buf = initialBuf || Buffer.alloc(0);
    this._q = [];
    this.alive = true;

    const onData = (d) => {
      this._buf = Buffer.concat([this._buf, d]);
      this._drain();
    };
    socket.on('data', onData);
    socket.on('close', () => {
      this.alive = false;
      this._flush(new Error('connection closed'));
      if (typeof this.onClose === 'function') this.onClose();
    });
    socket.on('error', () => {
      this.alive = false;
      this._flush(new Error('socket error'));
    });
  }

  _drain() {
    while (this._buf.length >= 2 && this._q.length > 0) {
      const type = this._buf[0] >> 4;
      const r = drem(this._buf, 1);
      if (r.value < 0) { this._flush(new Error('malformed remaining length')); return; }
      const total = 1 + r.consumed + r.value;
      if (this._buf.length < total) return;
      const pkt = this._buf.subarray(0, total);
      this._buf = this._buf.subarray(total);
      const p = this._q.shift();
      if (p) {
        if (p.type === type || p.type === -1) p.resolve(pkt);
        else p.reject(new Error(`expect type ${p.type}, got ${type}`));
      }
    }
  }

  _flush(err) {
    for (const p of this._q) p.reject(err);
    this._q = [];
    this._buf = Buffer.alloc(0);
  }

  wait(type, ms = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.alive) return reject(new Error('session not alive'));
      const entry = { type, resolve, reject };
      this._q.push(entry);
      if (ms > 0) {
        setTimeout(() => {
          const i = this._q.indexOf(entry);
          if (i >= 0) { this._q.splice(i, 1); reject(new Error('wait timeout')); }
        }, ms);
      }
    });
  }
}

// === exported functions ===

export async function mqttConnect(host, port, clientId, opts = {}) {
  const keepAlive = opts.keepAlive || 60;
  return new Promise((resolve, reject) => {
    let dead = false;
    const die = (err) => { if (!dead) { dead = true; reject(err); } };
    const timer = setTimeout(() => die(new Error('connect timeout')), opts.timeout || 10000);

    const sock = new net.Socket()
      .on('error', die)
      .connect(port, host, () => {
        if (dead) return;
        const cidBuf = Buffer.from(clientId, 'utf8');
        const payload = Buffer.concat([u16(cidBuf.length), cidBuf]);
        const vh = Buffer.concat([wstr('MQTT'), Buffer.from([4, 0x02]), u16(keepAlive)]);
        const remaining = vh.length + payload.length;

        sock.write(Buffer.concat([
          Buffer.from([0x10]), wrem(remaining), vh, payload,
        ]));

        let buf = Buffer.alloc(0);
        const onData = (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          if (buf.length < 4) return;
          const rl = drem(buf, 1);
          if (rl.value < 0 || buf.length < 1 + rl.consumed + rl.value) return;
          const connackEnd = 1 + rl.consumed + rl.value;
          const connack = buf.subarray(0, connackEnd);
          const leftover = buf.subarray(connackEnd);
          buf = Buffer.alloc(0);
          sock.removeListener('data', onData);

          const rc = connack[3];
          if (rc !== 0) {
            sock.end();
            die(new Error(`CONNACK refused: code=${rc}`));
            return;
          }

          clearTimeout(timer);
          const sess = new Session(sock, keepAlive, () => sessions.delete(sess.connId), leftover);
          sessions.set(sess.connId, sess);

          resolve({
            connId: sess.connId,
            returnCode: rc,
            sessionPresent: !!(connack[2]),
            subscribe: (topic, qos = 0) => mqttSubscribe(sess, topic, qos),
            publish: (topic, payload, qos = 0) => mqttPublish(sess, topic, payload, qos),
            pingreq: () => mqttPingreq(sess),
            disconnect: () => mqttDisconnect(sess),
          });
        };
        sock.on('data', onData);
      });
  });
}

export async function mqttSubscribe(session, topic, qos = 0) {
  if (!session || !session.alive) throw new Error('session not alive');
  const pktId = 1;
  const payload = Buffer.concat([wstr(topic), Buffer.from([qos])]);
  const remaining = 2 + payload.length;

  session.socket.write(Buffer.concat([
    Buffer.from([0x82]), wrem(remaining), u16(pktId), payload,
  ]));

  const pkt = await session.wait(9);
  const rl = drem(pkt, 1);
  const rcStart = 1 + rl.consumed + 2;
  const codes = [];
  for (let i = rcStart; i < pkt.length; i++) codes.push(pkt[i]);
  return { packetId: pktId, returnCodes: codes };
}

export async function mqttPublish(session, topic, payload, qos = 0) {
  if (!session || !session.alive) throw new Error('session not alive');
  const topicEnc = wstr(topic);
  const msg = Buffer.from(payload, 'utf8');
  let vh = topicEnc;
  let pktId = null;

  if (qos > 0) {
    pktId = 1;
    vh = Buffer.concat([topicEnc, u16(pktId)]);
  }

  const remaining = vh.length + msg.length;
  const fixedHeader = Buffer.from([0x30 | (qos << 1)]);

  session.socket.write(Buffer.concat([fixedHeader, wrem(remaining), vh, msg]));

  if (qos === 1) {
    await session.wait(4);
  }
  return { packetId: pktId };
}

export async function mqttPingreq(session) {
  if (!session || !session.alive) throw new Error('session not alive');
  session.socket.write(Buffer.from([0xC0, 0x00]));
  await session.wait(13);
  return true;
}

export async function mqttDisconnect(session) {
  if (!session || !session.alive) return;
  session.socket.write(Buffer.from([0xE0, 0x00]));
  session.socket.end();
  sessions.delete(session.connId);
}

// === compose interface ===

export async function run({ inputs = {} } = {}) {
  const { op, ...params } = inputs;
  switch (op) {
    case 'connect': {
      const { host = 'localhost', port = 1883, clientId, keepAlive = 60, timeout = 10000 } = params;
      if (!clientId) throw new Error('mqtt-auto.run: clientId required');
      const r = await mqttConnect(host, port, clientId, { keepAlive, timeout });
      return { outputs: { connId: r.connId, returnCode: r.returnCode, sessionPresent: r.sessionPresent } };
    }
    case 'subscribe': {
      const { connId, topic, qos = 0 } = params;
      const s = sessions.get(connId);
      if (!s) throw new Error(`mqtt-auto: unknown connId ${connId}`);
      const r = await mqttSubscribe(s, topic, qos);
      return { outputs: { packetId: r.packetId, returnCodes: r.returnCodes, ok: true } };
    }
    case 'publish': {
      const { connId, topic, payload, qos = 0 } = params;
      const s = sessions.get(connId);
      if (!s) throw new Error(`mqtt-auto: unknown connId ${connId}`);
      await mqttPublish(s, topic, payload, qos);
      return { outputs: { ok: true } };
    }
    case 'disconnect': {
      const { connId } = params;
      const s = sessions.get(connId);
      if (s) await mqttDisconnect(s);
      return { outputs: { ok: true } };
    }
    case 'list':
      return { outputs: { sessions: [...sessions.keys()] } };
    default:
      throw new Error(`mqtt-auto: unknown op "${op}"`);
  }
}

// === mock broker for testing ===

export function createMockBroker(opts = {}) {
  const published = [];
  const subscriptions = [];
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);

    function send(pkt) { socket.write(pkt); }

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const type = buf[0] >> 4;
        const r = drem(buf, 1);
        if (r.value < 0 || buf.length < 1 + r.consumed + r.value) return;
        const pkt = buf.subarray(0, 1 + r.consumed + r.value);
        buf = buf.subarray(1 + r.consumed + r.value);

        switch (type) {
          case 1: {
            // Track connect attempts server-wide (for refuseConnackCount)
            server.attemptCount = (server.attemptCount || 0) + 1;
            let rc;
            if (opts.refuseConnackCount !== undefined) {
              // Retry mode: refuse first N attempts, accept after
              const shouldRefuse = server.attemptCount <= opts.refuseConnackCount;
              rc = shouldRefuse
                ? (opts.refuseConnack !== undefined ? opts.refuseConnack : 5)
                : 0;
            } else {
              // Legacy: refuse always if refuseConnack is set, else accept
              rc = (opts.refuseConnack !== undefined) ? opts.refuseConnack : 0;
            }
            send(Buffer.from([0x20, 0x02, 0x00, rc]));
            if (rc !== 0) { socket.end(); return; }
            break;
          }
          case 8: {
            const pktId = pkt.readUInt16BE(1 + r.consumed);
            send(Buffer.concat([
              Buffer.from([0x90]), wrem(3), u16(pktId), Buffer.from([0x00]),
            ]));

            const tOff = 1 + r.consumed + 2;
            const tLen = pkt.readUInt16BE(tOff);
            const topic = pkt.subarray(tOff + 2, tOff + 2 + tLen).toString('utf8');
            const qos = pkt[tOff + 2 + tLen];
            subscriptions.push({ topic, qos });
            break;
          }
          case 3: {
            const tl = drem(pkt, 1);
            let off = 1 + tl.consumed;
            const topicLen = pkt.readUInt16BE(off);
            off += 2;
            const topic = pkt.subarray(off, off + topicLen).toString('utf8');
            off += topicLen;
            const qos = (pkt[0] & 0x06) >> 1;
            let pktId = null;
            if (qos > 0) { pktId = pkt.readUInt16BE(off); off += 2; }
            const msg = pkt.subarray(off).toString('utf8');

            published.push({ topic, message: msg, qos });

            if (qos === 1) {
              send(Buffer.concat([Buffer.from([0x40]), wrem(2), u16(pktId)]));
            }
            break;
          }
          case 12:
            send(Buffer.from([0xD0, 0x00]));
            break;
          case 14:
            socket.end();
            break;
        }
      }
    });

    socket.on('error', () => {});
  });

  server.published = published;
  server.subscriptions = subscriptions;
  server.attemptCount = 0;  // exposed for refuseConnackCount / retry testing
  return server;
}

// === test ===

export async function test() {
  const { ok, ng, skip, report } = create();
  const NAME = 'MQTT-Auto';

  const broker = createMockBroker();
  await new Promise((r) => broker.listen(0, '127.0.0.1', r));
  const port = broker.address().port;

  try {
    // 1. connect
    try {
      const c = await mqttConnect('127.0.0.1', port, 'test-client-1');
      ok(`connect: CONNACK ok (rc=${c.returnCode})`);

      // 2. subscribe
      try {
        const sr = await c.subscribe('test/topic', 0);
        if (sr.returnCodes[0] === 0) ok('subscribe: SUBACK accepted');
        else ng(`subscribe: returnCode=${sr.returnCodes[0]}`);
      } catch (e) { ng('subscribe', e); }

      // 3. publish QoS 0
      try {
        await c.publish('test/topic', 'hello from mqtt-auto', 0);
        ok('publish QoS0: completed');
      } catch (e) { ng('publish QoS0', e); }

      // 4. publish QoS 1
      try {
        await c.publish('test/topic', 'qos1 message', 1);
        ok('publish QoS1: completed');
      } catch (e) { ng('publish QoS1', e); }

      // 5. pingreq
      try {
        await c.pingreq();
        ok('pingreq: PINGRESP received');
      } catch (e) { ng('pingreq', e); }

      // 6. disconnect
      try {
        await c.disconnect();
        ok('disconnect: completed');
      } catch (e) { ng('disconnect', e); }

      // 7. reconnect
      try {
        const c2 = await mqttConnect('127.0.0.1', port, 'test-client-re');
        ok('reconnect: successful');
        await c2.disconnect();
      } catch (e) { ng('reconnect', e); }

    } catch (e) { ng('connect phase', e); }

    // 8. CONNACK refused
    const refBroker = createMockBroker({ refuseConnack: 5 });
    await new Promise((r) => refBroker.listen(0, '127.0.0.1', r));
    const refPort = refBroker.address().port;
    try {
      await mqttConnect('127.0.0.1', refPort, 'refused-client', { timeout: 2000 });
      ng('CONNACK refused should throw');
    } catch (e) {
      if (e.message.includes('CONNACK refused')) ok('CONNACK refused: ' + e.message.substring(0, 35));
      else ng('refused error format: ' + e.message.substring(0, 30));
    }
    refBroker.close();

    // 8b. CONNACK refused N times then accept (retry path)
    //     49-mqtt-resume uses this to test LLM retry logic
    const retryBroker = createMockBroker({ refuseConnackCount: 2, refuseConnack: 5 });
    await new Promise((r) => retryBroker.listen(0, '127.0.0.1', r));
    const retryPort = retryBroker.address().port;
    try {
      // First two attempts should fail
      for (let i = 1; i <= 2; i++) {
        try {
          await mqttConnect('127.0.0.1', retryPort, 'retry-' + i, { timeout: 2000 });
          ng(`retry attempt ${i} should throw`);
          break;
        } catch (e) {
          if (e.message.includes('CONNACK refused')) ok(`retry attempt ${i}: refused (attemptCount=${retryBroker.attemptCount})`);
          else ng(`retry attempt ${i}: bad error: ${e.message.substring(0, 30)}`);
        }
      }
      // Third attempt should succeed
      try {
        const c3 = await mqttConnect('127.0.0.1', retryPort, 'retry-3', { timeout: 2000 });
        ok(`retry attempt 3: succeeded (attemptCount=${retryBroker.attemptCount})`);
        if (retryBroker.attemptCount !== 3) ng(`expected attemptCount=3, got ${retryBroker.attemptCount}`);
        await c3.disconnect();
      } catch (e) { ng('retry attempt 3: ' + e.message.substring(0, 30)); }
    } finally {
      retryBroker.close();
    }

    // 9. unknown connId (dead session)
    try {
      await mqttSubscribe({ alive: false }, 't', 0);
      ng('dead session should throw');
    } catch (e) { ok('dead session: ' + e.message.substring(0, 25)); }

    // 10. unreachable host
    try {
      await mqttConnect('127.0.0.1', 1, 'test-unreach', { timeout: 2000 });
      ng('unreachable should throw');
    } catch (e) { ok('unreachable: ' + e.message.substring(0, 30)); }

    // 11. empty handler protection (onClose undefined)
    const dummySock = new net.Socket();
    const sess = new Session(dummySock, 60, null, null);
    if (!sess.alive) ng('session should be alive');
    else ok('empty onClose handler: no crash');
    dummySock.destroy();

  } finally {
    broker.close();
  }

  report(NAME);
}
