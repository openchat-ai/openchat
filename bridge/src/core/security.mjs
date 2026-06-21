// core/security.mjs — merged from security/{error-boundary,error-classifier,sandbox-manager,security-checker,security-manager,security-sandbox,streaming-validator,structured-output-validator}.js
// 2026-06-21 (R1 cancelled, target 80 modules)

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import logger from '../monitoring/logger.js';

// === ErrorBoundary ===

export class ErrorBoundary {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.circuitBreakerThreshold = options.circuitBreakerThreshold || 5;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = 'closed';
    this.errorLog = [];
    this.maxErrorLog = options.maxErrorLog || 100;
  }

  async execute(operation, context = {}) {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime < this.circuitBreakerThreshold * 1000) {
        throw new Error('Circuit breaker is OPEN — operation skipped');
      }
      this.state = 'half-open';
    }
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await operation(context);
        this.onSuccess();
        return result;
      } catch (error) {
        lastError = error;
        this.onFailure(error);
        if (attempt < this.maxRetries) {
          await new Promise(r => setTimeout(r, this.retryDelay * attempt));
        }
      }
    }
    throw lastError;
  }

  onSuccess() { this.failureCount = 0; this.state = 'closed'; }

  onFailure(error) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.errorLog.push({ ts: Date.now(), message: error.message, stack: error.stack });
    if (this.errorLog.length > this.maxErrorLog) this.errorLog.shift();
    if (this.failureCount >= this.circuitBreakerThreshold) this.state = 'open';
  }

  getState() { return { state: this.state, failureCount: this.failureCount, lastFailureTime: this.lastFailureTime, recentErrors: this.errorLog.slice(-5) }; }
}

export const globalErrorBoundary = new ErrorBoundary({ maxRetries: 3, circuitBreakerThreshold: 5 });

export const withErrorHandling = (operation, options = {}) => {
  const boundary = options.boundary || globalErrorBoundary;
  return boundary.execute(operation, options.context || {});
};

// === ErrorClassifier ===

export class ErrorClassifier {
  classify(error) {
    if (error.code === 'ENOENT') return { type: 'filesystem', severity: 'low', retryable: false, suggestion: '检查文件路径是否正确' };
    if (error.code === 'EACCES' || error.code === 'EPERM') return { type: 'permission', severity: 'medium', retryable: false, suggestion: '检查文件权限' };
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') return { type: 'network', severity: 'medium', retryable: true, suggestion: '网络超时，可重试' };
    if (error.name === 'SyntaxError') return { type: 'syntax', severity: 'high', retryable: false, suggestion: '代码语法错误' };
    if (error.name === 'TypeError') return { type: 'type', severity: 'high', retryable: false, suggestion: '类型错误' };
    if (error.message?.includes('out of memory')) return { type: 'memory', severity: 'critical', retryable: false, suggestion: '内存不足' };
    return { type: 'unknown', severity: 'medium', retryable: true, suggestion: '未知错误' };
  }
}

export const errorClassifier = new ErrorClassifier();

// === SandboxManager ===

const __filename = fileURLToPath(import.meta.url);
const __dirname_sandbox = dirname(__filename);

