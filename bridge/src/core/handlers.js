import { router } from '../core/router.js';
import { sessionRepo } from './core/repositories/session-repo.js';
import { MessageType } from '../protocol/message.js';
import '../plugins/init.mjs';
import { orchestrator, injectCodingTools } from './agent/orchestrator.mjs';
import { TOOLS, executeTool } from '../experiments/lib/coding-tools.mjs';

/**
 * CoreHandlers contains the actual logic for the Bridge's operations.
 * It decouples the Router from the specific implementations of session/provider management.
 */
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

/**
 * Initialize the router with core handlers.
 */
export function initCore() {
  injectCodingTools(TOOLS, executeTool);
  router.registerHandler(MessageType.PROVIDER_ADD, CoreHandlers.handleProviderAdd);
  router.registerHandler(MessageType.SESSION_CREATE, CoreHandlers.handleSessionCreate);
  router.registerHandler(MessageType.CHAT_MESSAGE, CoreHandlers.handleChatMessage);
  router.registerHandler(MessageType.BRIDGE_STATUS, CoreHandlers.handleBridgeStatus);
  
}