// tools.mjs — E38 的 4 个 render* 工具定义
//
// 4 个工具, 一个 packet type 一个:
//   - renderConnect   → CONNECT packet bytes
//   - renderPublish   → PUBLISH packet bytes
//   - renderSubscribe → SUBSCRIBE packet bytes
//   - renderPingreq   → PINGREQ packet bytes
//
// 每个工具接 json 参数, 内部调 renderer.mjs 的 render() 函数
//
// 跟 E37 的核心区别:
//   - E37: LLM 在聊天里写 JSON 文本, 我们抽取 + 渲染
//   - E38: LLM 调 tool, json 是 tool call 的 argument, 100% 结构化

import { render } from './renderer.mjs';

// Tool name → packet type. Executor auto-fills type so LLM 不用重复写
const TOOL_TYPE = {
  renderConnect: 'CONNECT',
  renderPublish: 'PUBLISH',
  renderSubscribe: 'SUBSCRIBE',
  renderPingreq: 'PINGREQ',
};

function withType(toolName, json) {
  // LLM 调 tool 时 type 跟 tool name 重复, 经常忘. executor 帮填.
  if (!json || typeof json !== 'object') return { type: TOOL_TYPE[toolName] };
  return { type: TOOL_TYPE[toolName], ...json };
}

function renderConnectExec(args) {
  return { bytes: Array.from(render(withType('renderConnect', args.json))) };
}

function renderPublishExec(args) {
  return { bytes: Array.from(render(withType('renderPublish', args.json))) };
}

function renderSubscribeExec(args) {
  return { bytes: Array.from(render(withType('renderSubscribe', args.json))) };
}

function renderPingreqExec(args) {
  return { bytes: Array.from(render(withType('renderPingreq', args.json))) };
}

// === OpenAI 兼容的 tool schema ===
// 每个工具的 description 包含"何时用"+ "字段说明", 让 LLM 知道怎么填

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'renderConnect',
      description: 'Render an MQTT 3.1.1 CONNECT packet. Use this when the user asks to "connect" to a broker. The json argument should have: protoName (default "MQTT"), protoLevel (4 for 3.1.1), connectFlags (object with cleanSession/willFlag/willQos/willRetain/userName/password), keepAlive (seconds, integer), clientId (string), and optionally willTopic/willMessage when willFlag is true.',
      parameters: {
        type: 'object',
        properties: {
          json: {
            type: 'object',
            description: 'CONNECT packet fields',
            properties: {
              type: { type: 'string', enum: ['CONNECT'] },
              protoName: { type: 'string', description: 'Protocol name, always "MQTT"' },
              protoLevel: { type: 'number', description: 'Protocol level, 4 for MQTT 3.1.1' },
              connectFlags: {
                type: 'object',
                description: 'Connect flags: cleanSession, willFlag, willQos, willRetain, userName, password',
                properties: {
                  cleanSession: { type: 'boolean' },
                  willFlag: { type: 'boolean' },
                  willQos: { type: 'number' },
                  willRetain: { type: 'boolean' },
                  userName: { type: 'string' },
                  password: { type: 'string' },
                },
              },
              keepAlive: { type: 'number', description: 'Keep-alive in seconds' },
              clientId: { type: 'string' },
            },
            required: ['clientId'],
          },
        },
        required: ['json'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'renderPublish',
      description: 'Render an MQTT 3.1.1 PUBLISH packet. Use this when the user asks to "publish" a message. The json argument should have: flags (qos 0/1/2, retain boolean, dup boolean), topic (string), payload (string), and packetId (integer, required when qos > 0).',
      parameters: {
        type: 'object',
        properties: {
          json: {
            type: 'object',
            description: 'PUBLISH packet fields',
            properties: {
              type: { type: 'string', enum: ['PUBLISH'] },
              flags: {
                type: 'object',
                properties: {
                  qos: { type: 'number', enum: [0, 1, 2] },
                  retain: { type: 'boolean' },
                  dup: { type: 'boolean' },
                },
              },
              topic: { type: 'string' },
              payload: { type: 'string' },
              packetId: { type: 'number' },
            },
            required: ['topic', 'payload'],
          },
        },
        required: ['json'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'renderSubscribe',
      description: 'Render an MQTT 3.1.1 SUBSCRIBE packet. Use this when the user asks to "subscribe" to a topic. The json argument should have: packetId (integer) and subscriptions (array of {topic, qos} objects).',
      parameters: {
        type: 'object',
        properties: {
          json: {
            type: 'object',
            description: 'SUBSCRIBE packet fields',
            properties: {
              type: { type: 'string', enum: ['SUBSCRIBE'] },
              packetId: { type: 'number' },
              subscriptions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    topic: { type: 'string' },
                    qos: { type: 'number', enum: [0, 1, 2] },
                  },
                  required: ['topic', 'qos'],
                },
              },
            },
            required: ['packetId', 'subscriptions'],
          },
        },
        required: ['json'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'renderPingreq',
      description: 'Render an MQTT 3.1.1 PINGREQ packet (heartbeat). Use this when the user asks to send a "ping" or "keepalive". No fields needed.',
      parameters: {
        type: 'object',
        properties: {
          json: {
            type: 'object',
            description: 'PINGREQ has no fields, only type',
            properties: {
              type: { type: 'string', enum: ['PINGREQ'] },
            },
          },
        },
        required: [],
      },
    },
  },
];

// === Tool executor ===
// 给 LLM 调 tool, 把 tool call 的 argument 喂给 renderer, 返回字节数组
export const TOOL_EXECUTORS = {
  renderConnect: renderConnectExec,
  renderPublish: renderPublishExec,
  renderSubscribe: renderSubscribeExec,
  renderPingreq: renderPingreqExec,
};

export const TOOL_NAMES = TOOLS.map((t) => t.function.name);
