import logger from '../logger.js';
/**
 * 弹性组件
 * 包含响应缓存、智能路由、流处理器、安全包装器
 */

export class ResponseCache {
  constructor(options = {}) {
    this._maxSize = options.maxSize || 500;
    this._defaultTtl = options.defaultTtl || 3600000;
    this._maxMemory = options.maxMemory || 50 * 1024 * 1024;
    this._evictionPolicy = options.evictionPolicy || 'lru';
    this._storage = new Map();
    this._accessOrder = [];
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  _generateKey(request) {
    const str = JSON.stringify(request, Object.keys(request).sort());
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  set(request, response, options = {}) {
    const key = this._generateKey(request);
    const ttl = options.ttl || this._defaultTtl;

    // Check memory limit
    const responseSize = this._estimateSize(response);
    if (responseSize > this._maxMemory * 0.1) {
      return false; // Don't cache very large responses
    }

    // Evict if necessary
    while (this._storage.size >= this._maxSize || this._getTotalMemory() + responseSize > this._maxMemory) {
      this._evict();
    }

    this._storage.set(key, {
      response,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      size: responseSize,
      hits: 0
    });

    if (this._evictionPolicy === 'lru') {
      this._accessOrder.push(key);
    }

    return true;
  }

  get(request) {
    const key = this._generateKey(request);
    const entry = this._storage.get(key);

    if (!entry) {
      this._misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this._storage.delete(key);
      this._misses++;
      return null;
    }

    entry.hits++;

    if (this._evictionPolicy === 'lru') {
      const index = this._accessOrder.indexOf(key);
      if (index > -1) {
        this._accessOrder.splice(index, 1);
        this._accessOrder.push(key);
      }
    }

    this._hits++;
    return entry.response;
  }

  has(request) {
    const key = this._generateKey(request);
    const entry = this._storage.get(key);
    return entry && Date.now() <= entry.expiresAt;
  }

  invalidate(request) {
    const key = this._generateKey(request);
    if (this._storage.has(key)) {
      this._storage.delete(key);
      const index = this._accessOrder.indexOf(key);
      if (index > -1) {
        this._accessOrder.splice(index, 1);
      }
      return true;
    }
    return false;
  }

  _evict() {
    if (this._storage.size === 0) return;

    let keyToEvict;

    if (this._evictionPolicy === 'lru' && this._accessOrder.length > 0) {
      keyToEvict = this._accessOrder.shift();
    } else if (this._evictionPolicy === 'lfu') {
      let minHits = Infinity;
      for (const [key, entry] of this._storage) {
        if (entry.hits < minHits) {
          minHits = entry.hits;
          keyToEvict = key;
        }
      }
    } else {
      keyToEvict = this._storage.keys().next().value;
    }

    if (keyToEvict) {
      this._storage.delete(keyToEvict);
      this._evictions++;
    }
  }

  _estimateSize(obj) {
    return JSON.stringify(obj).length * 2; // Rough estimate in bytes
  }

  _getTotalMemory() {
    let total = 0;
    for (const entry of this._storage.values()) {
      total += entry.size;
    }
    return total;
  }

  clear() {
    this._storage.clear();
    this._accessOrder = [];
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  getStats() {
    const total = this._hits + this._misses;
    return {
      size: this._storage.size,
      maxSize: this._maxSize,
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? this._hits / total : 0,
      evictions: this._evictions,
      memoryUsage: this._getTotalMemory(),
      maxMemory: this._maxMemory
    };
  }

  prune() {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, entry] of this._storage) {
      if (entry.expiresAt <= now) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this._storage.delete(key);
      const index = this._accessOrder.indexOf(key);
      if (index > -1) {
        this._accessOrder.splice(index, 1);
      }
    }

    return expiredKeys.length;
  }
}

export class SmartRouter {
  constructor(options = {}) {
    this._defaultProvider = options.defaultProvider || null;
    this._providers = new Map();
    this._routes = [];
    this._metrics = new Map();
  }

  registerProvider(name, config) {
    this._providers.set(name, {
      name,
      ...config,
      registeredAt: Date.now(),
      requestCount: 0,
      errorCount: 0,
      avgLatency: 0
    });
  }

