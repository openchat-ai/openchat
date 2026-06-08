// tools.mjs — E39 的 renderConnect / renderSubscribe 工具
//
// 注意: tool schema 不用 {json: ...} 包装, LLM 自然调用形式是 renderConnect({protoName, ...})
// (E38 用包装形式, 但 E39 LLM 3/3 都用直传, 跟 schema 对齐以减少出错)

import { render } from './renderer.mjs';

const TOOL_TYPE = {
  renderConnect: 'CONNECT',
  renderSubscribe: 'SUBSCRIBE',
};

function withType(toolName, json) {
  if (!json || typeof json !== 'object') return { type: TOOL_TYPE[toolName] };
  return { type: TOOL_TYPE[toolName], ...json };
}

// executor 接受 args, 把 args 本身当 json (无 json 包装)
function renderConnectExec(args) {
  return { bytes: Array.from(render(withType('renderConnect', args || {}))) };
}

function renderSubscribeExec(args) {
  return { bytes: Array.from(render(withType('renderSubscribe', args || {}))) };
}

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'renderConnect',
      description: 'Render an MQTT 3.1.1 CONNECT packet. Returns the bytes for the CONNECT packet. Use this when implementing the first step of an MQTT client. Pass these fields directly: protoName (default "MQTT"), protoLevel (4 for 3.1.1), connectFlags (object with cleanSession bool), keepAlive (seconds), clientId (string).',
      parameters: {
        type: 'object',
        description: 'CONNECT packet fields — pass directly, no wrapper',
        properties: {
          protoName: { type: 'string' },
          protoLevel: { type: 'number' },
          connectFlags: {
            type: 'object',
            properties: { cleanSession: { type: 'boolean' } },
          },
          keepAlive: { type: 'number' },
          clientId: { type: 'string' },
        },
        required: ['clientId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'renderSubscribe',
      description: 'Render an MQTT 3.1.1 SUBSCRIBE packet. Returns the bytes for the SUBSCRIBE packet. Use this after sending CONNECT (and receiving CONNACK) to subscribe to a topic. Pass these fields directly: packetId (integer, e.g. 1) and subscriptions (array of {topic, qos} objects).',
      parameters: {
        type: 'object',
        description: 'SUBSCRIBE packet fields — pass directly, no wrapper',
        properties: {
          packetId: { type: 'number' },
          subscriptions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                topic: { type: 'string' },
                qos: { type: 'number' },
              },
              required: ['topic', 'qos'],
            },
          },
        },
        required: ['packetId', 'subscriptions'],
      },
    },
  },
];

export const TOOL_EXECUTORS = {
  renderConnect: renderConnectExec,
  renderSubscribe: renderSubscribeExec,
};

export const TOOL_NAMES = TOOLS.map((t) => t.function.name);

// === Mock net.Socket (for sandboxed execution) ===
export function createMockSocket() {
  const written = [];
  return {
    written,
    writtenBytes() { return written.flatMap((w) => w.bytes); },
    write(data, encoding) {
      if (Buffer.isBuffer(data)) {
        written.push({ bytes: Array.from(data), encoding: encoding || 'utf8' });
      } else if (typeof data === 'string') {
        written.push({ bytes: Array.from(Buffer.from(data, encoding || 'utf8')), encoding: encoding || 'utf8' });
      } else if (Array.isArray(data)) {
        written.push({ bytes: data, encoding: 'array' });
      }
    },
    on() { return this; },
    once() { return this; },
    emit() { return true; },
    end() {},
    destroy() {},
    setTimeout() { return this; },
  };
}
