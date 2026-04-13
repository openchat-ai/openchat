export const MessageType = {
  BRIDGE_HANDSHAKE: 'bridge_handshake',
  BRIDGE_STATUS: 'bridge_status',
  PROVIDER_ADD: 'provider_add',
  PROVIDER_REMOVE: 'provider_remove',
  PROVIDER_LIST: 'provider_list',
  SESSION_CREATE: 'session_create',
  SESSION_CLOSE: 'session_close',
  SESSION_LIST: 'session_list',
  CHAT_MESSAGE: 'chat_message',
  CHAT_RESPONSE: 'chat_response',
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
      version: 1
    });
  }

  static status(providers, sessions) {
    return new BridgeMessage(MessageType.BRIDGE_STATUS, {
      providers,
      sessions,
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