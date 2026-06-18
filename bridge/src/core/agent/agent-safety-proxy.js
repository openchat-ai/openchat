import logger from '../monitoring/logger.js';
import { AgentSession } from './agent-session.js';

function createSafetyProxy(session) {
  const criticalMethods = [
    'think', 'queryModel', 'callApi', '_executeRequest',
    'processResponse', 'processResponseWithRetry', 'validateOutput',
    'scoreQuality', 'extractStructuredJson', 'getCachedResponse',
    'cacheResponse', 'run', 'executeTask', 'initialize'
  ];

  const writeMethods = [
    'writeFile', 'write', 'set', 'add', 'create', 'update', 'delete', 'remove', 'destroy', 'clear'
  ];

  const queryMethods = [
    'query', 'get', 'fetch', 'select', 'find', 'search', 'retrieve'
  ];

  const fallbackStrategies = {
    think: () => ({ content: 'Operation timed out or failed' }),
    queryModel: () => ({ content: 'Model query failed' }),
    callApi: () => ({ content: 'API call failed' }),
    processResponse: () => ({ content: null, valid: false, quality: null }),
    processResponseWithRetry: () => ({ content: null, success: false }),
    validateOutput: () => ({ success: false, errors: [] }),
    scoreQuality: () => ({ overall: 0, grade: 'F' }),
    extractStructuredJson: () => ({ success: false, data: null }),
    getCachedResponse: () => null,
    cacheResponse: () => null,
    run: () => ({ status: 'error', error: 'Operation failed' }),
    executeTask: () => ({ success: false, error: 'Task execution failed' }),
    initialize: () => { throw new Error('Initialization failed'); },
    getStatus: () => ({ state: 'ERROR', error: 'Status unavailable' }),
    getStats: () => ({}),
    getQualityStats: () => ({ total: 0 }),
    getCacheStats: () => ({ size: 0, hits: 0, misses: 0 })
  };

  const handler = {
    get(target, prop, receiver) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return target[prop].bind(target);
      }

      const value = target[prop];

      if (typeof value !== 'function') {
        return value;
      }

      if (prop === '_safety' || prop === '_pendingOperations' || prop === 'config') {
        return value;
      }

      if (prop === 'constructor' || prop === 'createWithSafety') {
        return value;
      }

      const isCritical = criticalMethods.some(m => prop.includes(m));
      const isWrite = writeMethods.some(m => prop === m || prop.startsWith('_') === false && writeMethods.some(w => prop.startsWith(w)));
      const isQuery = queryMethods.some(m => prop.startsWith(m));

      if (!isCritical && !isWrite && !isQuery) {
        return value.bind(target);
      }

      return async function(...args) {
        const startTime = Date.now();
        const opName = `agent:${session.agentId}:${prop}`;

        try {
          if (session._circuitBreaker && session._circuitBreaker.canExecute) {
            const check = session._circuitBreaker.canExecute();
            if (!check.allowed) {
              const fallback = fallbackStrategies[prop];
              if (fallback) {
                return typeof fallback === 'function' ? fallback() : fallback;
              }
              return { error: 'Circuit breaker open', waitTime: check.waitTime };
            }
          }

          const timeout = isCritical ? 30000 : (isWrite ? 10000 : 15000);

          const result = await Promise.race([
            value.apply(target, args),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Timeout: ${prop} exceeded ${timeout}ms`)), timeout)
            )
          ]);

          return result;

        } catch (error) {
          logger.error(`[SafetyProxy] ${opName} failed: ${error.message}`);

          const fallback = fallbackStrategies[prop];
          if (fallback) {
            const fbResult = typeof fallback === 'function' ? fallback() : fallback;
            if (fbResult && typeof fbResult === 'object' && fbResult.content === undefined) {
              fbResult._safety_error = true;
              fbResult._original_error = error.message;
              fbResult._operation = prop;
              fbResult._duration = Date.now() - startTime;
            }
            return fbResult;
          }

          if (prop === 'initialize') {
            throw error;
          }

          return {
            success: false,
            error: error.message,
            operation: prop,
            duration: Date.now() - startTime
          };
        }
      };
    }
  };

  return new Proxy(session, handler);
}

function createSafeAgentSession(agentId, config = {}) {
  const session = new AgentSession(agentId, config);
  return createSafetyProxy(session);
}

export { createSafetyProxy, createSafeAgentSession };
