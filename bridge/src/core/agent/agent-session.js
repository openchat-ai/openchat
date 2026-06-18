import { messageBus, MESSAGE_TYPES } from '../message-bus.js';
import { configRepo } from '../repositories/config-repo.js';
import * as providerService from '../provider-service.js';
import { EvolutionEngine } from '../evolution/evolution-engine.js';
import { securityManager } from '../security/security-manager.js';
import { ResponseParser } from '../quality/response-parser.js';
import { ErrorClassifier } from '../security/error-classifier.js';
import { ContentAnalyzer } from '../quality/content-analyzer.js';
import { QualityScorer } from '../quality/quality-scorer.js';
import { StructuredOutputValidator } from '../security/structured-output-validator.js';
import { StreamingValidator, ValidationErrorExplainer } from '../security/streaming-validator.js';
import { HttpExecutor } from './agent-http-executor.js';
import { SchemaAutoGenerator, SchemaVersionManager, FormatConverter } from '../quality/schema-manager.js';
import { MultimodalHandler } from '../audio/multimodal-handler.js';
import { ResponseCache, SmartRouter, StreamHandler, SafetyWrapper, CircuitBreakerMonitor, MetricsCollector, AdaptiveLimiter, IntelligentCircuitBreaker, CircuitBreaker, RequestQueue, RequestDeduplicator } from '../monitoring/resilience.js';
import logger from '../monitoring/logger.js';
import { createSafetyProxy, createSafeAgentSession } from './agent-safety-proxy.js';
import { AgentResponseProcessor } from './agent-response-processor.js';

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
    const currentProvider = configRepo.getCurrentProvider();
    this.agentId = agentId;
    this.config = {
      name: config.name || `agent-${agentId.substring(0, 8)}`,
      provider: config.provider || currentProvider || providerService.DEFAULT_PROVIDER,
      model: config.model || configRepo.getCurrentModel() || null,
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
    
    const providers = configRepo.listProviders();
    for (const p of providers) {
      const pConfig = providerService.getProviderConfig(p);
      if (pConfig) {
        const apiKey = configRepo.getApiKey(p);
        this._router.registerProvider(p, { ...pConfig, apiKey: apiKey || pConfig.apiKey });
      }
    }

    this._httpExecutor = new HttpExecutor({
      agentId,
      config: this.config,
      circuitBreaker: this._circuitBreaker,
      responseParser: this._responseParser,
      errorClassifier: this._errorClassifier,
      metrics: this._metrics,
      router: this._router,
      limiter: this._limiter,
      deduplicator: this._deduplicator,
      requestQueue: this._requestQueue,
      isDestroyed: () => this._isDestroyed
    });

    this._responseProcessor = new AgentResponseProcessor({
      responseCache: this._responseCache,
      outputValidator: this._outputValidator,
      qualityScorer: this._qualityScorer,
      streamingValidator: this._streamingValidator,
      safety: this._safety,
      multimodalHandler: this._multimodalHandler,
      limiter: this._limiter
    });
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
        logger.error(`[Agent ${this.config.name}] Heartbeat error: ${error.message}`);
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
      logger.error(`[Agent ${this.config.name}] Error handling message: ${error.message}`);
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
    logger.info(`[Agent ${this.config.name}] Received terminate signal`);
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
    let apiKey = configRepo.getApiKey(providerName);
    let model = this.config.model;

    // 如果配置的 provider 没有 API key，尝试其他 providers
    if (!apiKey) {
      const availableProviders = configRepo.listProviders();
      for (const p of availableProviders) {
        const key = configRepo.getApiKey(p);
        if (key) {
          providerName = p;
          apiKey = key;
          model = null; // provider 变了，model 要重新获取
          break;
        }
      }
    }

    // Phase B: 无 API key → 自动回退到 Ollama（skipAuth，本地模型）
    if (!apiKey) {
      const ollamaConfig = providerService.getProviderConfig('ollama');
      if (ollamaConfig) {
        logger.info('[Agent] API key 未配置，自动回退到 Ollama');
        providerName = 'ollama';
        model = ollamaConfig.defaultModel || 'llama3';
        apiKey = ''; // skipAuth 不需要 key
      }
    }

    if (!apiKey && providerName !== 'ollama') {
      return { content: 'No API key configured. Please set: config set <provider> <api_key>' };
    }

    const providerConfig = providerService.getProviderConfig(providerName);
    if (!providerConfig) {
      return { content: `Unsupported provider: ${providerName}` };
    }

    if (!model) {
      model = providerConfig.defaultModel;
    }

    // 让 persistentConfig 解析模型名（处理显示名称 → API key 的映射）
    model = configRepo.resolveModelName(providerName, model) || model;

    return this.callApi(providerName, apiKey, model, messages);
  }

  async callApi(provider, apiKey, model, messages) {
    return this._httpExecutor.callApi(provider, apiKey, model, messages);
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
      model: this.config.model || providerService.getDefaultModel(this.config.provider),
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
    return this._responseProcessor.setOutputSchema(schema);
  }

  inferOutputSchema(examples) {
    return this._responseProcessor.inferOutputSchema(examples);
  }

  validateOutput(content, schema = this._outputSchema) {
    return this._responseProcessor.validateOutput(content, schema);
  }

  extractStructuredJson(content) {
    return this._responseProcessor.extractStructuredJson(content);
  }

  getValidatorConfig() {
    return this._responseProcessor.getValidatorConfig();
  }

  detectMedia(content) {
    return this._responseProcessor.detectMedia(content);
  }

  extractImages(content) {
    return this._responseProcessor.extractImages(content);
  }

  extractAudio(content) {
    return this._responseProcessor.extractAudio(content);
  }

  extractVideo(content) {
    return this._responseProcessor.extractVideo(content);
  }

  processMultimedia(content) {
    return this._responseProcessor.processMultimedia(content);
  }

  renderVideoEmbed(url, options = {}) {
    return this._responseProcessor.renderVideoEmbed(url, options);
  }

  getMediaCacheSize() {
    return this._responseProcessor.getMediaCacheSize();
  }

  clearMediaCache() {
    this._responseProcessor.clearMediaCache();
  }

  scoreQuality(content, context = {}) {
    return this._responseProcessor.scoreQuality(content, context);
  }

  scoreQualityAsync(content, context = {}) {
    return this._responseProcessor.scoreQualityAsync(content, context);
  }

  getQualityWeights() {
    return this._responseProcessor.getQualityWeights();
  }

  setQualityWeights(weights) {
    this._responseProcessor.setQualityWeights(weights);
    return this;
  }

  detectContradictions(content) {
    return this._responseProcessor.detectContradictions(content);
  }

  detectToxicity(content) {
    return this._responseProcessor.detectToxicity(content);
  }

  getCachedResponse(request) {
    return this._responseProcessor.getCachedResponse(request);
  }

  cacheResponse(request, response, options = {}) {
    return this._responseProcessor.cacheResponse(request, response, options);
  }

  hasCachedResponse(request) {
    return this._responseProcessor.hasCachedResponse(request);
  }

  invalidateCache(request) {
    return this._responseProcessor.invalidateCache(request);
  }

  invalidateCacheByTag(tag) {
    return this._responseProcessor.invalidateCacheByTag(tag);
  }

  clearCache() {
    return this._responseProcessor.clearCache();
  }

  getCacheStats() {
    return this._responseProcessor.getCacheStats();
  }

  pruneCache() {
    return this._responseProcessor.pruneCache();
  }

  setCacheConfig(config) {
    this._responseProcessor.setCacheConfig(config);
    return this;
  }

  async processResponse(request, responseContent, options = {}) {
    return this._responseProcessor.processResponse(request, responseContent, options);
  }

  async processResponseWithRetry(request, apiCallFn, options = {}) {
    return this._responseProcessor.processResponseWithRetry(request, apiCallFn, options);
  }

  selfHealResponse(request, responseContent, options = {}) {
    return this._responseProcessor.selfHealResponse(request, responseContent, options);
  }

  prefetchAndCache(requests, fetchFn, options = {}) {
    return this._responseProcessor.prefetchAndCache(requests, fetchFn, options);
  }

  _hashRequest(req) {
    return this._responseProcessor._hashRequest(req);
  }

  getSelfHealingStats() {
    return this._responseProcessor.getSelfHealingStats();
  }

  intelligentCacheInvalidation(pattern, reason) {
    return this._responseProcessor.intelligentCacheInvalidation(pattern, reason);
  }

  getFromCacheOrProcess(request, apiCallFn, options = {}) {
    return this._responseProcessor.getFromCacheOrProcess(request, apiCallFn, options);
  }

  getCacheWithQuality(request) {
    return this._responseProcessor.getCacheWithQuality(request);
  }

  getQualityStats() {
    return this._responseProcessor.getQualityStats();
  }

  getHighQualityCache(minScore = 0.8) {
    return this._responseProcessor.getHighQualityCache(minScore);
  }

  getLowQualityCache(maxScore = 0.5) {
    return this._responseProcessor.getLowQualityCache(maxScore);
  }

  invalidateLowQualityCache(maxScore = 0.3) {
    return this._responseProcessor.invalidateLowQualityCache(maxScore);
  }

  setValidationSchema(schema) {
    this._responseProcessor.setValidationSchema(schema);
    return this;
  }

  async *validateStream(stream, schema) {
    yield* this._responseProcessor.validateStream(stream, schema);
  }

  validateChunk(chunk, isLast = false) {
    return this._responseProcessor.validateChunk(chunk, isLast);
  }

  abortValidation() {
    return this._responseProcessor.abortValidation();
  }

  getValidationStatus() {
    return this._responseProcessor.getValidationStatus();
  }

  resetStreamingValidator() {
    this._responseProcessor.resetStreamingValidator();
    return this;
  }

  safe(fn, options = {}) {
    return this._responseProcessor.safe(fn, options);
  }

  safeSync(fn, options = {}) {
    return this._responseProcessor.safeSync(fn, options);
  }

  safeAsync(fn, options = {}) {
    return this._responseProcessor.safeAsync(fn, options);
  }

  raceWithTimeout(promise, ms = null) {
    return this._responseProcessor.raceWithTimeout(promise, ms);
  }

  getSafetyStats() {
    return this._responseProcessor.getSafetyStats();
  }

  resetSafetyCircuits(name = null) {
    this._responseProcessor.resetSafetyCircuits(name);
    return this;
  }

  static createWithSafety(agentId, config = {}) {
    const session = new AgentSession(agentId, config);
    return createSafetyProxy(session);
  }
}

export { createSafetyProxy, createSafeAgentSession };
