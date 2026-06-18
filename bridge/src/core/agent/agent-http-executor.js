import logger from '../monitoring/logger.js';
import * as providerService from '../provider-service.js';

const MAX_GLOBAL_CONCURRENT = parseInt(process.env.MAX_GLOBAL_CONCURRENT_REQUESTS, 10) || 4;
let _globalConcurrent = 0;
const _globalQueue = [];

export class HttpExecutor {
  constructor({ agentId, config, circuitBreaker, responseParser, errorClassifier, metrics, router, limiter, deduplicator, requestQueue, isDestroyed }) {
    this._agentId = agentId;
    this._config = config;
    this._circuitBreaker = circuitBreaker;
    this._responseParser = responseParser;
    this._errorClassifier = errorClassifier;
    this._metrics = metrics;
    this._router = router;
    this._limiter = limiter;
    this._deduplicator = deduplicator;
    this._requestQueue = requestQueue;
    this._isDestroyed = isDestroyed;
  }

  async callApi(provider, apiKey, model, messages) {
    await this._limiter.adapt();

    const providerConfig = providerService.getProviderConfig(provider);
    if (!providerConfig || !providerConfig.baseUrl) {
      return { content: `Provider ${provider} missing baseUrl config` };
    }

    const filteredMessages = messages.filter(m => m.role !== 'system');
    if (this._config.systemPrompt) {
      filteredMessages.unshift({ role: 'system', content: this._config.systemPrompt });
    }

    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };

    const requestKey = { provider, model, messages: filteredMessages };

    const doRequest = async () => {
      const requestStart = Date.now();
      const result = await this.executeRequest(provider, apiKey, model, filteredMessages, headers, providerConfig);
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

  async executeRequest(provider, apiKey, model, filteredMessages, headers, providerConfig) {
    if (_globalConcurrent >= MAX_GLOBAL_CONCURRENT) {
      await new Promise(resolve => _globalQueue.push(resolve));
    }
    _globalConcurrent++;
    const release = () => {
      _globalConcurrent--;
      const next = _globalQueue.shift();
      if (next) next();
    };

    try {
      const config = {
        retries: 2,
        retryDelay: 500,
        minTimeout: 1000,
        maxTimeout: 30000,
        maxRetryDelay: 5000,
        factor: 2,
        randomize: true,
        maxRetryTime: 15000,
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
        if (this._isDestroyed()) {
          return { content: 'Agent destroyed' };
        }

        config.signal?.throwIfAborted?.();

        const circuitCheck = this._circuitBreaker.canExecute();
        if (!circuitCheck.allowed) {
          const waitTime = Math.ceil(circuitCheck.waitTime / 1000);
          return { content: `Circuit breaker open, retry in ${waitTime}s` };
        }

        if (circuitCheck.state === 'HALF_OPEN') {
          logger.info('[API] Circuit half-open, probing...');
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
            max_tokens: 2000,
            provider: { allow_fallbacks: true }
          };

          response = await fetch(`${providerConfig.baseUrl}${providerConfig.chatEndpoint}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          status = response.status;
          const responseText = await response.text();
          try {
            data = JSON.parse(responseText);
          } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); data = { error: { message: `HTTP ${status}: ${responseText.substring(0, 200)}` } };
          }

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
            if ( retryAfter) {
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

          logger.info(`[API] Attempt ${attempt} failed (HTTP ${status}). Retrying in ${delay}ms...`);

          await this._delay(delay);
          httpRetries++;

        } catch (error) {
          clearTimeout(timeoutId);

          if (this._isDestroyed()) {
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

            logger.info(`[API] Attempt ${attempt} failed (${error.message}). Retrying in ${delay}ms...`);

            await this._delay(delay);
            noResponseRetries++;
            continue;
          }

          return { content: `API error: ${error.message}` };
        }
      }
    } finally {
      release();
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
}