  addRoute(rule) {
    this._routes.push({
      pattern: rule.pattern,
      provider: rule.provider,
      priority: rule.priority || 0,
      condition: rule.condition || null
    });
    this._routes.sort((a, b) => b.priority - a.priority);
  }

  route(request) {
    // Check custom routes first
    for (const route of this._routes) {
      if (this._matchRoute(request, route)) {
        return route.provider;
      }
    }

    // Use default provider
    if (this._defaultProvider) {
      return this._defaultProvider;
    }

    // Find best available provider
    return this._selectBestProvider();
  }

  _matchRoute(request, route) {
    if (route.pattern) {
      const pattern = typeof route.pattern === 'string'
        ? new RegExp(route.pattern, 'i')
        : route.pattern;

      if (!pattern.test(request.prompt || request.message || '')) {
        return false;
      }
    }

    if (route.condition && typeof route.condition === 'function') {
      return route.condition(request);
    }

    return true;
  }

  _selectBestProvider() {
    let best = null;
    let bestScore = -Infinity;

    for (const [name, provider] of this._providers) {
      if (!provider.enabled) continue;

      const score = this._calculateProviderScore(provider);
      if (score > bestScore) {
        bestScore = score;
        best = name;
      }
    }

    return best;
  }

  _calculateProviderScore(provider) {
    const errorRate = provider.requestCount > 0
      ? provider.errorCount / provider.requestCount
      : 0;

    const latencyScore = provider.avgLatency > 0
      ? 1000 / provider.avgLatency
      : 1;

    return (1 - errorRate) * 0.7 + latencyScore * 0.3;
  }

  recordMetrics(provider, latency, success) {
    const p = this._providers.get(provider);
    if (!p) return;

    p.requestCount++;

    if (!success) {
      p.errorCount++;
    }

    // Update average latency
    p.avgLatency = p.avgLatency === 0
      ? latency
      : (p.avgLatency * 0.9 + latency * 0.1);
  }

  getProviderStats() {
    const stats = {};
    for (const [name, provider] of this._providers) {
      stats[name] = {
        requestCount: provider.requestCount,
        errorCount: provider.errorCount,
        errorRate: provider.requestCount > 0
          ? provider.errorCount / provider.requestCount
          : 0,
        avgLatency: provider.avgLatency
      };
    }
    return stats;
  }

  setDefaultProvider(name) {
    if (this._providers.has(name)) {
      this._defaultProvider = name;
    }
  }

  /**
   * Record a successful API call
   * @param {string} name Provider name
   * @param {number} latency Response time in ms
   */
  recordSuccess(name, latency) {
    const provider = this._providers.get(name);
    if (provider) {
      provider.requestCount = (provider.requestCount || 0) + 1;
      provider.avgLatency = provider.avgLatency
        ? (provider.avgLatency + latency) / 2
        : latency;
    }
  }

  /**
   * Record a failed API call
   * @param {string} name Provider name
   * @param {number} statusCode HTTP status code
   * @param {number} latency Response time in ms
   */
  recordFailure(name, statusCode, latency) {
    const provider = this._providers.get(name);
    if (provider) {
      provider.requestCount = (provider.requestCount || 0) + 1;
      provider.errorCount = (provider.errorCount || 0) + 1;
    }
  }
}

export class StreamHandler {
  constructor(options = {}) {
    this._onChunk = options.onChunk || null;
    this._onComplete = options.onComplete || null;
    this._onError = options.onError || null;
    this._buffer = '';
    this._decoder = new TextDecoder();
  }

  async handle(response) {
    const reader = response.body.getReader();
    const chunks = [];

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = this._decoder.decode(value, { stream: true });
        chunks.push(chunk);

        if (this._onChunk) {
          this._onChunk(chunk);
        }

        this._buffer += chunk;
      }

      const fullContent = this._buffer;

      if (this._onComplete) {
        this._onComplete(fullContent);
      }

      return { success: true, content: fullContent, chunks };
    } catch (error) {
      if (this._onError) {
        this._onError(error);
      }
      return { success: false, error: error.message };
    }
  }

  reset() {
    this._buffer = '';
  }

  getBuffer() {
    return this._buffer;
  }

  parseSSE(chunk) {
    const lines = chunk.split('\n');
    const events = [];

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          events.push({ type: 'done' });
        } else {
          try {
            events.push({ type: 'data', content: JSON.parse(data) });
          } catch (e) {
            events.push({ type: 'data', content: data });
          }
        }
      }
    }

    return events;
  }
}

