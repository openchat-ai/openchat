export const MessageType = {
  // 连接
  BRIDGE_HANDSHAKE: 'bridge_handshake',
  BRIDGE_STATUS: 'bridge_status',

  // Provider 管理
  PROVIDER_ADD: 'provider_add',
  PROVIDER_REMOVE: 'provider_remove',
  PROVIDER_LIST: 'provider_list',
  PROVIDER_SYNC: 'provider_sync',

  // Session 管理
  SESSION_CREATE: 'session_create',
  SESSION_CLOSE: 'session_close',
  SESSION_LIST: 'session_list',
  SESSION_HISTORY: 'session_history',

  // 聊天
  CHAT_MESSAGE: 'chat_message',
  CHAT_RESPONSE: 'chat_response',
  CHAT_STREAM: 'chat_stream',       // 流式响应
  CHAT_STREAM_END: 'chat_stream_end', // 流式结束

  // 记忆/RAG
  MEMORY_SAVE: 'memory_save',
  MEMORY_QUERY: 'memory_query',
  MEMORY_STATS: 'memory_stats',

  // Agent
  AGENT_SPAWN: 'agent_spawn',
  AGENT_LIST: 'agent_list',
  AGENT_SEND: 'agent_send',
  AGENT_TERMINATE: 'agent_TERMINATE',

  // 错误
  ERROR: 'error'
};

export class BridgeMessage {
  constructor(type, data = {}, sessionId = null) {
    this.id = crypto.randomUUID();
    this.type = type;
    this.sessionId = sessionId;
    this.data = data;
    this.timestamp = Date.now();
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      sessionId: this.sessionId,
      data: this.data,
      timestamp: this.timestamp
    };
  }

  static fromJSON(json) {
    const msg = new BridgeMessage(json.type, json.data, json.sessionId);
    msg.id = json.id;
    msg.timestamp = json.timestamp;
    return msg;
  }
}

export class MessageBuilder {
  static handshake(clientId, capabilities = []) {
    return new BridgeMessage(MessageType.BRIDGE_HANDSHAKE, {
      clientId,
      capabilities,
      version: 2  // 升级版本号
    });
  }

  static status(providers, sessions, memory = null) {
    return new BridgeMessage(MessageType.BRIDGE_STATUS, {
      providers,
      sessions,
      memory,
      uptime: process.uptime()
    });
  }

  static providerList(providers) {
    return new BridgeMessage(MessageType.PROVIDER_LIST, { providers });
  }

  static sessionList(sessions) {
    return new BridgeMessage(MessageType.SESSION_LIST, { sessions });
  }

  static chatResponse(sessionId, content, metadata = {}) {
    return new BridgeMessage(MessageType.CHAT_RESPONSE, {
      content,
      metadata
    }, sessionId);
  }

  // 流式响应
  static chatStream(sessionId, chunk, isDone = false) {
    return new BridgeMessage(
      isDone ? MessageType.CHAT_STREAM_END : MessageType.CHAT_STREAM,
      { chunk, isDone },
      sessionId
    );
  }

  // 记忆操作
  static memorySave(fact, id) {
    return new BridgeMessage(MessageType.MEMORY_SAVE, { fact, id });
  }

  static memoryQuery(results) {
    return new BridgeMessage(MessageType.MEMORY_QUERY, { results });
  }

  static memoryStats(stats) {
    return new BridgeMessage(MessageType.MEMORY_STATS, stats);
  }

  // Agent
  static agentSpawned(agentId, config) {
    return new BridgeMessage(MessageType.AGENT_SPAWN, { agentId, config });
  }

  static agentList(agents) {
    return new BridgeMessage(MessageType.AGENT_LIST, { agents });
  }

  static error(message, code = 'UNKNOWN_ERROR') {
    return new BridgeMessage(MessageType.ERROR, {
      message,
      code
    });
  }
}

export function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, error: 'Invalid message format' };
  }

  if (!msg.type || typeof msg.type !== 'string') {
    return { valid: false, error: 'Missing or invalid message type' };
  }

  if (!msg.data || typeof msg.data !== 'object') {
    return { valid: false, error: 'Missing or invalid message data' };
  }

  return { valid: true };
}

export function serializeMessage(msg) {
  return JSON.stringify(msg.toJSON());
}

export function parseMessage(str) {
  try {
    const json = JSON.parse(str);
    const validated = validateMessage(json);
    if (!validated.valid) {
      throw new Error(validated.error);
    }
    return BridgeMessage.fromJSON(json);
  } catch (e) {
    throw new Error(`Failed to parse message: ${e.message}`);
  }
}