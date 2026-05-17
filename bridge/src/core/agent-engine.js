/**
 * Bridge AgentEngine — wraps @openchat/agent-kit with Bridge-specific dependencies
 *
 * Usage:
 *   const { agentEngine } = await import('./core/agent-engine.js');
 *   await agentEngine.processStream(sid, uid, msg, onEvent);
 */

import { createAgent, AgentEngine as KitEngine, AgentEvents } from '@openchat/agent-kit';
import { pluginManager } from '../plugins/plugin-manager.js';
import { memoryManager } from '../memory/memory-manager.js';
import { sessionManager } from '../session/session-manager.js';

const bridgeAgent = createAgent({
  pluginManager,
  memory: memoryManager,
  session: sessionManager,
});

export const agentEngine = bridgeAgent.engine;

// Also export the raw kit for direct use
export { KitEngine as AgentEngine, AgentEvents };
export default agentEngine;