export class SafetyWrapper {
  constructor(options = {}) {
    this._defaultTimeout = options.defaultTimeout || 30000;
    this._maxTimeout = options.maxTimeout || 300000;
    this._enableFallback = options.enableFallback !== false;
    this._errorLog = [];
    this._maxErrorLogSize = options.maxErrorLogSize || 1000;
    this._circuitBreaker = options.circuitBreaker || null;
  }

  async wrap(fn, options = {}) {
    const timeout = Math.min(
      options.timeout || this._defaultTimeout,
      this._maxTimeout
    );

    const fallback = options.fallback || (this._enableFallback ? null : undefined);

    try {
      // Check circuit breaker
      if (this._circuitBreaker && !this._circuitBreaker.canExecute()) {
        throw new Error('Circuit breaker is open');
      }

      const result = await this._withTimeout(fn, timeout);

      if (this._circuitBreaker) {
        this._circuitBreaker.recordSuccess();
      }

      return result;
    } catch (error) {
      this._logError(error, options);

      if (this._circuitBreaker) {
        this._circuitBreaker.recordFailure();
      }

      if (fallback !== undefined) {
        return typeof fallback === 'function' ? fallback(error) : fallback;
      }

      throw error;
    }
  }

  async _withTimeout(fn, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);

      Promise.resolve(fn())
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  _logError(error, context = {}) {
    this._errorLog.push({
      timestamp: Date.now(),
      message: error.message,
      stack: error.stack,
      context
    });

    if (this._errorLog.length > this._maxErrorLogSize) {
      this._errorLog.shift();
    }
  }

  getErrorLog() {
    return [...this._errorLog];
  }

  clearErrorLog() {
    this._errorLog = [];
  }

  getStats() {
    return {
      totalErrors: this._errorLog.length,
      recentErrors: this._errorLog.slice(-10)
    };
  }
}

export class CircuitBreakerMonitor {
  constructor(options = {}) {
    this._states = new Map();
    this._options = options;
  }

  register(name, breaker) {
    this._states.set(name, {
      breaker,
      status: 'closed',
      failures: 0,
      successes: 0,
      lastFailure: null,
      lastSuccess: null
    });
  }

  getStatus(name) {
    const state = this._states.get(name);
    if (!state) return null;

    return {
      status: state.status,
      failures: state.failures,
      successes: state.successes,
      lastFailure: state.lastFailure,
      lastSuccess: state.lastSuccess
    };
  }

  updateStatus(name, status) {
    const state = this._states.get(name);
    if (state) {
      state.status = status;
    }
  }

  recordFailure(name) {
    const state = this._states.get(name);
    if (state) {
      state.failures++;
      state.lastFailure = Date.now();
    }
  }

  recordSuccess(name) {
    const state = this._states.get(name);
    if (state) {
      state.successes++;
      state.lastSuccess = Date.now();
    }
  }

  reset(name) {
    const state = this._states.get(name);
    if (state) {
      state.status = 'closed';
      state.failures = 0;
      state.successes = 0;
    }
  }

  getAllStatuses() {
    const statuses = {};
    for (const [name, state] of this._states.entries()) {
      statuses[name] = { ...state };
    }
    return statuses;
  }
}

export class MetricsCollector {
  constructor(options = {}) {
    this._windowSize = options.windowSize || 60000;
    this._maxMetrics = options.maxMetrics || 10000;
    this._requests = [];
    this._errors = [];
    this._latencies = [];
    this._statusCodes = new Map();
  }

  _cleanOld() {
    const now = Date.now();
    const cutoff = now - this._windowSize;
    
    this._requests = this._requests.filter(r => r.timestamp > cutoff);
    this._errors = this._errors.filter(e => e.timestamp > cutoff);
    this._latencies = this._latencies.filter(l => l.timestamp > cutoff);
  }

