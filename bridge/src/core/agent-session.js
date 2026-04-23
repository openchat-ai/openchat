import { messageBus, MESSAGE_TYPES } from './message-bus.js';
import { persistentConfig } from '../core/persistent-config.js';
import { providerManager, PRESET_PROVIDERS, DEFAULT_PROVIDER } from '../providers/provider-manager.js';
import { EvolutionEngine } from './evolution-engine.js';
import { securityManager } from '../security/security-manager.js';
import { ResponseParser } from './response-parser.js';
import { ErrorClassifier } from './error-classifier.js';
import { ContentAnalyzer } from './content-analyzer.js';
import { QualityScorer } from './quality-scorer.js';
import { StructuredOutputValidator } from './structured-output-validator.js';
import { StreamingValidator, ValidationErrorExplainer } from './streaming-validator.js';
import { SchemaAutoGenerator, SchemaVersionManager, FormatConverter } from './schema-manager.js';
import { MultimodalHandler } from './multimodal-handler.js';
import { ResponseCache, SmartRouter, StreamHandler, SafetyWrapper, CircuitBreakerMonitor, MetricsCollector, AdaptiveLimiter, IntelligentCircuitBreaker, CircuitBreaker, RequestQueue, RequestDeduplicator } from './resilience.js';

export const AGENT_STATES = {
  IDLE: 'idle',
  INITIALIZING: 'initializing',
  READY: 'ready',
  THINKING: 'thinking',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  ERROR: 'error',
  TERMINATED: 'terminated',
  CIRCUIT_OPEN: 'circuit_open'
};

const HEARTBEAT_INTERVAL = 5000;

export class AgentSession {
  constructor(agentId, config = {}) {
    const currentProvider = persistentConfig.getCurrentProvider();
    this.agentId = agentId;
    this.config = {
      name: config.name || `agent-${agentId.substring(0, 8)}`,
      provider: config.provider || currentProvider || DEFAULT_PROVIDER,
      model: config.model || persistentConfig.getCurrentModel() || null,
      systemPrompt: config.systemPrompt || 'You are a helpful AI assistant.',
      maxIterations: config.maxIterations || 10,
      ...config
    };

    this.state = AGENT_STATES.IDLE;
    this.messages = [];
    this.results = new Map();
    this.subscriptions = [];
    this.iterationCount = 0;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.lastHeartbeat = Date.now();
    this.currentTask = null;
    this.error = null;
    this._heartbeatInterval = null;
    this._isDestroyed = false;
    this._pendingOperations = new Set();

    this._metrics = new MetricsCollector({
      windowSize: config.metricsWindowSize || 60000,
      maxMetrics: config.metricsMaxSize || 10000
    });
    
    this._limiter = new AdaptiveLimiter({
      minConcurrent: config.minConcurrent || 1,
      maxConcurrent: config.maxConcurrent || 5,
      initialConcurrent: config.maxConcurrent || 2,
      minInterval: config.minInterval || 100,
      maxInterval: config.maxInterval || 5000,
      initialInterval: 500
    });
    
    // 初始化进化引擎
    this.evolutionEngine = new EvolutionEngine();
    
    // 初始化安全系统
    this.securityManager = securityManager;
    this._limiter.setMetrics(this._metrics);
    
    this._circuitBreaker = new IntelligentCircuitBreaker({
      failureThreshold: config.circuitFailureThreshold || 5,
      successThreshold: config.circuitSuccessThreshold || 2,
      openTimeout: config.circuitOpenTimeout || 30000,
      slowResponseThreshold: config.slowResponseThreshold || 10000,
      slowFailureWeight: config.slowFailureWeight || 2
    });
    
    this._requestQueue = new RequestQueue({
      getConfig: () => this._limiter.getConfig(),
      maxQueueSize: config.maxQueueSize || 100
    });
    
    this._deduplicator = new RequestDeduplicator({
      maxSize: config.dedupMaxSize || 1000,
      ttl: config.dedupTtl || 30000
    });
    
    this._responseParser = new ResponseParser();
    this._errorClassifier = new ErrorClassifier();
    this._streamHandler = new StreamHandler({
      onChunk: config.onStreamChunk || null,
      onComplete: config.onStreamComplete || null
    });
    this._contentAnalyzer = new ContentAnalyzer({
      filterSensitive: config.filterSensitive !== false
    });
    this._outputValidator = new StructuredOutputValidator({
      strictMode: config.outputValidatorStrict !== false,
      maxRetries: config.outputValidatorMaxRetries || 3,
      enableAutoFix: config.outputValidatorAutoFix !== false,
      coerceTypes: config.outputValidatorCoerceTypes !== false
    });
    this._multimodalHandler = new MultimodalHandler({
      maxImageSize: config.maxImageSize || 10 * 1024 * 1024,
      enableDownload: config.enableMediaDownload !== false,
      cacheSize: config.mediaCacheSize || 50
    });
    this._qualityScorer = new QualityScorer({
      relevanceWeight: config.qualityRelevanceWeight || 0.25,
      completenessWeight: config.qualityCompletenessWeight || 0.25,
      consistencyWeight: config.qualityConsistencyWeight || 0.2,
      hallucinationWeight: config.qualityHallucinationWeight || 0.15,
      toxicityWeight: config.qualityToxicityWeight || 0.15,
      cacheSize: config.qualityCacheSize || 100
    });
    this._responseCache = new ResponseCache({
      maxSize: config.cacheMaxSize || 500,
      defaultTtl: config.cacheTtl || 3600000,
      maxMemory: config.cacheMaxMemory || 50 * 1024 * 1024,
      evictionPolicy: config.cacheEvictionPolicy || 'lru'
    });
    this._streamingValidator = new StreamingValidator({
      onError: config.onStreamValidationError || null,
      onWarning: config.onStreamValidationWarning || null,
      onProgress: config.onStreamValidationProgress || null,
      maxErrors: config.streamValidationMaxErrors || 10,
      earlyStop: config.streamValidationEarlyStop !== false
    });
    this._safety = new SafetyWrapper({
      defaultTimeout: config.safetyTimeout || 30000,
      maxTimeout: config.safetyMaxTimeout || 300000,
      enableFallback: config.safetyEnableFallback !== false,
      maxErrorLogSize: config.safetyMaxErrorLogSize || 1000,
      circuitBreaker: {
        failureThreshold: config.circuitFailureThreshold || 5,
        successThreshold: config.circuitSuccessThreshold || 2,
        openTimeout: config.circuitOpenTimeout || 30000
      }
    });
    
    this._router = new SmartRouter({
      defaultProvider: this.config.provider
    });
    
    const providers = persistentConfig.listProviders();
    for (const p of providers) {
      const pConfig = providerManager.getProviderConfig(p);
      if (pConfig) {
        this._router.registerProvider(p, pConfig);
      }
    }
  }

