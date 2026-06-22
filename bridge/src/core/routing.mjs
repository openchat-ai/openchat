import { sessionManager } from './runtime.mjs';
import { sessionRepo } from './repositories.mjs';
import { MessageType } from '../protocol/message.js';
import '../plugins/init.mjs';
import { orchestrator, injectCodingTools } from './agent/orchestrator.mjs';
import { TOOLS, executeTool } from '../experiments/lib/coding-lib.mjs';

export class Router {
  constructor() {
    this.gateways = new Map();
    this.plugins = new Map();
    this.handlers = new Map();
  }

  registerGateway(id, gateway) {
    this.gateways.set(id, gateway);
  }

  registerPlugin(id, plugin) {
    this.plugins.set(id, plugin);
  }

  async dispatch(gatewayId, payload) {
    const { type, data, sessionId } = payload;
    try {
      const result = await this.handleRequest(payload);
      const gateway = this.gateways.get(gatewayId);
      if (gateway && gateway.send) {
        await gateway.send(result);
      }
      return result;
    } catch (error) {
      console.error(`[Router] Dispatch error: ${error.message}`);
      throw error;
    }
  }

  async handleRequest(payload) {
    const handler = this.handlers.get(payload.type);
    if (handler) {
      return await handler(payload);
    }
    return {
      type: 'error',
      data: { message: `No handler registered for type: ${payload.type}` }
    };
  }

  registerHandler(type, handler) {
    this.handlers.set(type, handler);
  }
}

export const router = new Router();

export const CoreHandlers = {
  async handleProviderAdd({ data }) {
    const { providerType, apiKey, endpoint } = data;
    await sessionManager.addProvider(providerType, apiKey, endpoint);
    return {
      type: MessageType.PROVIDER_LIST,
      data: { providers: sessionManager.listProviders() }
    };
  },

  async handleSessionCreate({ data }) {
    const { providerType, model } = data;
    const session = await sessionManager.createSession(providerType, model);
    return {
      type: MessageType.SESSION_CREATE,
      data: { session },
      sessionId: session.id
    };
  },

  async handleChatMessage({ sessionId, data }) {
    const { message } = data;
    const userId = 'default-user';
    const responseContent = await orchestrator.process(sessionId, userId, message);
    return {
      type: MessageType.CHAT_RESPONSE,
      data: {
        content: responseContent,
        metadata: { agent: 'hermes-core', status: 'processed' }
      },
      sessionId
    };
  },

  async handleBridgeStatus() {
    return {
      type: MessageType.BRIDGE_STATUS,
      data: {
        providers: sessionManager.listProviders(),
        sessions: sessionManager.listSessions()
      }
    };
  }
};

export function initCore() {
  injectCodingTools(TOOLS, executeTool);
  router.registerHandler(MessageType.PROVIDER_ADD, CoreHandlers.handleProviderAdd);
  router.registerHandler(MessageType.SESSION_CREATE, CoreHandlers.handleSessionCreate);
  router.registerHandler(MessageType.CHAT_MESSAGE, CoreHandlers.handleChatMessage);
  router.registerHandler(MessageType.BRIDGE_STATUS, CoreHandlers.handleBridgeStatus);
}
