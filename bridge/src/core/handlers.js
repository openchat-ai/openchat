import { router } from '../core/router.js';
import { sessionManager } from '../session/session-manager.js';
import { MessageType } from '../protocol/message.js';
import { pluginManager } from '../plugins/plugin-manager.js';
import { ShellPlugin, FilePlugin } from '../plugins/system-plugins.js';
import { CodingToolsPlugin } from '../plugins/coding-tools-plugin.mjs';
import { GitPlugin, DevToolsPlugin } from '../plugins/eng-plugins.js';
import SelfTestPlugin from '../plugins/self-test-plugin.js';
import { DevWorkflowPlugin } from '../plugins/dev-workflow-plugin.mjs';
import {
  CodeAnalysisPlugin,
  ProjectManagementPlugin,
  WebToolsPlugin,
  MemoryToolsPlugin
} from '../plugins/agent-tools.js';
import { agentEngine } from './agent/agent-engine.js';

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
    const responseContent = await agentEngine.process(sessionId, userId, message);
    
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
  router.registerHandler(MessageType.PROVIDER_ADD, CoreHandlers.handleProviderAdd);
  router.registerHandler(MessageType.SESSION_CREATE, CoreHandlers.handleSessionCreate);
  router.registerHandler(MessageType.CHAT_MESSAGE, CoreHandlers.handleChatMessage);
  router.registerHandler(MessageType.BRIDGE_STATUS, CoreHandlers.handleBridgeStatus);
  
  // Initialize System Plugins (The "Hands")
  pluginManager.registerPlugin(ShellPlugin);
  pluginManager.registerPlugin(CodingToolsPlugin);

  // Initialize Engineering Plugins (The "Expertise")
  pluginManager.registerPlugin(GitPlugin);
  pluginManager.registerPlugin(DevToolsPlugin);

  // Initialize Agent Tools (The "Intelligence")
  pluginManager.registerPlugin(CodeAnalysisPlugin);
  pluginManager.registerPlugin(ProjectManagementPlugin);
  pluginManager.registerPlugin(WebToolsPlugin);
  pluginManager.registerPlugin(MemoryToolsPlugin);

  // Initialize Self-Verification Plugins (The "Conscience")
  pluginManager.registerPlugin(SelfTestPlugin);

  // Dev Workflow Plugin — replaces legacy tools with quality-gated implementations
  pluginManager.registerPlugin(DevWorkflowPlugin);
}