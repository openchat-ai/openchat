import { AgentEngine, AgentEvents } from './agent-engine.js';
import { QualityChecker, Corrector, ValidatorRegistry, globalValidatorRegistry } from './quality-check-system.js';
import { PromptBuilder } from './prompt-builder.js';
import { agentMonitor } from './agent-monitor.js';

export function createAgent(options = {}) {
  const engine = new AgentEngine(options.config || {});

  engine._pluginManager = options.pluginManager || null;
  engine._memoryManager = options.memory || null;
  engine._sessionManager = options.session || null;

  return {
    engine,
    processStream: (sessionId, userId, message, onEvent) =>
      engine.processStream(sessionId, userId, message, onEvent),
    process: (sessionId, userId, message) =>
      engine.process(sessionId, userId, message),
    AgentEvents,
  };
}

export {
  AgentEngine,
  AgentEvents,
  QualityChecker,
  Corrector,
  ValidatorRegistry,
  globalValidatorRegistry,
  PromptBuilder,
  agentMonitor,
};