  recordRequest(success, latency, statusCode, errorType) {
    const now = Date.now();
    
    this._requests.push({ timestamp: now, success });
    this._latencies.push({ timestamp: now, value: latency });
    
    if (statusCode) {
      const count = this._statusCodes.get(statusCode) || 0;
      this._statusCodes.set(statusCode, count + 1);
    }
    
    if (!success) {
      this._errors.push({ timestamp: now, type: errorType, statusCode });
    }
    
    if (this._requests.length > this._maxMetrics) {
      this._cleanOld();
    }
  }

  getStats() {
    this._cleanOld();
    
    const total = this._requests.length;
    if (total === 0) {
      return {
        total: 0,
        success: 0,
        failure: 0,
        successRate: 1,
        avgLatency: 0,
        p95Latency: 0,
        qps: 0,
        errorBreakdown: {}
      };
    }
    
    const success = this._requests.filter(r => r.success).length;
    const failure = total - success;
    const successRate = success / total;
    
    const sortedLatencies = [...this._latencies].sort((a, b) => a.value - b.value);
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p95Latency = sortedLatencies[p95Index]?.value || 0;
    const avgLatency = this._latencies.reduce((sum, l) => sum + l.value, 0) / this._latencies.length;
    
    const qps = total / (this._windowSize / 1000);
    
    const errorBreakdown = {};
    for (const [code, count] of this._statusCodes.entries()) {
      errorBreakdown[code] = count;
    }
    
    return {
      total,
      success,
      failure,
      successRate: Math.round(successRate * 100) / 100,
      avgLatency: Math.round(avgLatency),
      p95Latency: Math.round(p95Latency),
      qps: Math.round(qps * 100) / 100,
      errorBreakdown
    };
  }

  getHealthScore() {
    const stats = this.getStats();
    
    if (stats.total < 10) return 1;
    
    let score = stats.successRate * 0.5;
    
    if (stats.p95Latency < 5000) score += 0.3;
    else if (stats.p95Latency < 10000) score += 0.15;
    
    if (stats.qps > 0.5) score += 0.2;
    
    return Math.min(1, Math.max(0, score));
  }

  clear() {
    this._requests = [];
    this._errors = [];
    this._latencies = [];
    this._statusCodes.clear();
  }
}

export class AdaptiveLimiter {
  constructor(options = {}) {
    this._minConcurrent = options.minConcurrent || 1;
    this._maxConcurrent = options.maxConcurrent || 5;
    this._currentConcurrent = options.initialConcurrent || 2;
    this._minInterval = options.minInterval || 100;
    this._maxInterval = options.maxInterval || 5000;
    this._currentInterval = options.initialInterval || 500;
    
    this._metrics = null;
    this._adjustCooldown = 0;
    this._lastAdjustTime = 0;
  }

  setMetrics(metrics) {
    this._metrics = metrics;
  }

  shouldThrottle() {
    if (!this._metrics) return false;
    
    const stats = this._metrics.getStats();
    const health = this._metrics.getHealthScore();
    
    if (stats.successRate < 0.5) {
      return true;
    }
    
    if (stats.p95Latency > 15000) {
      return true;
    }
    
    return false;
  }

  async adapt() {
    if (!this._metrics) return;
    
    const now = Date.now();
    if (now - this._lastAdjustTime < this._adjustCooldown) {
      return;
    }
    
    const stats = this._metrics.getStats();
    const health = this._metrics.getHealthScore();
    
    if (health < 0.3) {
      this._decrease();
    } else if (health > 0.8 && this._currentConcurrent < this._maxConcurrent) {
      this._increase();
    }
    
    this._lastAdjustTime = now;
    this._adjustCooldown = 5000;
  }

  _decrease() {
    if (this._currentConcurrent > this._minConcurrent) {
      this._currentConcurrent = Math.max(this._minConcurrent, Math.floor(this._currentConcurrent * 0.8));
    }
    
    if (this._currentInterval < this._maxInterval) {
      this._currentInterval = Math.min(this._maxInterval, Math.floor(this._currentInterval * 1.5));
    }
    
    logger.info(`[Limiter] Decreased: concurrent=${this._currentConcurrent}, interval=${this._currentInterval}ms`);
  }