class SandboxManager {
  constructor(options = {}) {
    this.sandboxDir = options.sandboxDir || join(__dirname_sandbox, '../../../tmp/sandbox');
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024;
    this.allowedExtensions = options.allowedExtensions || ['.js', '.mjs', '.json', '.md', '.txt'];
    this.blockedPatterns = options.blockedPatterns || [/require\(['"]\.\.\/\.\.\/.*['"]\)/, /process\.exit/, /eval\(/];
    this.executions = new Map();
  }

  async createSandbox(executionId) {
    const sandboxPath = join(this.sandboxDir, executionId);
    const { mkdir } = await import('fs/promises');
    await mkdir(sandboxPath, { recursive: true });
    this.executions.set(executionId, { path: sandboxPath, createdAt: Date.now() });
    return sandboxPath;
  }

  async validateFile(filePath) {
    const { stat, readFile } = await import('fs/promises');
    try {
      const stat_ = await stat(filePath);
      if (stat_.size > this.maxFileSize) return { valid: false, reason: 'File too large' };
      const content = await readFile(filePath, 'utf8');
      for (const pattern of this.blockedPatterns) {
        if (pattern.test(content)) return { valid: false, reason: `Blocked pattern: ${pattern.source}` };
      }
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      if (!this.allowedExtensions.includes(ext)) return { valid: false, reason: `Extension not allowed: ${ext}` };
      return { valid: true };
    } catch (error) {
      return { valid: false, reason: error.message };
    }
  }

  async cleanup(executionId) {
    const exec = this.executions.get(executionId);
    if (!exec) return;
    const { rm } = await import('fs/promises');
    try { await rm(exec.path, { recursive: true, force: true }); } catch (e) {}
    this.executions.delete(executionId);
  }
}

export { SandboxManager };

// === SecurityChecker ===

class SecurityChecker {
  constructor(options = {}) {
    this.dangerousPatterns = options.dangerousPatterns || [
      /eval\s*\(/, /Function\s*\(['"`]/, /new\s+Function\s*\(/,
      /require\s*\(\s*['"`][^'"`]+['"`]\s*\)/,
      /process\.binding/, /child_process\.exec/,
      /child_process\.spawn/, /fs\.unlink/, /fs\.rmSync/,
    ];
    this.sensitivePaths = options.sensitivePaths || ['.env', '.git/', 'node_modules/', '.ssh/'];
  }

  checkCode(code) {
    const issues = [];
    for (const pattern of this.dangerousPatterns) {
      const matches = code.match(new RegExp(pattern.source, 'g'));
      if (matches) issues.push({ type: 'dangerous_pattern', pattern: pattern.source, count: matches.length });
    }
    return { safe: issues.length === 0, issues };
  }

  checkPath(filePath) {
    for (const sensitive of this.sensitivePaths) {
      if (filePath.includes(sensitive)) return { safe: false, reason: `Sensitive path: ${sensitive}` };
    }
    return { safe: true };
  }
}

export { SecurityChecker };

// === SecurityManager ===

export class SecurityManager {
  constructor(options = {}) {
    this.policies = options.policies || {};
    this.auditLog = [];
    this.maxLogSize = options.maxLogSize || 1000;
  }

  check(action, context = {}) {
    const policy = this.policies[action];
    if (!policy) return { allowed: true, reason: 'No policy defined' };
    for (const rule of policy.rules || []) {
      if (!rule.condition(context)) return { allowed: false, reason: rule.reason };
    }
    this.auditLog.push({ ts: Date.now(), action, context, allowed: true });
    if (this.auditLog.length > this.maxLogSize) this.auditLog.shift();
    return { allowed: true };
  }

  deny(action, context, reason) {
    this.auditLog.push({ ts: Date.now(), action, context, allowed: false, reason });
    if (this.auditLog.length > this.maxLogSize) this.auditLog.shift();
    return { allowed: false, reason };
  }

  getAuditLog(limit = 50) { return this.auditLog.slice(-limit); }
}

// === SecuritySandbox ===

export class SecuritySandbox {
  constructor(options = {}) {
    this.maxExecutionTime = options.maxExecutionTime || 30000;
    this.maxMemoryMB = options.maxMemoryMB || 512;
    this.allowedModules = options.allowedModules || ['fs', 'path', 'crypto'];
    this.loopDetector = new LoopDetector();
  }

  async execute(code, context = {}) {
    this.loopDetector.reset();
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => { this.loopDetector.suspend(); reject(new Error('Execution timeout')); }, this.maxExecutionTime);
      try {
        const fn = new Function('context', `
          with (context) {
            ${code}
          }
        `);
        const result = fn(context);
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }
}

class LoopDetector extends EventEmitter {
  constructor() { super(); this.iterations = 0; this.maxIterations = 100000; this.suspended = false; }
  reset() { this.iterations = 0; this.suspended = false; }
  check() { if (this.suspended) return false; this.iterations++; if (this.iterations > this.maxIterations) { this.suspended = true; this.emit('loop'); return false; } return true; }
  suspend() { this.suspended = true; }
}

// === StreamingValidator ===

class StreamingValidator {
  constructor(options = {}) { this.chunkSize = options.chunkSize || 1024; this.validators = options.validators || []; }

  async validate(stream) {
    const results = [];
    let buffer = '';
    for await (const chunk of stream) {
      buffer += chunk.toString();
      const lastNewline = buffer.lastIndexOf('\n');
      if (lastNewline !== -1) {
        const lines = buffer.substring(0, lastNewline).split('\n');
        buffer = buffer.substring(lastNewline + 1);
        for (const line of lines) {
          if (line.trim()) results.push(this.validateLine(line));
        }
      }
    }
    if (buffer.trim()) results.push(this.validateLine(buffer));
    return results;
  }

  validateLine(line) {
    for (const validator of this.validators) {
      const result = validator(line);
      if (!result.valid) return { valid: false, line, validator: validator.name, reason: result.reason };
    }
    return { valid: true, line };
  }
}

export class ValidationErrorExplainer {
  explain(error, context = {}) {
    const explanations = {
      SyntaxError: '代码语法错误，请检查括号、引号、分号',
      TypeError: '类型错误，请检查函数参数',
      ReferenceError: '引用错误，未定义的变量或函数',
      RangeError: '数值超出有效范围',
    };
    return { error: error.name, message: error.message, explanation: explanations[error.name] || '未知错误', stack: error.stack };
  }
}

export { StreamingValidator };

// === StructuredOutputValidator ===

class StructuredOutputValidator {
  constructor(options = {}) {
    this.schemas = options.schemas || new Map();
    this.strictMode = options.strictMode !== false;
  }

  registerSchema(name, schema) { this.schemas.set(name, schema); }

  validate(output, schemaName) {
    const schema = this.schemas.get(schemaName);
    if (!schema) return { valid: false, error: `Unknown schema: ${schemaName}` };
    return this.validateAgainstSchema(output, schema);
  }

  validateAgainstSchema(output, schema) {
    if (typeof output !== 'object' || output === null) return { valid: false, error: 'Output must be an object' };
    const errors = [];
    for (const [key, type] of Object.entries(schema.properties || {})) {
      if (!(key in output)) { errors.push({ path: key, error: 'missing' }); continue; }
      const actualType = Array.isArray(output[key]) ? 'array' : typeof output[key];
      if (actualType !== type && !(type === 'integer' && actualType === 'number')) errors.push({ path: key, error: `expected ${type}, got ${actualType}` });
    }
    if (this.strictMode && Object.keys(output).length !== Object.keys(schema.properties || {}).length) {
      const extra = Object.keys(output).filter(k => !(k in (schema.properties || {})));
      for (const k of extra) errors.push({ path: k, error: 'extra field' });
    }
    return { valid: errors.length === 0, errors };
  }
}

export { StructuredOutputValidator };
