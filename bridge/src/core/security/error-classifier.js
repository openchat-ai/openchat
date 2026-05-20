/**
 * 错误分类器
 * 根据 LLM API 错误信息自动分类并提供恢复建议
 */
export class ErrorClassifier {
  constructor() {
    this._rules = [];
    this._registerDefaultRules();
  }

  _registerDefaultRules() {
    this.addRule({
      category: 'timeout',
      patterns: [/timeout/i, /timed out/i, /ETIMEDOUT/i, /request timeout/i]
    });

    this.addRule({
      category: 'network',
      patterns: [/network/i, /ECONNREFUSED/i, /ENOTFOUND/i, /fetch failed/i, /connection/i]
    });

    this.addRule({
      category: 'rate_limit',
      patterns: [/429/i, /rate limit/i, /too many requests/i, /quota/i, /retry-after/i]
    });

    this.addRule({
      category: 'auth',
      patterns: [/401/i, /403/i, /unauthorized/i, /forbidden/i, /invalid.*key/i, /api.*key/i]
    });

    this.addRule({
      category: 'bad_request',
      patterns: [/400/i, /bad.*request/i, /invalid.*parameter/i, /validation/i]
    });

    this.addRule({
      category: 'not_found',
      patterns: [/404/i, /not.*found/i]
    });

    this.addRule({
      category: 'server_error',
      patterns: [/500/i, /502/i, /503/i, /504/i, /server.*error/i, /internal.*error/i, /bad.*gateway/i, /service.*unavailable/i, /gateway.*timeout/i]
    });

    this.addRule({
      category: 'circuit_open',
      patterns: [/circuit.*open/i, /breaker.*open/i]
    });

    this.addRule({
      category: 'quota_exceeded',
      patterns: [/quota/i, /limit.*exceeded/i, /monthly.*limit/i]
    });
  }

  addRule(rule) {
    this._rules.push(rule);
  }

  classify(error, context = {}) {
    const errorStr = typeof error === 'string' ? error : JSON.stringify(error);
    const statusCode = context.statusCode;

    for (const rule of this._rules) {
      for (const pattern of rule.patterns) {
        if (pattern.test(errorStr) || (statusCode && pattern.test(String(statusCode)))) {
          return {
            category: rule.category,
            recoverable: this._isRecoverable(rule.category),
            shouldRetry: this._shouldRetry(rule.category, context),
            priority: this._getPriority(rule.category)
          };
        }
      }
    }

    return {
      category: 'unknown',
      recoverable: false,
      shouldRetry: false,
      priority: 100
    };
  }

  _isRecoverable(category) {
    const recoverable = ['timeout', 'network', 'rate_limit', 'server_error'];
    return recoverable.includes(category);
  }

  _shouldRetry(category, context) {
    switch (category) {
      case 'timeout':
        return context.attempt < 3;
      case 'network':
        return context.attempt < 2;
      case 'rate_limit':
        return context.retryAfter !== undefined;
      case 'server_error':
        return context.statusCode < 500 || context.statusCode >= 600;
      case 'circuit_open':
        return false;
      case 'auth':
      case 'bad_request':
      case 'not_found':
        return false;
      default:
        return false;
    }
  }

  _getPriority(category) {
    const priorities = {
      'auth': 1,
      'bad_request': 2,
      'not_found': 3,
      'quota_exceeded': 4,
      'rate_limit': 5,
      'circuit_open': 6,
      'server_error': 7,
      'timeout': 8,
      'network': 9,
      'unknown': 100
    };
    return priorities[category] || 50;
  }
}

export default ErrorClassifier;
