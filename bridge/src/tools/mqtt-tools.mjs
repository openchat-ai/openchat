import crypto from 'crypto';
import { mqttConnect as _connect } from '../experiments/33-mqtt-auto/index.mjs';

const sessions = new Map();

export async function mqttConnect(host, port = 1883, clientId, opts = {}) {
  const cid = clientId || `bridge-${crypto.randomUUID().slice(0, 8)}`;
  const result = await _connect(host, port, cid, opts);
  sessions.set(result.connId, result);
  return { connId: result.connId, returnCode: result.returnCode, sessionPresent: result.sessionPresent };
}

export async function mqttSubscribe(connId, topic, qos = 0) {
  const sess = sessions.get(connId);
  if (!sess) throw new Error(`MQTT connection ${connId} not found`);
  const result = await sess.subscribe(topic, qos);
  return { packetId: result.packetId, returnCodes: result.returnCodes };
}

export async function mqttPublish(connId, topic, payload, qos = 0) {
  const sess = sessions.get(connId);
  if (!sess) throw new Error(`MQTT connection ${connId} not found`);
  const result = await sess.publish(topic, payload, qos);
  return { packetId: result.packetId, ok: true };
}

export async function mqttDisconnect(connId) {
  const sess = sessions.get(connId);
  if (!sess) return { connId, ok: true };
  await sess.disconnect();
  sessions.delete(connId);
  return { connId, ok: true };
}

export const TOOLS = [
  { type: 'function', function: { name: 'mqtt_connect', description: 'Connect to an MQTT broker', parameters: { type: 'object', properties: { host: { type: 'string', description: 'Broker hostname or IP' }, port: { type: 'number', description: 'Broker port (default 1883)' }, clientId: { type: 'string', description: 'Client identifier (auto-generated if omitted)' }, keepAlive: { type: 'number', description: 'Keep alive seconds (default 60)' }, timeout: { type: 'number', description: 'Connection timeout ms (default 10000)' } }, required: ['host'] } } },
  { type: 'function', function: { name: 'mqtt_subscribe', description: 'Subscribe to an MQTT topic filter. Waits for SUBACK from broker.', parameters: { type: 'object', properties: { connId: { type: 'number', description: 'Connection ID from mqtt_connect' }, topic: { type: 'string', description: 'Topic filter (e.g. test/#)' }, qos: { type: 'number', description: 'QoS level 0 or 1 (default 0)' } }, required: ['connId', 'topic'] } } },
  { type: 'function', function: { name: 'mqtt_publish', description: 'Publish a message to an MQTT topic. For QoS 1, waits for PUBACK.', parameters: { type: 'object', properties: { connId: { type: 'number', description: 'Connection ID from mqtt_connect' }, topic: { type: 'string', description: 'Topic name' }, payload: { type: 'string', description: 'Message payload (UTF-8 string)' }, qos: { type: 'number', description: 'QoS level 0 or 1 (default 0)' } }, required: ['connId', 'topic', 'payload'] } } },
  { type: 'function', function: { name: 'mqtt_disconnect', description: 'Disconnect from an MQTT broker cleanly', parameters: { type: 'object', properties: { connId: { type: 'number', description: 'Connection ID from mqtt_connect' } }, required: ['connId'] } } },
];

export async function executeTool(name, args) {
  switch (name) {
    case 'mqtt_connect': return mqttConnect(args.host, args.port, args.clientId, { keepAlive: args.keepAlive, timeout: args.timeout });
    case 'mqtt_subscribe': return mqttSubscribe(args.connId, args.topic, args.qos);
    case 'mqtt_publish': return mqttPublish(args.connId, args.topic, args.payload, args.qos);
    case 'mqtt_disconnect': return mqttDisconnect(args.connId);
    default: throw new Error(`Unknown mqtt tool: ${name}`);
  }
}