  async initialize() {
    if (this._isDestroyed) {
      throw new Error('Agent has been destroyed');
    }
    
    this.state = AGENT_STATES.INITIALIZING;
    this.lastActivity = Date.now();
    
    try {
      this.subscribeToBus();
      this.startHeartbeat();
      this.state = AGENT_STATES.READY;
      this.lastActivity = Date.now();
      return this;
    } catch (error) {
      this.state = AGENT_STATES.ERROR;
      this.error = error.message;
      throw error;
    }
  }

  startHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
    }
    
    this._heartbeatInterval = setInterval(() => {
      if (this._isDestroyed) {
        this.stopHeartbeat();
        return;
      }
      
      try {
        this.lastHeartbeat = Date.now();
        this.publishHeartbeatSafe();
      } catch (error) {
        console.error(`[Agent ${this.config.name}] Heartbeat error: ${error.message}`);
        this.restartHeartbeat();
      }
    }, HEARTBEAT_INTERVAL);
  }

  restartHeartbeat() {
    this.stopHeartbeat();
    if (!this._isDestroyed) {
      setTimeout(() => {
        if (!this._isDestroyed) {
          this.startHeartbeat();
        }
      }, 5000);
    }
  }

  stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

  publishHeartbeatSafe() {
    if (this._isDestroyed) return;
    
    messageBus.publish(MESSAGE_TYPES.HEARTBEAT, {
      agentId: this.agentId,
      name: this.config.name,
      state: this.state,
      iterationCount: this.iterationCount,
      currentTask: this.currentTask,
      lastActivity: this.lastActivity,
      timestamp: Date.now()
    });
  }

  subscribeToBus() {
    const handler = (msg) => {
      if (this._isDestroyed) return;
      this.handleMessageSafe(msg);
    };
    messageBus.subscribe(`agent:${this.agentId}`, handler);
    this.subscriptions.push(() => {
      try {
        messageBus.off(`agent:${this.agentId}`, handler);
      } catch (e) {
      }
    });
  }

  handleMessageSafe(msg) {
    try {
      this.lastActivity = Date.now();

      switch (msg.type) {
        case MESSAGE_TYPES.REQUEST:
          this.handleRequest(msg);
          break;
        case MESSAGE_TYPES.DELEGATE:
          this.handleDelegate(msg);
          break;
        case MESSAGE_TYPES.BROADCAST:
          this.handleBroadcast(msg);
          break;
        case MESSAGE_TYPES.RESPONSE:
          this.handleResponse(msg);
          break;
        case MESSAGE_TYPES.TERMINATE:
          this.handleTerminate(msg);
          break;
      }
    } catch (error) {
      console.error(`[Agent ${this.config.name}] Error handling message: ${error.message}`);
      this.state = AGENT_STATES.ERROR;
      this.error = error.message;
    }
  }

  handleMessage(msg) {
    this.lastActivity = Date.now();

    switch (msg.type) {
      case MESSAGE_TYPES.REQUEST:
        this.handleRequest(msg);
        break;
      case MESSAGE_TYPES.DELEGATE:
        this.handleDelegate(msg);
        break;
      case MESSAGE_TYPES.BROADCAST:
        this.handleBroadcast(msg);
        break;
      case MESSAGE_TYPES.RESPONSE:
        this.handleResponse(msg);
        break;
      case MESSAGE_TYPES.TERMINATE:
        this.handleTerminate(msg);
        break;
    }
  }

  async handleRequest(msg) {
    if (this._isDestroyed) return;
    
    this.state = AGENT_STATES.EXECUTING;
    this.currentTask = msg.content?.substring(0, 50);
    this.lastActivity = Date.now();
    this.addMessage('user', msg.content);
    
    const opId = crypto.randomUUID();
    this._pendingOperations.add(opId);
    
    try {
      const response = await this.think();
      this.state = AGENT_STATES.COMPLETED;
      messageBus.reply(msg, {
        success: true,
        result: response
      });
    } catch (error) {
      this.state = AGENT_STATES.ERROR;
      this.error = error.message;
      messageBus.reply(msg, {
        success: false,
        error: error.message
      });
    } finally {
      this._pendingOperations.delete(opId);
      this.currentTask = null;
      this.lastActivity = Date.now();
    }
  }

  async handleDelegate(msg) {
    if (this._isDestroyed) return;
    
    this.state = AGENT_STATES.EXECUTING;
    this.currentTask = msg.content?.description || JSON.stringify(msg.content)?.substring(0, 50);
    this.lastActivity = Date.now();
    this.addMessage('user', `[Delegate] ${JSON.stringify(msg.content)}`);
    
    const opId = crypto.randomUUID();
    this._pendingOperations.add(opId);
    
    try {
      const result = await this.executeTask(msg.content);
      this.results.set(msg.id, { success: true, result });
      this.state = AGENT_STATES.COMPLETED;
      messageBus.reply(msg, { success: true, result });
    } catch (error) {
      this.state = AGENT_STATES.ERROR;
      this.error = error.message;
      const errorResult = { success: false, error: error.message };
      this.results.set(msg.id, errorResult);
      messageBus.reply(msg, errorResult);
    } finally {
      this._pendingOperations.delete(opId);
      this.currentTask = null;
      this.lastActivity = Date.now();
    }
  }

  handleBroadcast(msg) {
    this.addMessage('system', `[Broadcast from ${msg.from}] ${JSON.stringify(msg.content)}`);
  }

  handleResponse(msg) {
    if (msg.replyTo && this.results.has(msg.replyTo)) {
      const pending = this.results.get(msg.replyTo);
      pending.response = msg.content;
      pending.receivedAt = Date.now();
    }
  }

  handleTerminate(msg) {
    console.log(`[Agent ${this.config.name}] Received terminate signal`);
    this.destroy();
  }

  addMessage(role, content) {
    this.messages.push({
      role,
      content,
      timestamp: new Date().toISOString()
    });
    this.lastActivity = Date.now();
  }

  async think() {
    if (this._isDestroyed) {
      throw new Error('Agent has been destroyed');
    }
    
    if (this.iterationCount >= this.config.maxIterations) {
      this.state = AGENT_STATES.ERROR;
      this.error = 'Max iterations reached';
      throw new Error(this.error);
    }
    
    this.iterationCount++;
    this.state = AGENT_STATES.THINKING;
    this.lastActivity = Date.now();

    try {
      const response = await this.queryModel(this.messages);
      this.addMessage('assistant', response.content);
      this.state = AGENT_STATES.READY;
      this.lastActivity = Date.now();
      
      // 任务完成后进行进化分析
      if (this.currentTask) {
        await this.evolutionEngine.analyzeExperience(
          this.currentTask, 
          response.content || response,
          { agentId: this.agentId, provider: this.config.provider }
        );
      }
      
      return response;
    } catch (error) {
      this.state = AGENT_STATES.ERROR;
      this.error = error.message;
      
      // 即使出错也要记录失败经验
      if (this.currentTask) {
        await this.evolutionEngine.analyzeExperience(
          this.currentTask,
          `Error: ${error.message}`,
          { agentId: this.agentId, provider: this.config.provider, error: true }
        );
      }
      
      throw error;
    }
  }

  async queryModel(messages) {
    // 优先使用配置的 provider，而不是让路由器选择
    let providerName = this.config.provider;
    let apiKey = persistentConfig.getApiKey(providerName);
    let model = this.config.model;

    // 如果配置的 provider 没有 API key，尝试其他 providers
    if (!apiKey) {
      const availableProviders = persistentConfig.listProviders();
      for (const p of availableProviders) {
        const key = persistentConfig.getApiKey(p);
        if (key) {
          providerName = p;
          apiKey = key;
          break;
        }
      }
    }

    if (!apiKey) {
      return { content: 'No API key configured. Please set: config set <provider> <api_key>' };
    }

    const providerConfig = providerManager.getProviderConfig(providerName);
    if (!providerConfig) {
      return { content: `Unsupported provider: ${providerName}` };
    }

    if (!model) {
      model = providerConfig.defaultModel;
    }

    return this.callApi(providerName, apiKey, model, messages);
  }

  async callApi(provider, apiKey, model, messages) {
    await this._limiter.adapt();
    
    const providerConfig = providerManager.getProviderConfig(provider);
    if (!providerConfig || !providerConfig.baseUrl) {
      return { content: `Provider ${provider} missing baseUrl config` };
    }

    const filteredMessages = messages.filter(m => m.role !== 'system');
    if (this.config.systemPrompt) {
      filteredMessages.unshift({ role: 'system', content: this.config.systemPrompt });
    }

    let headers = { 'Content-Type': 'application/json' };

    if (providerConfig.authType === 'baidu_iam' || provider.includes('baidu')) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const requestKey = { provider, model, messages: filteredMessages };
    
    const startTime = Date.now();

    const doRequest = async () => {
      const requestStart = Date.now();
      const result = await this._executeRequest(provider, apiKey, model, filteredMessages, headers, providerConfig);
      const latency = Date.now() - requestStart;
      
      const success = !result.content?.startsWith('API error');
      const statusCode = this._extractStatusCode(result.content);
      const errorType = this._classifyError(result.content);
      
      this._metrics.recordRequest(success, latency, statusCode, errorType);
      this._router.recordSuccess(provider, latency);
      
      if (success) {
        this._circuitBreaker.recordSuccess(latency);
      } else {
        this._circuitBreaker.recordFailure(statusCode, latency);
        this._router.recordFailure(provider, statusCode, latency);
      }
      
      return result;
    };

    return this._deduplicator.deduplicate(requestKey, () => {
      return this._requestQueue.enqueue(doRequest);
    });
  }

  _extractStatusCode(content) {
    if (!content) return null;
    const match = content.match(/HTTP (\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  _classifyError(content) {
    if (!content) return 'unknown';
    if (content.includes('timeout')) return 'timeout';
    if (content.includes('network')) return 'network';
    if (content.includes('429')) return 'rate_limit';
    if (content.includes('500')) return 'server_error';
    if (content.includes('401') || content.includes('403')) return 'auth';
    return 'other';
  }

  async _executeRequest(provider, apiKey, model, filteredMessages, headers, providerConfig) {
    const config = {
      retries: 3,
      retryDelay: 100,
      minTimeout: 1000,
      maxTimeout: 30000,
      maxRetryDelay: 30000,
      factor: 2,
      randomize: true,
      maxRetryTime: 60000,
      noResponseRetries: 2,
      statusCodesToRetry: [
        [408, 408],
        [429, 429],
        [500, 599]
      ],
      retry: true,
      onRetryAttempt: null,
      shouldRetry: null,
      retryBackoff: null,
      signal: null
    };

    const startTime = Date.now();
    let attempt = 0;
    let httpRetries = 0;
    let noResponseRetries = 0;

    while (true) {
      if (this._isDestroyed) {
        return { content: 'Agent destroyed' };
      }

      config.signal?.throwIfAborted?.();

      const circuitCheck = this._circuitBreaker.canExecute();
      if (!circuitCheck.allowed) {
        const waitTime = Math.ceil(circuitCheck.waitTime / 1000);
        return { content: `Circuit breaker open, retry in ${waitTime}s` };
      }

      if (circuitCheck.state === 'HALF_OPEN') {
        console.log('[API] Circuit half-open, probing...');
      }

      attempt++;

      let response;
      let data;
      let status;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.maxTimeout);

      try {
        const requestBody = {
          model: model,
          messages: filteredMessages,
          temperature: 0.7,
          max_tokens: 2000
        };

        response = await fetch(`${providerConfig.baseUrl}${providerConfig.chatEndpoint}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        status = response.status;
        data = await response.json();

        if (response.ok) {
          this._circuitBreaker.recordSuccess();
          
          const parsed = this._responseParser.parse(data, provider);
          
          if (!parsed.success) {
            return { content: `API error: ${parsed.content}` };
          }
          
          return { content: parsed.content };
        }

        const errorClassification = this._errorClassifier.classify(
          data.error?.message || JSON.stringify(data),
          { statusCode: status, attempt }
        );

        let shouldRetry = this._shouldRetryByStatus(status, httpRetries, config, startTime);

        if (shouldRetry && config.shouldRetry) {
          const customResult = await config.shouldRetry({
            error: { status, response: data },
            attemptNumber: attempt,
            retriesLeft: config.retries - httpRetries,
            retriesConsumed: httpRetries,
            classification: errorClassification
          });
          if (customResult === false) {
            shouldRetry = false;
          }
        }

        if (!shouldRetry) {
          this._circuitBreaker.recordFailure();
          return { content: `API error: HTTP ${status} (${errorClassification.category})` };
        }

        let delay = this._calculateBackoff(attempt, config, httpRetries);

        if (status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            const retryAfterMs = parseInt(retryAfter, 10) * 1000;
            if (!isNaN(retryAfterMs)) {
              delay = Math.min(retryAfterMs, config.maxRetryDelay);
            }
          }
        }

        if (config.retryBackoff) {
          delay = await config.retryBackoff({
            error: { status, response: data },
            delay,
            attemptNumber: attempt
          });
        }

        config.onRetryAttempt?.({
          error: { status, response: data },
          attemptNumber: attempt,
          retriesLeft: config.retries - httpRetries,
          retryDelay: delay
        });

        console.log(`[API] Attempt ${attempt} failed (HTTP ${status}). Retrying in ${delay}ms...`);

        await this._delay(delay);
        httpRetries++;

      } catch (error) {
        clearTimeout(timeoutId);

        if (this._isDestroyed) {
          return { content: 'Agent destroyed' };
        }

        config.signal?.throwIfAborted?.();

        const isNetworkError = !response || error.name === 'TypeError' || error.name === 'AbortError' || error.message.includes('fetch');
        
        const errorClassification = this._errorClassifier.classify(
          error.message,
          { attempt, noResponse: true }
        );
        
        if (isNetworkError) {
          if (noResponseRetries >= config.noResponseRetries || !errorClassification.shouldRetry) {
            this._circuitBreaker.recordFailure();
            return { content: `API error: ${error.message} (${errorClassification.category})` };
          }
          
          if (!this._withinRetryTime(startTime, config.maxRetryTime)) {
            return { content: `API error: ${error.message} (${errorClassification.category})` };
          }

          let delay = this._calculateBackoff(attempt, config, noResponseRetries);

          if (config.retryBackoff) {
            delay = await config.retryBackoff({
              error: { message: error.message },
              delay,
              attemptNumber: attempt
            });
          }

          config.onRetryAttempt?.({
            error: { message: error.message },
            attemptNumber: attempt,
            retriesLeft: config.noResponseRetries - noResponseRetries,
            retryDelay: delay
          });

          console.log(`[API] Attempt ${attempt} failed (${error.message}). Retrying in ${delay}ms...`);

          await this._delay(delay);
          noResponseRetries++;
          continue;
        }

        return { content: `API error: ${error.message}` };
      }
    }
  }

  _shouldRetryByStatus(status, httpRetriesConsumed, config, startTime) {
    if (!config.retry || httpRetriesConsumed >= config.retries) {
      return false;
    }

    if (!this._withinRetryTime(startTime, config.maxRetryTime)) {
      return false;
    }

    for (const [min, max] of config.statusCodesToRetry) {
      if (status >= min && status <= max) {
        return true;
      }
    }

    return false;
  }

  _withinRetryTime(startTime, maxRetryTime) {
    return Date.now() - startTime < maxRetryTime;
  }

  _calculateBackoff(attempt, config, retriesConsumed) {
    let delay = config.minTimeout * Math.pow(config.factor, retriesConsumed);

    if (config.randomize) {
      delay = delay * (0.5 + Math.random());
    }

    return Math.min(delay, config.maxRetryDelay);
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async executeTask(task) {
    if (this._isDestroyed) {
      throw new Error('Agent has been destroyed');
    }
    
    this.state = AGENT_STATES.EXECUTING;
    this.lastActivity = Date.now();
    
    if (typeof task === 'string') {
      return this.think();
    }

    if (task.type === 'write_file') {
      this.currentTask = `Writing: ${task.path}`;
      const { writeFile } = await import('fs/promises');
      await writeFile(task.path, task.content);
      return { success: true, path: task.path };
    }

    if (task.type === 'run_command') {
      this.currentTask = `Running: ${task.command?.substring(0, 30)}`;
      const { exec } = await import('child_process');
      return new Promise((resolve) => {
        exec(task.command, (error, stdout, stderr) => {
          resolve({ error: error?.message, stdout, stderr });
        });
      });
    }

    if (task.type === 'read_file') {
      this.currentTask = `Reading: ${task.path}`;
      const { readFile } = await import('fs/promises');
      const content = await readFile(task.path, 'utf8');
      return { success: true, content };
    }

    return { success: false, error: 'Unknown task type' };
  }

  async run(initialTask) {
    await this.initialize();
    
    if (initialTask) {
      this.state = AGENT_STATES.EXECUTING;
      this.currentTask = typeof initialTask === 'string' ? initialTask.substring(0, 50) : 'Task';
      this.addMessage('user', typeof initialTask === 'string' ? initialTask : JSON.stringify(initialTask));
      
      try {
        const result = await this.think();
        this.state = AGENT_STATES.COMPLETED;
        return result;
      } catch (error) {
        this.state = AGENT_STATES.ERROR;
        this.error = error.message;
        throw error;
      } finally {
        this.currentTask = null;
        this.lastActivity = Date.now();
      }
    }
    
    return { status: 'ready', agentId: this.agentId };
  }

  sendTo(toAgentId, message) {
    if (this._isDestroyed) return;
    messageBus.sendTo(this.agentId, toAgentId, message);
  }

  broadcast(message) {
    if (this._isDestroyed) return;
    messageBus.broadcast(this.agentId, message);
  }

  delegateTo(toAgentId, task) {
    if (this._isDestroyed) return;
    messageBus.delegate(this.agentId, toAgentId, task);
  }

  destroy() {
    if (this._isDestroyed) return;
    
    this._isDestroyed = true;
    this.state = AGENT_STATES.TERMINATED;
    this.stopHeartbeat();
    
    for (const opId of this._pendingOperations) {
    }
    this._pendingOperations.clear();
    
    if (this.subscriptions.length > 0) {
      this.subscriptions.forEach(unsub => {
        try {
          unsub();
        } catch (e) {
        }
      });
      this.subscriptions = [];
    }
  }

  cleanup() {
    this.destroy();
  }

  getStatus() {
    return {
      agentId: this.agentId,
      name: this.config.name,
      provider: this.config.provider,
      model: this.config.model || providerManager.getDefaultModel(this.config.provider),
      state: this.state,
      iterationCount: this.iterationCount,
      maxIterations: this.config.maxIterations,
      messageCount: this.messages.length,
      currentTask: this.currentTask,
      lastActivity: this.lastActivity,
      lastHeartbeat: this.lastHeartbeat,
      error: this.error,
      createdAt: this.createdAt,
      uptime: Date.now() - this.createdAt,
      isDestroyed: this._isDestroyed
    };
  }

  setOutputSchema(schema) {
    this._outputSchema = schema;
    return this;
  }

  inferOutputSchema(examples) {
    if (!Array.isArray(examples) || examples.length === 0) {
      throw new Error('At least one example is required for schema inference');
    }
    this._outputSchema = this._outputValidator.inferSchema(examples);
    return this._outputSchema;
  }

  validateOutput(content, schema = this._outputSchema) {
    if (!schema) {
      return {
        success: false,
        errors: [{ path: 'root', message: 'No schema provided. Use setOutputSchema() or provide a schema.' }],
        warnings: []
      };
    }
    return this._outputValidator.validateWithRetry(content, schema);
  }

  extractStructuredJson(content) {
    return this._outputValidator.extractJson(content);
  }

  getValidatorConfig() {
    return {
      hasSchema: !!this._outputSchema,
      schema: this._outputSchema || null,
      maxRetries: this._outputValidator._maxRetries,
      enableAutoFix: this._outputValidator._enableAutoFix,
      coerceTypes: this._outputValidator._coerceTypes,
      strictMode: this._outputValidator._strictMode
    };
  }

  detectMedia(content) {
    return this._multimodalHandler.detectContentTypes(content);
  }

  extractImages(content) {
    return this._multimodalHandler.extractMediaUrls(content, 'image');
  }

  extractAudio(content) {
    return this._multimodalHandler.extractMediaUrls(content, 'audio');
  }

  extractVideo(content) {
    return this._multimodalHandler.extractMediaUrls(content, 'video');
  }

  processMultimedia(content) {
    return this._multimodalHandler.processContent(content);
  }

  renderVideoEmbed(url, options = {}) {
    return this._multimodalHandler.renderVideoEmbed(url, options);
  }

  getMediaCacheSize() {
    return this._multimodalHandler.getCacheSize();
  }

  clearMediaCache() {
    this._multimodalHandler.clearCache();
  }

  scoreQuality(content, context = {}) {
    return this._qualityScorer.score(content, context);
  }

  async scoreQualityAsync(content, context = {}) {
    return this._qualityScorer.scoreAsync(content, context);
  }

  getQualityWeights() {
    return this._qualityScorer.getWeights();
  }

  setQualityWeights(weights) {
    this._qualityScorer.setWeights(weights);
    return this;
  }

  detectContradictions(content) {
    return this._qualityScorer._detectContradictions(content);
  }

  detectToxicity(content) {
    return this._qualityScorer.scoreToxicity(content);
  }

  getCachedResponse(request) {
    return this._responseCache.get(request);
  }

  cacheResponse(request, response, options = {}) {
    return this._responseCache.set(request, response, options);
  }

  hasCachedResponse(request) {
    return this._responseCache.has(request);
  }

  invalidateCache(request) {
    return this._responseCache.invalidate(request);
  }

  invalidateCacheByTag(tag) {
    return this._responseCache.invalidateByTag(tag);
  }

  clearCache() {
    return this._responseCache.clear();
  }

  getCacheStats() {
    return this._responseCache.getStats();
  }

  pruneCache() {
    return this._responseCache.prune();
  }

  setCacheConfig(config) {
    if (config.maxSize) this._responseCache.setMaxSize(config.maxSize);
    if (config.maxMemory) this._responseCache.setMaxMemory(config.maxMemory);
    if (config.defaultTtl) this._responseCache.setDefaultTtl(config.defaultTtl);
    if (config.evictionPolicy) this._responseCache.setEvictionPolicy(config.evictionPolicy);
    return this;
  }

  async processResponse(request, responseContent, options = {}) {
    const { 
      validate = true,
      score = true,
      cache = true,
      schema = this._outputSchema,
      context = {},
      tags = [],
      autoRetry = false,
      maxRetries = 3,
      minQualityThreshold = 0.5,
      retryDelay = 1000
    } = options;

    const result = {
      content: responseContent,
      fromCache: false,
      cacheKey: null,
      validation: null,
      quality: null,
      cachedAt: null,
      ttl: null,
      retryCount: 0,
      retryHistory: []
    };

    if (cache) {
      const cacheKey = this._responseCache._hashRequest(request);
      result.cacheKey = cacheKey;
    }

    if (validate && schema) {
      const validationResult = await this._outputValidator.validateWithRetry(responseContent, schema);
      result.validation = {
        valid: validationResult.success,
        errors: validationResult.errors || [],
        warnings: validationResult.warnings || [],
        fixed: validationResult.fixed || false,
        attempts: validationResult.attempts || 1
      };
    }

    if (score) {
      const qualityResult = this._qualityScorer.score(responseContent, context);
      result.quality = {
        overall: qualityResult.overall,
        grade: qualityResult.grade,
        relevance: qualityResult.relevance,
        completeness: qualityResult.completeness,
        consistency: qualityResult.consistency,
        hallucinationResistance: qualityResult.hallucinationResistance,
        toxicity: qualityResult.toxicity,
        faithfulness: qualityResult.faithfulness,
        factuality: qualityResult.factuality,
        coherence: qualityResult.coherence,
        conciseness: qualityResult.conciseness,
        flags: qualityResult.flags,
        details: qualityResult.details
      };

      if (result.validation && !result.validation.valid) {
        result.quality.suspicious = true;
        result.quality.suspiciousReason = 'validation_failed';
      } else if (qualityResult.overall < minQualityThreshold) {
        result.quality.suspicious = true;
        result.quality.suspiciousReason = 'low_quality_score';
      }
    }

    if (cache && result.content) {
      const cacheOptions = {
        tags,
        adaptiveTtl: true,
        metadata: {
          requestHash: result.cacheKey,
          validationPassed: result.validation?.valid ?? true,
          ...(result.quality && { 
            qualityScore: result.quality.overall,
            qualityGrade: result.quality.grade
          })
        }
      };

      this._responseCache.setWithQuality(request, responseContent, result.quality?.overall || 0.7, cacheOptions);
      
      const cacheEntry = this._responseCache._storage.get(this._responseCache._hashRequest(request));
      if (cacheEntry) {
        result.cachedAt = cacheEntry.createdAt;
        result.ttl = cacheEntry.ttl;
      }
    }

    return result;
  }

  async processResponseWithRetry(request, apiCallFn, options = {}) {
    const {
      autoRetry = true,
      maxRetries = 3,
      minQualityThreshold = options.minQualityThreshold || 0.5,
      retryDelay = options.retryDelay || 1000,
      validate = true,
      score = true,
      cache = true,
      schema = this._outputSchema,
      context = {},
      tags = []
    } = options;

    let attempts = 0;
    let lastResult = null;
    const retryHistory = [];

    while (attempts < maxRetries) {
      attempts++;
      
      let responseContent;
      if (attempts === 1) {
        const cached = this._responseCache.getWithQuality(request);
        if (cached && !options.forceRefresh) {
          return {
            ...cached,
            fromCache: true,
            response: cached.response,
            quality: cached.qualityScore ? { overall: cached.qualityScore } : null
          };
        }
      }

      try {
        responseContent = await apiCallFn();
      } catch (error) {
        retryHistory.push({
          attempt: attempts,
          error: error.message,
          quality: null,
          success: false
        });

        if (attempts < maxRetries) {
          await new Promise(r => setTimeout(r, retryDelay * attempts));
          continue;
        }

        return {
          content: null,
          error: error.message,
          retryCount: attempts - 1,
          retryHistory,
          success: false
        };
      }

      const result = await this.processResponse(request, responseContent, {
        validate,
        score,
        cache,
        schema,
        context,
        tags
      });

      result.retryCount = attempts - 1;
      result.retryHistory = retryHistory;

      const needsRetry = autoRetry && (
        (result.validation && !result.validation.valid) ||
        (result.quality && result.quality.overall < minQualityThreshold)
      );

      retryHistory.push({
        attempt: attempts,
        quality: result.quality?.overall,
        validationPassed: result.validation?.valid ?? true,
        suspicious: result.quality?.suspicious ?? false,
        success: true
      });

      if (!needsRetry) {
        return {
          ...result,
          retryCount: attempts - 1,
          retryHistory
        };
      }

      if (attempts < maxRetries) {
        await new Promise(r => setTimeout(r, retryDelay * attempts));
      }

      lastResult = result;
    }

    return {
      ...lastResult,
      retryCount: attempts - 1,
      retryHistory,
      success: false,
      finalAttempt: true
    };
  }

  selfHealResponse(request, responseContent, options = {}) {
    const { schema = this._outputSchema, qualityThreshold = 0.5 } = options;
    
    const healingStrategies = [
      { name: 'trimWhitespace', fn: (c) => c.trim() },
      { name: 'fixJsonFormat', fn: (c) => {
        const extracted = this._outputValidator.extractJson(c);
        return extracted.success ? JSON.stringify(extracted.data, null, 2) : c;
      }},
      { name: 'removeMarkdown', fn: (c) => c.replace(/```json\n?/gi, '').replace(/```\n?$/gi, '').trim() },
      { name: 'extractCoreContent', fn: (c) => {
        const match = c.match(/\{[\s\S]*\}/);
        return match ? match[0] : c;
      }}
    ];

    const results = [];
    
    for (const strategy of healingStrategies) {
      try {
        const healed = strategy.fn(responseContent);
        const validation = this._outputValidator.validate(healed, schema);
        const qualityScore = this._qualityScorer.score(healed, {});
        
        results.push({
          strategy: strategy.name,
          valid: validation.valid,
          quality: qualityScore.overall,
          improved: qualityScore.overall > (results[0]?.quality || 0)
        });

        if (validation.valid && qualityScore.overall >= qualityThreshold) {
          return {
            success: true,
            originalContent: responseContent,
            healedContent: healed,
            strategy: strategy.name,
            quality: qualityScore.overall,
            validation: validation.valid
          };
        }
      } catch (e) {
        results.push({
          strategy: strategy.name,
          error: e.message,
          valid: false,
          quality: 0,
          improved: false
        });
      }
    }

    return {
      success: false,
      originalContent: responseContent,
      healedContent: null,
      strategy: null,
      attempts: results,
      bestStrategy: results.reduce((best, r) => r.quality > (best?.quality || 0) ? r : best, null)
    };
  }

  prefetchAndCache(requests, fetchFn, options = {}) {
    const { batchSize = 5, priority = 'high' } = options;
    
    const prefetchResults = {
      successful: [],
      failed: [],
      skipped: [],
      total: requests.length
    };

    const cached = new Map();
    for (const req of requests) {
      if (this._responseCache.has(req)) {
        cached.set(this._hashRequest(req), req);
        prefetchResults.skipped.push({ request: req, reason: 'already_cached' });
      }
    }

    const uncached = requests.filter(req => !cached.has(this._hashRequest(req)));

    const processBatch = async (batch) => {
      const promises = batch.map(async (req) => {
        try {
          const response = await fetchFn(req);
          this._responseCache.set(req, response);
          prefetchResults.successful.push({ request: req });
          return { success: true, request: req };
        } catch (error) {
          prefetchResults.failed.push({ request: req, error: error.message });
          return { success: false, request: req, error: error.message };
        }
      });
      return Promise.all(promises);
    };

    for (let i = 0; i < uncached.length; i += batchSize) {
      const batch = uncached.slice(i, i + batchSize);
      processBatch(batch);
    }

    return {
      ...prefetchResults,
      cacheHitRate: Math.round((prefetchResults.skipped.length / prefetchResults.total) * 100) / 100,
      estimatedSavings: `${prefetchResults.skipped.length} cached responses saved`
    };
  }

  _hashRequest(req) {
    return this._responseCache._hashRequest(req);
  }

  getSelfHealingStats() {
    const cacheStats = this._responseCache.getStats();
    const qualityStats = this._responseCache.getQualityStats();

    return {
      cacheHitRate: cacheStats.hitRate,
      qualityDistribution: qualityStats.gradeDistribution,
      highQualityCount: qualityStats.highQualityCount,
      lowQualityCount: qualityStats.lowQualityCount,
      suspiciousCount: qualityStats.suspiciousCount,
      recommendation: this._generateSelfHealingRecommendation(qualityStats)
    };
  }

  _generateSelfHealingRecommendation(stats) {
    if (stats.lowQualityCount > stats.highQualityCount) {
      return 'Consider lowering quality threshold or improving prompt engineering. High number of low-quality cached responses detected.';
    }
    if (stats.suspiciousCount > 0) {
      return 'Some cached responses are flagged as suspicious. Review validation rules or increase retry attempts.';
    }
    return 'Cache quality looks healthy. Continue monitoring for any degradation.';
  }

  intelligentCacheInvalidation(pattern, reason) {
    const invalidationLog = {
      timestamp: Date.now(),
      pattern,
      reason,
      invalidated: 0
    };

    if (pattern === '*' || pattern === '**') {
      invalidationLog.invalidated = this._responseCache.clear();
    } else {
      invalidationLog.invalidated = this._responseCache.invalidateByPattern(pattern);
    }

    this._lastInvalidation = invalidationLog;

    return {
      ...invalidationLog,
      currentStats: this._responseCache.getStats()
    };
  }

  async getFromCacheOrProcess(request, apiCallFn, options = {}) {
    const cached = this._responseCache.getWithQuality(request);
    
    if (cached && !options.forceRefresh) {
      return {
        ...cached,
        fromCache: true,
        response: cached.response
      };
    }

    const responseContent = await apiCallFn();
    const result = await this.processResponse(request, responseContent, options);
    
    return {
      ...result,
      fromCache: false,
      response: responseContent
    };
  }

  getCacheWithQuality(request) {
    return this._responseCache.getWithQuality(request);
  }

  getQualityStats() {
    return this._responseCache.getQualityStats();
  }

  getHighQualityCache(minScore = 0.8) {
    return this._responseCache.getHighQualityEntries(minScore);
  }

  getLowQualityCache(maxScore = 0.5) {
    return this._responseCache.getLowQualityEntries(maxScore);
  }

  invalidateLowQualityCache(maxScore = 0.3) {
    return this._responseCache.invalidateLowQuality(maxScore);
  }

  setValidationSchema(schema) {
    this._streamingValidator.setSchema(schema);
    return this;
  }

  async *validateStream(stream, schema) {
    const validator = new StreamingValidator();
    validator.setSchema(schema || this._outputSchema);
    yield* validator.validateStream(stream, schema || this._outputSchema);
  }

  validateChunk(chunk, isLast = false) {
    return this._streamingValidator.validateChunk(chunk, isLast);
  }

  abortValidation() {
    return this._streamingValidator.abort();
  }

  getValidationStatus() {
    return this._streamingValidator.getStatus();
  }

  resetStreamingValidator() {
    this._streamingValidator.reset();
    return this;
  }

  safe(fn, options = {}) {
    return this._safety.wrap(fn, {
      timeout: options.timeout || 30000,
      fallback: options.fallback,
      name: options.name || fn.name || 'operation'
    });
  }

  safeSync(fn, options = {}) {
    return this._safety.wrapSync(fn, {
      fallback: options.fallback,
      name: options.name || fn.name || 'operation'
    });
  }

  safeAsync(fn, options = {}) {
    return this._safety.wrap(fn, {
      timeout: options.timeout || 30000,
      fallback: options.fallback,
      name: options.name || fn.name || 'async_operation'
    });
  }

  raceWithTimeout(promise, ms = null) {
    return this._safety.raceWithTimeout(promise, ms || this._safety._defaultTimeout);
  }

  getSafetyStats() {
    return {
      circuitBreaker: this._safety.getCircuitBreakerStatus(),
      errorLogSize: this._safety._errorLog.length,
      recentErrors: this._safety.getErrorLog(10)
    };
  }

  resetSafetyCircuits(name = null) {
    this._safety.resetCircuitBreaker(name);
    return this;
  }

  static createWithSafety(agentId, config = {}) {
    const session = new AgentSession(agentId, config);
    return createSafetyProxy(session);
  }
}

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
          console.error(`[SafetyProxy] ${opName} failed: ${error.message}`);

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

export function createSafeAgentSession(agentId, config = {}) {
  const session = new AgentSession(agentId, config);
  return createSafetyProxy(session);
}