  _increase() {
    if (this._currentConcurrent < this._maxConcurrent) {
      this._currentConcurrent = Math.min(this._maxConcurrent, Math.floor(this._currentConcurrent * 1.2));
    }
    
    if (this._currentInterval > this._minInterval) {
      this._currentInterval = Math.max(this._minInterval, Math.floor(this._currentInterval * 0.8));
    }
  }

  getConfig() {
    return {
      concurrent: this._currentConcurrent,
      interval: this._currentInterval
    };
  }

  reset() {
    this._currentConcurrent = 2;
    this._currentInterval = 500;
  }
}

export class IntelligentCircuitBreaker {
  constructor(options = {}) {
    this._failureThreshold = options.failureThreshold || 5;
    this._successThreshold = options.successThreshold || 2;
    this._openTimeout = options.openTimeout || 30000;
    this._slowResponseThreshold = options.slowResponseThreshold || 10000;
    this._slowFailureWeight = options.slowFailureWeight || 2;
    
    this._state = 'CLOSED';
    this._failureCount = 0;
    this._slowCount = 0;
    this._successCount = 0;
    this._openedAt = null;
    this._lastFailureTime = null;
    this._consecutive5xx = 0;
  }

  recordSuccess(responseTime) {
    this._failureCount = 0;
    this._slowCount = 0;
    this._consecutive5xx = 0;
    
    if (this._state === 'HALF_OPEN') {
      this._successCount++;
      if (this._successCount >= this._successThreshold) {
        this._state = 'CLOSED';
        this._successCount = 0;
        logger.info('[ICBreaker] Recovered - CLOSED');
      }
    }
  }

  recordFailure(statusCode, responseTime) {
    this._lastFailureTime = Date.now();
    this._failureCount++;
    
    if (responseTime > this._slowResponseThreshold) {
      this._slowCount += this._slowFailureWeight;
    }
    
    if (statusCode >= 500) {
      this._consecutive5xx++;
    } else {
      this._consecutive5xx = 0;
    }
    
    if (this._state === 'HALF_OPEN') {
      this._state = 'OPEN';
      this._openedAt = Date.now();
      logger.info('[ICBreaker] Probe failed - OPEN');
      return;
    }
    
    const effectiveFailures = this._failureCount + this._slowCount;
    
    if (effectiveFailures >= this._failureThreshold || this._consecutive5xx >= 3) {
      this._state = 'OPEN';
      this._openedAt = Date.now();
      logger.info(`[ICBreaker] Opened after ${effectiveFailures} effective failures (5xx: ${this._consecutive5xx})`);
    }
  }

  canExecute() {
    if (this._state === 'CLOSED') {
      return { allowed: true, state: this._state };
    }
    
    if (this._state === 'OPEN') {
      const timeSinceOpened = Date.now() - this._openedAt;
      if (timeSinceOpened >= this._openTimeout) {
        this._state = 'HALF_OPEN';
        this._successCount = 0;
        logger.info('[ICBreaker] Half-Open - probing...');
        return { allowed: true, state: this._state };
      }
      return { allowed: false, state: this._state, waitTime: this._openTimeout - timeSinceOpened };
    }
    
    if (this._state === 'HALF_OPEN') {
      return { allowed: true, state: this._state };
    }
    
    return { allowed: false, state: this._state };
  }

  getStatus() {
    return {
      state: this._state,
      failureCount: this._failureCount,
      slowCount: this._slowCount,
      consecutive5xx: this._consecutive5xx,
      successCount: this._successCount,
      timeSinceOpened: this._openedAt ? Date.now() - this._openedAt : null
    };
  }
}

export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.openTimeout = options.openTimeout || 30000;
    
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.openedAt = null;
    this.lastFailureTime = null;
  }

  recordSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        logger.info('[CircuitBreaker] Recovered - CLOSED');
      }
    } else {
      this.failureCount = 0;
    }
  }

  recordFailure() {
    this.lastFailureTime = Date.now();
    this.failureCount++;
    
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.openedAt = Date.now();
      logger.info('[CircuitBreaker] Probe failed - OPEN');
      return;
    }
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
      logger.info(`[CircuitBreaker] Opened after ${this.failureCount} failures`);
    }
  }

  canExecute() {
    if (this.state === 'CLOSED') {
      return { allowed: true, state: this.state };
    }
    
    if (this.state === 'OPEN') {
      const timeSinceOpened = Date.now() - this.openedAt;
      if (timeSinceOpened >= this.openTimeout) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        logger.info('[CircuitBreaker] Half-Open - probing...');
        return { allowed: true, state: this.state };
      }
      return { allowed: false, state: this.state, waitTime: this.openTimeout - timeSinceOpened };
    }
    
    if (this.state === 'HALF_OPEN') {
      return { allowed: true, state: this.state };
    }
    
    return { allowed: false, state: this.state };
  }

  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      timeSinceOpened: this.openedAt ? Date.now() - this.openedAt : null
    };
  }
}

