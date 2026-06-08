// renderer.mjs — 把 MQTT JSON 模板渲染成 Buffer
//
// 支持: CONNECT, PUBLISH, SUBSCRIBE, PINGREQ
// 不支持: PUBACK, SUBACK, UNSUBSCRIBE (这些是 server→client 响应, 模型不会生成)

function wstr(s) {
  // 写入 UTF-8 字符串 + 2 字节长度前缀 (大端)
  const b = Buffer.from(String(s), 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length, 0);
  return Buffer.concat([len, b]);
}

function wrem(v) {
  // 变长 remaining length 编码 (MQTT 3.1.1 spec)
  const bytes = [];
  do {
    let d = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) d |= 0x80;
    bytes.push(d);
  } while (v > 0);
  return Buffer.from(bytes);
}

// 计算剩余长度
function encRemaining(payload) {
  return wrem(payload.length);
}

function packetTypeByte(type, flags = 0) {
  // type 是 1-14 (左移 4 位), flags 是 0-15
  return ((type & 0x0F) << 4) | (flags & 0x0F);
}

// 渲染 CONNECT
function renderConnect(j) {
  if (j.type !== 'CONNECT') throw new Error(`expected CONNECT, got ${j.type}`);
  const protoName = j.protoName || 'MQTT';
  const protoLevel = j.protoLevel ?? 4;
  const flags = j.connectFlags || {};
  const keepAlive = j.keepAlive ?? 60;
  const clientId = j.clientId ?? '';

  // connect flags byte
  let cf = 0;
  if (flags.cleanSession) cf |= 0x02;
  if (flags.willFlag) cf |= 0x04;
  if (flags.userName) cf |= 0x80;
  if (flags.password) cf |= 0x40;
  if (flags.willRetain) cf |= 0x20;
  if (typeof flags.willQos === 'number') cf |= (flags.willQos & 0x03) << 3;

  // variable header
  const vh = Buffer.concat([
    wstr(protoName),
    Buffer.from([protoLevel, cf]),
    (() => {
      const k = Buffer.alloc(2);
      k.writeUInt16BE(keepAlive, 0);
      return k;
    })(),
  ]);
  // payload: clientId (and optionally will, username, password)
  let payloadParts = [wstr(clientId)];
  if (flags.willFlag) {
    payloadParts.push(wstr(flags.willTopic || ''));
    payloadParts.push(wstr(flags.willMessage || ''));
  }
  if (flags.userName) payloadParts.push(wstr(flags.userName || ''));
  if (flags.password) payloadParts.push(wstr(flags.password || ''));
  const payload = Buffer.concat(payloadParts);

  const remaining = Buffer.concat([vh, payload]);
  return Buffer.concat([Buffer.from([packetTypeByte(1, 0)]), wrem(remaining.length), remaining]);
}

// 渲染 PUBLISH
function renderPublish(j) {
  if (j.type !== 'PUBLISH') throw new Error(`expected PUBLISH, got ${j.type}`);
  const f = j.flags || {};
  const qos = f.qos ?? 0;
  const retain = f.retain ? 1 : 0;
  const dup = f.dup ? 1 : 0;
  const flagsByte = (qos << 1) | (retain << 0) | (dup << 3);  // 0x30 + flags
  const topic = j.topic || '';
  const payload = j.payload || '';
  const topicBuf = wstr(topic);
  const payloadBuf = Buffer.from(String(payload), 'utf8');
  let pktIdBuf = Buffer.alloc(0);
  if (qos > 0 && typeof j.packetId === 'number') {
    pktIdBuf = Buffer.alloc(2);
    pktIdBuf.writeUInt16BE(j.packetId, 0);
  }
  const remaining = Buffer.concat([topicBuf, pktIdBuf, payloadBuf]);
  return Buffer.concat([Buffer.from([0x30 | flagsByte]), wrem(remaining.length), remaining]);
}

// 渲染 SUBSCRIBE
function renderSubscribe(j) {
  if (j.type !== 'SUBSCRIBE') throw new Error(`expected SUBSCRIBE, got ${j.type}`);
  const packetId = j.packetId ?? 1;
  const subs = j.subscriptions || [];
  if (subs.length === 0) throw new Error('SUBSCRIBE requires subscriptions[]');

  const pktIdBuf = Buffer.alloc(2);
  pktIdBuf.writeUInt16BE(packetId, 0);

  const subParts = subs.map((s) => Buffer.concat([wstr(s.topic || ''), Buffer.from([s.qos ?? 0])]));
  const payload = Buffer.concat(subParts);

  const remaining = Buffer.concat([pktIdBuf, payload]);
  // SUBSCRIBE 固定头: 0x82 (type=8, flags=2)
  return Buffer.concat([Buffer.from([0x82]), wrem(remaining.length), remaining]);
}

// 渲染 PINGREQ
function renderPingreq(j) {
  if (j.type !== 'PINGREQ') throw new Error(`expected PINGREQ, got ${j.type}`);
  return Buffer.from([0xC0, 0x00]);
}

const RENDERERS = {
  CONNECT: renderConnect,
  PUBLISH: renderPublish,
  SUBSCRIBE: renderSubscribe,
  PINGREQ: renderPingreq,
};

export function render(json) {
  const renderer = RENDERERS[json.type];
  if (!renderer) throw new Error(`unsupported packet type: ${json.type}`);
  return renderer(json);
}

// === scoring (跟 E36 复用) ===

export function scoreBytes(actual, expected) {
  if (!actual || actual.length === 0) {
    return {
      extracted: false, exactMatch: 0, lengthMatch: 0,
      firstByteMatch: 0, byteAccuracy: 0,
      actualLength: 0, expectedLength: expected.length,
    };
  }
  const firstByteMatch = actual[0] === expected[0] ? 1 : 0;
  const lengthMatch = actual.length === expected.length ? 1 : 0;
  const minLen = Math.min(actual.length, expected.length);
  let correct = 0;
  for (let i = 0; i < minLen; i++) {
    if (actual[i] === expected[i]) correct++;
  }
  const byteAccuracy = expected.length > 0 ? correct / expected.length : 0;
  const exactMatch = lengthMatch && byteAccuracy === 1 ? 1 : 0;
  return { extracted: true, exactMatch, lengthMatch, firstByteMatch, byteAccuracy,
           actualLength: actual.length, expectedLength: expected.length };
}

export function aggregateScores(scores) {
  if (scores.length === 0) return null;
  const acc = { exactMatch: 0, lengthMatch: 0, firstByteMatch: 0, byteAccuracy: 0, extracted: 0 };
  for (const s of scores) {
    acc.exactMatch += s.exactMatch;
    acc.lengthMatch += s.lengthMatch;
    acc.firstByteMatch += s.firstByteMatch;
    acc.byteAccuracy += s.byteAccuracy;
    acc.extracted += s.extracted ? 1 : 0;
  }
  const n = scores.length;
  return {
    n,
    exactMatch: acc.exactMatch / n,
    lengthMatch: acc.lengthMatch / n,
    firstByteMatch: acc.firstByteMatch / n,
    byteAccuracy: acc.byteAccuracy / n,
    extracted: acc.extracted / n,
  };
}
