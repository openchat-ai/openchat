import net from 'net';
import crypto from 'crypto';

const connections = new Map();

function encodeRemainingLen(length) {
  const buf = [];
  do {
    let byte = length % 128;
    length = Math.floor(length / 128);
    if (length > 0) byte |= 0x80;
    buf.push(byte);
  } while (length > 0);
  return Buffer.from(buf);
}

function decodeRemainingLen(data, offset) {
  let multiplier = 1;
  let value = 0;
  let pos = offset;
  let byte;
  do {
    byte = data[pos++];
    value += (byte & 127) * multiplier;
    multiplier *= 128;
  } while ((byte & 128) !== 0);
  return { value, bytes: pos - offset };
}

function parsePublish(data) {
  let pos = 1;
  const { value: remLen, bytes: rb } = decodeRemainingLen(data, pos);
  pos += rb;
  const topicLen = data.readUInt16BE(pos);
  pos += 2;
  const topic = data.slice(pos, pos + topicLen).toString('utf8');
  pos += topicLen;
  const payload = data.slice(pos, pos + remLen - (2 + topicLen));
  return { topic, payload };
}

export function connect(brokerUrl) {
  const [host, portStr] = brokerUrl.split(':');
  const port = parseInt(portStr, 10) || 1883;
  const connId = crypto.randomUUID().slice(0, 8);

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.on('connect', () => {
      const protocolName = Buffer.from('MQTT', 'utf8');
      const protocolLevel = 4;
      const connectFlags = 0x02;
      const keepAlive = Buffer.alloc(2);
      keepAlive.writeUInt16BE(60);

      const clientId = `bridge-${connId}`;
      const clientIdBuf = Buffer.from(clientId, 'utf8');
      const clientIdLen = Buffer.alloc(2);
      clientIdLen.writeUInt16BE(clientIdBuf.length);

      const variableHeader = Buffer.concat([protocolName, Buffer.from([protocolLevel, connectFlags]), keepAlive]);
      const payload = Buffer.concat([clientIdLen, clientIdBuf]);
      const remaining = Buffer.concat([variableHeader, payload]);
      const remLen = encodeRemainingLen(remaining.length);
      socket.write(Buffer.concat([Buffer.from([0x10, ...remLen]), remaining]));
    });

    socket.on('data', (data) => {
      const packetType = data[0] >> 4;
      if (packetType === 2 && !resolved) {
        resolved = true;
        const returnCode = data[3];
        if (returnCode === 0) {
          connections.set(connId, { socket, handlers: new Map(), lastMessage: null, host, port });
          resolve({ connId, sessionPresent: (data[2] & 0x01) !== 0 });
        } else {
          reject(new Error(`CONNACK refused, code: ${returnCode}`));
        }
      } else if (packetType === 3) {
        const { topic, payload: msgPayload } = parsePublish(data);
        const conn = connections.get(connId);
        if (conn) {
          conn.lastMessage = { topic, payload: msgPayload.toString('utf8') };
          for (const [, handler] of conn.handlers) {
            handler(topic, msgPayload);
          }
        }
      }
    });

    socket.on('error', (err) => {
      if (!resolved) reject(err);
    });

    socket.on('close', () => {
      connections.delete(connId);
    });

    socket.connect(port, host);
  });
}

export function subscribe(connId, topic, handler) {
  const conn = connections.get(connId);
  if (!conn) throw new Error(`Connection ${connId} not found`);

  conn.handlers.set(topic, handler);

  const packetId = Buffer.alloc(2);
  packetId.writeUInt16BE(1);
  const topicFilter = Buffer.from(topic, 'utf8');
  const topicLen = Buffer.alloc(2);
  topicLen.writeUInt16BE(topicFilter.length);
  const qos = Buffer.from([0]);
  const payload = Buffer.concat([topicLen, topicFilter, qos]);
  const remLen = encodeRemainingLen(payload.length + 2);
  conn.socket.write(Buffer.concat([Buffer.from([0x82, ...remLen]), packetId, payload]));
  return { connId, topic };
}

export function publish(connId, topic, payload) {
  const conn = connections.get(connId);
  if (!conn) throw new Error(`Connection ${connId} not found`);

  const payloadBuf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const topicBuf = Buffer.from(topic, 'utf8');
  const topicLen = Buffer.alloc(2);
  topicLen.writeUInt16BE(topicBuf.length);

  const remaining = Buffer.concat([topicLen, topicBuf, payloadBuf]);
  const remLen = encodeRemainingLen(remaining.length);
  conn.socket.write(Buffer.concat([Buffer.from([0x30, ...remLen]), remaining]));
  return { connId, topic, bytes: payloadBuf.length };
}

export function disconnect(connId) {
  const conn = connections.get(connId);
  if (!conn) throw new Error(`Connection ${connId} not found`);

  conn.socket.write(Buffer.from([0xE0, 0x00]));
  conn.socket.end();
  connections.delete(connId);
  return { connId, disconnected: true };
}

export function getConnections() {
  return Array.from(connections.keys());
}

export const TOOLS = [
  { type: 'function', function: { name: 'mqtt_connect', description: 'Connect to an MQTT broker at host:port', parameters: { type: 'object', properties: { brokerUrl: { type: 'string', description: 'host:port' } }, required: ['brokerUrl'] } } },
  { type: 'function', function: { name: 'mqtt_subscribe', description: 'Subscribe to an MQTT topic', parameters: { type: 'object', properties: { connId: { type: 'string' }, topic: { type: 'string' } }, required: ['connId', 'topic'] } } },
  { type: 'function', function: { name: 'mqtt_publish', description: 'Publish a message to an MQTT topic', parameters: { type: 'object', properties: { connId: { type: 'string' }, topic: { type: 'string' }, payload: { type: 'string' } }, required: ['connId', 'topic', 'payload'] } } },
  { type: 'function', function: { name: 'mqtt_disconnect', description: 'Disconnect from an MQTT broker', parameters: { type: 'object', properties: { connId: { type: 'string' } }, required: ['connId'] } } },
];

export async function executeTool(name, args) {
  switch (name) {
    case 'mqtt_connect': return connect(args.brokerUrl);
    case 'mqtt_subscribe': return subscribe(args.connId, args.topic, () => {});
    case 'mqtt_publish': return publish(args.connId, args.topic, args.payload);
    case 'mqtt_disconnect': return disconnect(args.connId);
    default: throw new Error(`Unknown mqtt tool: ${name}`);
  }
}