export class RequestQueue {
  constructor(options = {}) {
    this._maxConcurrent = options.maxConcurrent || 2;
    this._maxQueueSize = options.maxQueueSize || 100;
    this._minInterval = options.minInterval || 100;
    this._getConfig = options.getConfig || null;
    
    this._queue = [];
    this._active = 0;
    this._lastExecuteTime = 0;
  }

  updateConfig(maxConcurrent, minInterval) {
    this._maxConcurrent = maxConcurrent;
    this._minInterval = minInterval;
  }

  async enqueue(fn) {
    if (this._queue.length >= this._maxQueueSize) {
      throw new Error('Queue is full');
    }

    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      this._process();
    });
  }

  async _process() {
    if (this._getConfig) {
      const config = this._getConfig();
      this._maxConcurrent = config.concurrent;
      this._minInterval = config.interval;
    }
    
    while (this._active < this._maxConcurrent && this._queue.length > 0) {
      const item = this._queue.shift();
      if (!item) continue;

      this._active++;

      try {
        const result = await this._executeWithInterval(item.fn);
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      } finally {
        this._active--;
        this._process();
      }
    }
  }

  async _executeWithInterval(fn) {
    if (this._getConfig) {
      const config = this._getConfig();
      this._maxConcurrent = config.concurrent;
      this._minInterval = config.interval;
    }
    
    const now = Date.now();
    const timeSinceLast = now - this._lastExecuteTime;
    
    if (timeSinceLast < this._minInterval) {
      await this._delay(this._minInterval - timeSinceLast);
    }
    
    this._lastExecuteTime = Date.now();
    return fn();
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStatus() {
    return {
      queueLength: this._queue.length,
      active: this._active,
      maxConcurrent: this._maxConcurrent
    };
  }

  clear() {
    this._queue.forEach(item => item.reject(new Error('Queue cleared')));
    this._queue = [];
  }
}

export class RequestDeduplicator {
  constructor(options = {}) {
    this._maxSize = options.maxSize || 1000;
    this._ttl = options.ttl || 30000;
    this._cache = new Map();
  }

  _hash(request) {
    const str = JSON.stringify(request);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  _cleanExpired() {
    const now = Date.now();
    for (const [key, entry] of this._cache.entries()) {
      if (now - entry.timestamp > this._ttl) {
        this._cache.delete(key);
      }
    }

    if (this._cache.size > this._maxSize) {
      const oldestKeys = Array.from(this._cache.keys()).slice(0, 100);
      oldestKeys.forEach(key => this._cache.delete(key));
    }
  }

  async deduplicate(request, fn) {
    this._cleanExpired();

    const key = this._hash(request);
    const cached = this._cache.get(key);

    if (cached) {
      if (cached.pending) {
        return cached.pending;
      }
      return cached.result;
    }

    const pending = fn().then(result => {
      this._cache.set(key, { result, pending: null, timestamp: Date.now() });
      return result;
    }).catch(error => {
      this._cache.delete(key);
      throw error;
    });

    this._cache.set(key, { result: null, pending, timestamp: Date.now() });

    return pending;
  }

  clear() {
    this._cache.clear();
  }

  getStatus() {
    this._cleanExpired();
    return {
      size: this._cache.size,
      maxSize: this._maxSize,
      ttl: this._ttl
    };
  }
}


export default { ResponseCache, SmartRouter, StreamHandler, SafetyWrapper, CircuitBreakerMonitor, MetricsCollector, AdaptiveLimiter, IntelligentCircuitBreaker, CircuitBreaker, RequestQueue, RequestDeduplicator };
