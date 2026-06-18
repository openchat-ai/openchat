import { StreamingValidator } from '../security/streaming-validator.js';

export class AgentResponseProcessor {
  constructor(deps) {
    this._responseCache = deps.responseCache;
    this._outputValidator = deps.outputValidator;
    this._qualityScorer = deps.qualityScorer;
    this._streamingValidator = deps.streamingValidator;
    this._safety = deps.safety;
    this._multimodalHandler = deps.multimodalHandler;
    this._limiter = deps.limiter;
    this._outputSchema = null;
  }

  // === Output Schema ===
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

  // === Media Detection ===
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

  // === Quality Scoring ===
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

  // === Cache Wrappers ===
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

  // === Response Processing ===
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

  // === Streaming Validation ===
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

  // === Safety ===
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
}
