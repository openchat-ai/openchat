import { messageBus, MESSAGE_TYPES } from './message-bus.js';
import { persistentConfig } from '../memory/persistent-config.js';
import { providerManager, PRESET_PROVIDERS, DEFAULT_PROVIDER } from '../memory/provider-manager.js';

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

export class ResponseParser {
  constructor() {
    this._parsers = new Map();
    this._registerDefaultParsers();
  }

  _registerDefaultParsers() {
    this.registerParser('openai', (data) => {
      if (data.choices && data.choices.length > 0) {
        const choice = data.choices[0];
        if (choice.message?.content) {
          return { type: 'text', content: choice.message.content };
        }
        if (choice.text) {
          return { type: 'text', content: choice.text };
        }
        if (choice.delta?.content) {
          return { type: 'text', content: choice.delta.content, partial: true };
        }
      }
      return null;
    });

    this.registerParser('anthropic', (data) => {
      if (data.content && Array.isArray(data.content)) {
        const textBlock = data.content.find(b => b.type === 'text');
        if (textBlock?.text) {
          return { type: 'text', content: textBlock.text };
        }
      }
      return null;
    });

    this.registerParser('generic', (data) => {
      if (typeof data === 'string') {
        return { type: 'text', content: data };
      }
      if (data.text) {
        return { type: 'text', content: data.text };
      }
      if (data.message?.content) {
        return { type: 'text', content: data.message.content };
      }
      if (data.result?.text) {
        return { type: 'text', content: data.result.text };
      }
      return null;
    });

    this.registerParser('stream', (data) => {
      if (datachoices && data.choices?.[0]?.delta?.content) {
        return { type: 'text', content: data.choices[0].delta.content, partial: true };
      }
      if (data.content_block?.text) {
        return { type: 'text', content: data.content_block.text, partial: true };
      }
      if (data.text) {
        return { type: 'text', content: data.text, partial: true };
      }
      return null;
    });
  }

  registerParser(name, parser) {
    this._parsers.set(name, parser);
  }

  parse(data, provider = 'generic') {
    const parser = this._parsers.get(provider) || this._parsers.get('generic');
    const result = parser(data);

    if (result) {
      return {
        success: true,
        ...result,
        raw: data
      };
    }

    return this._parseAsError(data);
  }

  _parseAsError(data) {
    if (data.error) {
      const error = data.error;
      return {
        success: false,
        type: 'api_error',
        content: error.message || error.type || JSON.stringify(error),
        code: error.code,
        raw: data
      };
    }

    if (data.message) {
      return {
        success: false,
        type: 'error',
        content: data.message,
        raw: data
      };
    }

    return {
      success: false,
      type: 'parse_error',
      content: 'Failed to parse response',
      raw: data
    };
  }

  detectStream(data) {
    if (datachoices || datachoices?.[0]?.delta) return true;
    if (data.event === 'message_delta' || data.event === 'content_block_delta') return true;
    if (data._type === 'chunk' || data.type === 'chunk') return true;
    return false;
  }
}

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

export class ContentAnalyzer {
  constructor(options = {}) {
    this._codePatterns = [
      { lang: 'javascript', pattern: /```(?:javascript|js|node)\n([\s\S]*?)```/gi },
      { lang: 'typescript', pattern: /```typescript\n([\s\S]*?)```/gi },
      { lang: 'python', pattern: /```(?:python|py)\n([\s\S]*?)```/gi },
      { lang: 'java', pattern: /```java\n([\s\S]*?)```/gi },
      { lang: 'csharp', pattern: /```(?:csharp|c#)\n([\s\S]*?)```/gi },
      { lang: 'go', pattern: /```go\n([\s\S]*?)```/gi },
      { lang: 'rust', pattern: /```rust\n([\s\S]*?)```/gi },
      { lang: 'sql', pattern: /```sql\n([\s\S]*?)```/gi },
      { lang: 'bash', pattern: /```(?:bash|sh|shell)\n([\s\S]*?)```/gi },
      { lang: 'json', pattern: /```json\n([\s\S]*?)```/gi },
      { lang: 'html', pattern: /```html\n([\s\S]*?)```/gi },
      { lang: 'css', pattern: /```css\n([\s\S]*?)```/gi },
      { lang: 'xml', pattern: /```xml\n([\s\S]*?)```/gi },
      { lang: 'yaml', pattern: /```yaml\n([\s\S]*?)```/gi },
      { lang: 'markdown', pattern: /```markdown\n([\s\S]*?)```/gi },
      { lang: 'plain', pattern: /```\n([\s\S]*?)```/gi }
    ];
    
    this._intentPatterns = {
      code_generation: [
        /write.*code|generate.*code|create.*function|implement/i,
        /```\w+\n/,
        /def \w+\(|function \w+\(|class \w+/
      ],
      debugging: [
        /debug|error|exception|bug|fix|issue|problem/i,
        /stack.*trace|traceback|at line \d+/
      ],
      explanation: [
        /explain|what.*is|how.*does|tell.*me|describe|understand/i,
        /what.*mean|meaning.*of/i
      ],
      summarization: [
        /summarize|summary|condense|brief|shorten/i,
        /in.*short|to.*sum.*up|key.*points/
      ],
      translation: [
        /translate|translation|convert.*to|into.*language/i,
        /in.*chinese|in.*english|in.*japanese/
      ],
      data_analysis: [
        /analyze|analysis|statistic|trend|pattern|correlation/i,
        /data.*point|distribution|percentage/
      ],
      question_answering: [
        /what.*is|who.*is|when.*did|where.*is|why.*did|how.*does/i,
        /\?$/
      ],
      creative: [
        /write.*story|write.*poem|creative|imagine|generate.*idea/i,
        /brainstorm|dream.*up/
      ],
      extraction: [
        /extract|find.*all|identify.*all|list.*all|get.*from/i,
        /parse.*data|pull.*out|crawl/
      ]
    };
    
    this._sensitivePatterns = [
      /api[_-]?key/i,
      /password/i,
      /secret/i,
      /token/i,
      /bearer/i,
      /authorization/i,
      /private[_-]?key/i,
      /-----BEGIN.*PRIVATE KEY-----/,
      /-----BEGIN.*CERTIFICATE-----/,
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    ];
  }

  analyze(content) {
    return {
      hasCode: this.detectCode(content),
      codeBlocks: this.extractCodeBlocks(content),
      hasJson: this.detectJson(content),
      parsedJson: this.extractJson(content),
      hasMarkdown: this.detectMarkdown(content),
      formatted: this.formatMarkdown(content),
      hasSensitive: this.detectSensitive(content),
      filtered: this.filterSensitive(content),
      intent: this.recognizeIntent(content),
      statistics: this.getStatistics(content)
    };
  }

  detectCode(content) {
    for (const { pattern } of this._codePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        return true;
      }
    }
    return false;
  }

  extractCodeBlocks(content) {
    const blocks = [];
    
    for (const { lang, pattern } of this._codePatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        blocks.push({
          language: lang,
          code: match[1] || match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length
        });
      }
    }
    
    return blocks.sort((a, b) => a.startIndex - b.startIndex);
  }

  detectJson(content) {
    const trimmed = content.trim();
    
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        JSON.parse(trimmed);
        return true;
      } catch (e) {}
    }
    
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        JSON.parse(trimmed);
        return true;
      } catch (e) {}
    }
    
    const jsonBlockPattern = /```json\s*([\s\S]*?)\s*```/gi;
    let match;
    while ((match = jsonBlockPattern.exec(content)) !== null) {
      try {
        JSON.parse(match[1]);
        return true;
      } catch (e) {}
    }
    
    return false;
  }

  extractJson(content) {
    const trimmed = content.trim();
    
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return { success: true, data: JSON.parse(trimmed), isBlock: false };
      } catch (e) {}
    }
    
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        return { success: true, data: JSON.parse(trimmed), isBlock: false };
      } catch (e) {}
    }
    
    const jsonBlockPattern = /```json\s*([\s\S]*?)\s*```/gi;
    let match;
    while ((match = jsonBlockPattern.exec(content)) !== null) {
      try {
        return { success: true, data: JSON.parse(match[1]), isBlock: true };
      } catch (e) {}
    }
    
    return { success: false, data: null, isBlock: false };
  }

  detectMarkdown(content) {
    const markdownPatterns = [
      /^#{1,6}\s/m,
      /\*\*[^*]+\*\*/,
      /\*[^*]+\*/,
      /\[.+\]\(.+\)/,
      /```/m,
      />/m,
      /[-*]\s/m,
      /\d+\.\s/m
    ];
    
    let matchCount = 0;
    for (const pattern of markdownPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        matchCount++;
      }
    }
    
    return matchCount >= 2;
  }

  formatMarkdown(content) {
    return content
      .replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        return `\`\`\`${lang || ''}\n${code.trim()}\n\`\`\``;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^#{1,6}\s(.+)$/gm, (match, text) => {
        const level = match.match(/^#+/)[0].length;
        return `<h${level}>${text}</h${level}>`;
      })
      .replace(/^>\s(.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^[-*]\s(.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>');
  }

  detectSensitive(content) {
    for (const pattern of this._sensitivePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        return true;
      }
    }
    return false;
  }

  filterSensitive(content, replacement = '[REDACTED]') {
    let filtered = content;
    
    for (const pattern of this._sensitivePatterns) {
      filtered = filtered.replace(pattern, replacement);
    }
    
    return filtered;
  }

  recognizeIntent(content) {
    const scores = {};
    
    for (const [intent, patterns] of Object.entries(this._intentPatterns)) {
      let score = 0;
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        if (pattern.test(content)) {
          score++;
        }
      }
      if (score > 0) {
        scores[intent] = score;
      }
    }
    
    if (Object.keys(scores).length === 0) {
      return { primary: 'general', confidence: 0, all: scores };
    }
    
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const primary = sorted[0][0];
    const maxScore = sorted[0][1];
    const confidence = Math.min(1, maxScore / 3);
    
    return { primary, confidence, all: scores };
  }

  getStatistics(content) {
    const lines = content.split('\n');
    const words = content.split(/\s+/).filter(w => w.length > 0);
    const chars = content.length;
    
    const codeBlocks = this.extractCodeBlocks(content);
    const totalCodeLines = codeBlocks.reduce((sum, block) => {
      return sum + block.code.split('\n').length;
    }, 0);
    
    return {
      lines: lines.length,
      words: words.length,
      chars,
      codeLines: totalCodeLines,
      textLines: lines.length - totalCodeLines,
      hasCode: codeBlocks.length > 0,
      codeLanguages: [...new Set(codeBlocks.map(b => b.language))]
    };
  }
}

export class StructuredOutputValidator {
  constructor(options = {}) {
    this._strictMode = options.strictMode !== false;
    this._maxRetries = options.maxRetries || 3;
    this._enableAutoFix = options.enableAutoFix !== false;
    this._coerceTypes = options.coerceTypes !== false;
    this._customValidators = new Map();
    this._transformations = new Map();
  }

  registerValidator(name, fn) {
    this._customValidators.set(name, fn);
  }

  registerTransformation(name, fn) {
    this._transformations.set(name, fn);
  }

  inferSchema(examples) {
    if (!Array.isArray(examples) || examples.length === 0) {
      throw new Error('At least one example is required for schema inference');
    }

    const infer = (value, path = '') => {
      if (value === null || value === undefined) {
        return { type: 'null', description: path || 'value' };
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          return { type: 'array', items: {} };
        }
        const itemSchemas = value.map((item, i) => infer(item, `${path}[${i}]`));
        const firstItemSchema = itemSchemas[0];
        const allSameType = itemSchemas.every(s => s.type === firstItemSchema.type);
        return {
          type: 'array',
          items: allSameType ? firstItemSchema : { type: 'any' }
        };
      }

      switch (typeof value) {
        case 'string':
          return { type: 'string', description: path || 'text' };
        case 'number':
          return {
            type: Number.isInteger(value) ? 'integer' : 'number',
            description: path || 'number'
          };
        case 'boolean':
          return { type: 'boolean', description: path || 'flag' };
        case 'object':
          const properties = {};
          const required = [];
          for (const [key, val] of Object.entries(value)) {
            properties[key] = infer(val, path ? `${path}.${key}` : key);
            if (val !== null && val !== undefined) {
              required.push(key);
            }
          }
          return {
            type: 'object',
            description: path || 'object',
            properties,
            required: this._strictMode ? required : undefined
          };
        default:
          return { type: 'any', description: path || 'value' };
      }
    };

    return infer(examples[0]);
  }

  createSchema(definition) {
    return {
      type: 'object',
      description: definition.description || 'validated output',
      properties: definition.properties || {},
      required: definition.required || [],
      additionalProperties: definition.additionalProperties !== undefined 
        ? definition.additionalProperties 
        : !this._strictMode,
      conditions: definition.conditions || [],
      customValidators: definition.customValidators || []
    };
  }

  validate(data, schema, path = '') {
    const errors = [];
    const warnings = [];

    const validateValue = (value, schema, currentPath) => {
      if (value === undefined && schema.type !== 'any') {
        if (schema.required || this._strictMode) {
          errors.push({
            path: currentPath,
            pathJsonPath: this._toJsonPath(currentPath),
            message: `Missing required field`,
            expected: schema.type,
            received: 'undefined'
          });
        }
        return;
      }

      if (value === null) {
        if (schema.type !== 'null' && schema.type !== 'any' && schema.type !== undefined) {
          if (this._coerceTypes && schema.type === 'string') {
            warnings.push({ path: currentPath, pathJsonPath: this._toJsonPath(currentPath), message: 'Coerced null to empty string' });
            return '';
          }
          errors.push({
            path: currentPath,
            pathJsonPath: this._toJsonPath(currentPath),
            message: `Expected ${schema.type}, received null`,
            expected: schema.type,
            received: 'null'
          });
        }
        return;
      }

      switch (schema.type) {
        case 'string':
          if (typeof value !== 'string') {
            if (this._coerceTypes) {
              const coerced = String(value);
              warnings.push({ path: currentPath, pathJsonPath: this._toJsonPath(currentPath), message: `Coerced ${typeof value} to string` });
              return coerced;
            }
            errors.push({
              path: currentPath,
              pathJsonPath: this._toJsonPath(currentPath),
              message: `Expected string, received ${typeof value}`,
              expected: 'string',
              received: typeof value
            });
          } else {
            if (schema.minLength !== undefined && value.length < schema.minLength) {
              errors.push({
                path: currentPath,
                pathJsonPath: this._toJsonPath(currentPath),
                message: `String length ${value.length} is less than minimum ${schema.minLength}`,
                expected: `minLength: ${schema.minLength}`,
                received: value.length
              });
            }
            if (schema.maxLength !== undefined && value.length > schema.maxLength) {
              warnings.push({ path: currentPath, pathJsonPath: this._toJsonPath(currentPath), message: `String truncated from ${value.length} to ${schema.maxLength} characters` });
              return value.substring(0, schema.maxLength);
            }
            if (schema.pattern) {
              const regex = new RegExp(schema.pattern);
              if (!regex.test(value)) {
                errors.push({
                  path: currentPath,
                  pathJsonPath: this._toJsonPath(currentPath),
                  message: `String does not match pattern ${schema.pattern}`,
                  expected: schema.pattern,
                  received: value
                });
              }
            }
            if (schema.enum && !schema.enum.includes(value)) {
              errors.push({
                path: currentPath,
                pathJsonPath: this._toJsonPath(currentPath),
                message: `Value must be one of: ${schema.enum.join(', ')}`,
                expected: schema.enum,
                received: value
              });
            }
            if (schema.trim) {
              const trimmed = value.trim();
              if (trimmed !== value) {
                warnings.push({ path: currentPath, pathJsonPath: this._toJsonPath(currentPath), message: 'String was trimmed' });
                return trimmed;
              }
            }
            if (schema.toLowerCase && value !== value.toLowerCase()) {
              warnings.push({ path: currentPath, pathJsonPath: this._toJsonPath(currentPath), message: 'String was lowercased' });
              return value.toLowerCase();
            }
            if (schema.toUpperCase && value !== value.toUpperCase()) {
              warnings.push({ path: currentPath, pathJsonPath: this._toJsonPath(currentPath), message: 'String was uppercased' });
              return value.toUpperCase();
            }
          }
          break;

        case 'number':
        case 'integer':
          if (typeof value !== 'number') {
            if (this._coerceTypes) {
              const coerced = schema.type === 'integer' ? parseInt(value, 10) : parseFloat(value);
              if (!isNaN(coerced)) {
                warnings.push({ path: currentPath, pathJsonPath: this._toJsonPath(currentPath), message: `Coerced ${typeof value} to ${schema.type}` });
                return coerced;
              }
            }
            errors.push({
              path: currentPath,
              pathJsonPath: this._toJsonPath(currentPath),
              message: `Expected ${schema.type}, received ${typeof value}`,
              expected: schema.type,
              received: typeof value
            });
          } else {
            if (schema.type === 'integer' && !Number.isInteger(value)) {
              if (this._coerceTypes) {
                warnings.push({ path: currentPath, pathJsonPath: this._toJsonPath(currentPath), message: 'Coerced float to integer' });
                return Math.round(value);
              }
              errors.push({
                path: currentPath,
                pathJsonPath: this._toJsonPath(currentPath),
                message: 'Expected integer, received float',
                expected: 'integer',
                received: typeof value
              });
            } else if (schema.minimum !== undefined && value < schema.minimum) {
              errors.push({
                path: currentPath,
                pathJsonPath: this._toJsonPath(currentPath),
                message: `Value ${value} is less than minimum ${schema.minimum}`,
                expected: schema.minimum,
                received: value
              });
            } else if (schema.maximum !== undefined && value > schema.maximum) {
              errors.push({
                path: currentPath,
                pathJsonPath: this._toJsonPath(currentPath),
                message: `Value ${value} exceeds maximum ${schema.maximum}`,
                expected: schema.maximum,
                received: value
              });
            }
            if (schema.enum && !schema.enum.includes(value)) {
              errors.push({
                path: currentPath,
                pathJsonPath: this._toJsonPath(currentPath),
                message: `Value must be one of: ${schema.enum.join(', ')}`,
                expected: schema.enum,
                received: value
              });
            }
          }
          break;

        case 'boolean':
          if (typeof value !== 'boolean') {
            if (this._coerceTypes) {
              if (value === 'true' || value === '1' || value === 'yes' || value === 'on') {
                warnings.push({ path: currentPath, pathJsonPath: this._toJsonPath(currentPath), message: 'Coerced to boolean true' });
                return true;
              }
              if (value === 'false' || value === '0' || value === 'no' || value === 'off') {
                warnings.push({ path: currentPath, pathJsonPath: this._toJsonPath(currentPath), message: 'Coerced to boolean false' });
                return false;
              }
            }
            errors.push({
              path: currentPath,
              pathJsonPath: this._toJsonPath(currentPath),
              message: `Expected boolean, received ${typeof value}`,
              expected: 'boolean',
              received: typeof value
            });
          }
          break;

        case 'array':
          if (!Array.isArray(value)) {
            if (this._coerceTypes && typeof value === 'string') {
              const coerced = value.split(',').map(s => s.trim());
              warnings.push({ path: currentPath, pathJsonPath: this._toJsonPath(currentPath), message: 'Coerced comma-separated string to array' });
              return coerced;
            }
            errors.push({
              path: currentPath,
              pathJsonPath: this._toJsonPath(currentPath),
              message: `Expected array, received ${typeof value}`,
              expected: 'array',
              received: typeof value
            });
          } else {
            if (schema.minItems !== undefined && value.length < schema.minItems) {
              errors.push({
                path: currentPath,
                pathJsonPath: this._toJsonPath(currentPath),
                message: `Array length ${value.length} is less than minimum ${schema.minItems}`,
                expected: `minItems: ${schema.minItems}`,
                received: value.length
              });
            }
            if (schema.maxItems !== undefined && value.length > schema.maxItems) {
              warnings.push({ path: currentPath, pathJsonPath: this._toJsonPath(currentPath), message: `Array truncated from ${value.length} to ${schema.maxItems} items` });
              value = value.slice(0, schema.maxItems);
            }
            if (schema.uniqueItems && value.length !== new Set(value.map(v => JSON.stringify(v))).size) {
              errors.push({
                path: currentPath,
                pathJsonPath: this._toJsonPath(currentPath),
                message: 'Array must contain unique items',
                expected: 'uniqueItems',
                received: 'has duplicates'
              });
            }
            if (schema.items) {
              value.forEach((item, index) => {
                validateValue(item, schema.items, `${currentPath}[${index}]`);
              });
            }
          }
          break;

        case 'object':
          if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            errors.push({
              path: currentPath,
              pathJsonPath: this._toJsonPath(currentPath),
              message: `Expected object, received ${typeof value}`,
              expected: 'object',
              received: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
            });
          } else {
            const requiredFields = schema.required || [];
            for (const field of requiredFields) {
              if (!(field in value)) {
                errors.push({
                  path: `${currentPath}.${field}`,
                  pathJsonPath: this._toJsonPath(`${currentPath}.${field}`),
                  message: `Missing required field`,
                  expected: field,
                  received: 'undefined'
                });
              }
            }

            for (const [key, val] of Object.entries(value)) {
              if (schema.properties && key in schema.properties) {
                validateValue(val, schema.properties[key], `${currentPath}.${key}`);
              } else if (schema.additionalProperties === false) {
                errors.push({
                  path: `${currentPath}.${key}`,
                  pathJsonPath: this._toJsonPath(`${currentPath}.${key}`),
                  message: `Unexpected field`,
                  expected: Object.keys(schema.properties || {}).join(', ') || 'none',
                  received: key
                });
              }
            }

            if (schema.customValidators) {
              for (const validatorName of schema.customValidators) {
                const validator = this._customValidators.get(validatorName);
                if (validator) {
                  const result = validator(value, schema);
                  if (!result.valid) {
                    errors.push({
                      path: currentPath,
                      pathJsonPath: this._toJsonPath(currentPath),
                      message: result.message || `Custom validation failed: ${validatorName}`,
                      expected: validatorName,
                      received: 'validation failed'
                    });
                  }
                }
              }
            }
          }
          break;

        case 'any':
        case undefined:
          break;

        default:
          warnings.push({
            path: currentPath,
            pathJsonPath: this._toJsonPath(currentPath),
            message: `Unknown schema type: ${schema.type}`
          });
      }

      return value;
    };

    validateValue(data, schema, path || 'root');

    if (schema.conditions && schema.conditions.length > 0) {
      const conditionErrors = this._validateConditions(data, schema.conditions);
      errors.push(...conditionErrors);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      data: errors.length === 0 ? data : null
    };
  }

  _toJsonPath(path) {
    return path
      .replace(/^\./, '')
      .replace(/\.\[(\d+)\]/g, '[$1]')
      .replace(/\.([^.\[\]]+)/g, '.$1');
  }

  _validateConditions(data, conditions) {
    const errors = [];

    for (const condition of conditions) {
      const { if: ifField, is, then, message } = condition;

      const ifValue = this._getValueAtPath(data, ifField);

      let conditionMet = false;
      if (is !== undefined) {
        if (typeof is === 'string' || typeof is === 'number' || typeof is === 'boolean') {
          conditionMet = ifValue === is;
        } else if (typeof is === 'object' && is !== null) {
          if (is.enum) {
            conditionMet = is.enum.includes(ifValue);
          } else if (is.contains) {
            conditionMet = String(ifValue).includes(is.contains);
          } else if (is.matches) {
            conditionMet = new RegExp(is.matches).test(String(ifValue));
          }
        }
      }

      if (conditionMet) {
        const thenErrors = this._validateConditionField(data, then);
        if (thenErrors.length > 0) {
          for (const err of thenErrors) {
            errors.push({
              path: err.path,
              pathJsonPath: this._toJsonPath(err.path),
              message: message || err.message,
              type: 'condition'
            });
          }
        }
      }
    }

    return errors;
  }

  _getValueAtPath(obj, path) {
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  _validateConditionField(data, then) {
    const errors = [];

    if (then.required) {
      for (const field of then.required) {
        const value = this._getValueAtPath(data, field);
        if (value === undefined || value === null) {
          errors.push({
            path: field,
            message: `Field '${field}' is required when condition is met`
          });
        }
      }
    }

    if (then.forbidden) {
      for (const field of then.forbidden) {
        const value = this._getValueAtPath(data, field);
        if (value !== undefined && value !== null) {
          errors.push({
            path: field,
            message: `Field '${field}' must not be present when condition is met`
          });
        }
      }
    }

    return errors;
  }

  extractJson(content) {
    const trimmed = content.trim();
    
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return { success: true, data: JSON.parse(trimmed), isBlock: false };
      } catch (e) {}
    }
    
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        return { success: true, data: JSON.parse(trimmed), isBlock: false };
      } catch (e) {}
    }

    const patterns = [
      /```json\s*([\s\S]*?)\s*```/gi,
      /```\s*([\s\S]*?)\s*```/gi,
      /\{[\s\S]*\}/
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const candidate = Array.isArray(match) ? match[0] : match;
        try {
          const parsed = JSON.parse(candidate);
          return { success: true, data: parsed, isBlock: true };
        } catch (e) {}
      }
    }

    return { success: false, data: null, isBlock: false };
  }

  transform(data, schema, options = {}) {
    const errors = [];
    const warnings = [];
    const transformations = [];

    if (!data) {
      return {
        valid: false,
        data: null,
        transformed: null,
        errors: [{ path: 'root', pathJsonPath: '$', message: 'Data is null or undefined' }],
        warnings: [],
        transformations: []
      };
    }

    const transformValue = (value, schema, currentPath, rootData) => {
      let transformed = value;
      let hasTransformation = false;

      if (value === undefined && schema.default !== undefined) {
        transformed = schema.default;
        transformations.push({
          path: currentPath,
          type: 'default',
          from: undefined,
          to: schema.default
        });
        hasTransformation = true;
      }

      if (value === null && schema.type === 'string' && schema.defaultIfNull !== undefined) {
        transformed = schema.defaultIfNull;
        transformations.push({
          path: currentPath,
          type: 'defaultIfNull',
          from: null,
          to: schema.defaultIfNull
        });
        hasTransformation = true;
      }

      switch (schema.type) {
        case 'string':
          if (typeof transformed !== 'string') {
            if (this._coerceTypes) {
              transformed = String(transformed);
              transformations.push({
                path: currentPath,
                type: 'coerce',
                from: typeof value,
                to: 'string'
              });
              hasTransformation = true;
            }
          } else {
            if (schema.trim) {
              const trimmed = transformed.trim();
              if (trimmed !== transformed) {
                transformed = trimmed;
                transformations.push({
                  path: currentPath,
                  type: 'trim',
                  from: value,
                  to: transformed
                });
                hasTransformation = true;
              }
            }
            if (schema.toLowerCase) {
              const lower = transformed.toLowerCase();
              if (lower !== transformed) {
                transformed = lower;
                transformations.push({
                  path: currentPath,
                  type: 'toLowerCase',
                  from: value,
                  to: transformed
                });
                hasTransformation = true;
              }
            }
            if (schema.toUpperCase) {
              const upper = transformed.toUpperCase();
              if (upper !== transformed) {
                transformed = upper;
                transformations.push({
                  path: currentPath,
                  type: 'toUpperCase',
                  from: value,
                  to: transformed
                });
                hasTransformation = true;
              }
            }
            if (schema.maxLength && transformed.length > schema.maxLength) {
              const truncated = transformed.substring(0, schema.maxLength);
              transformations.push({
                path: currentPath,
                type: 'truncate',
                from: `${transformed.substring(0, 20)}...(${transformed.length} chars)`,
                to: `${truncated}...(${truncated.length} chars)`
              });
              transformed = truncated;
              hasTransformation = true;
            }
            if (schema.enum && !schema.enum.includes(transformed)) {
              const mapped = schema.enumMap?.[transformed];
              if (mapped) {
                transformed = mapped;
                transformations.push({
                  path: currentPath,
                  type: 'enumMap',
                  from: value,
                  to: transformed
                });
                hasTransformation = true;
              }
            }
          }
          break;

        case 'number':
        case 'integer':
          if (typeof transformed !== 'number') {
            if (this._coerceTypes) {
              const coerced = schema.type === 'integer' ? parseInt(transformed, 10) : parseFloat(transformed);
              if (!isNaN(coerced)) {
                transformations.push({
                  path: currentPath,
                  type: 'coerce',
                  from: typeof value,
                  to: schema.type
                });
                transformed = coerced;
                hasTransformation = true;
              }
            }
          }
          if (typeof transformed === 'number' && schema.type === 'integer' && !Number.isInteger(transformed)) {
            if (this._coerceTypes) {
              transformed = Math.round(transformed);
              transformations.push({
                path: currentPath,
                type: 'round',
                from: value,
                to: transformed
              });
              hasTransformation = true;
            }
          }
          if (typeof transformed === 'number') {
            if (schema.minimum !== undefined && transformed < schema.minimum) {
              transformed = schema.minimum;
              transformations.push({
                path: currentPath,
                type: 'clamp',
                from: value,
                to: `min(${schema.minimum})`
              });
              hasTransformation = true;
            }
            if (schema.maximum !== undefined && transformed > schema.maximum) {
              transformed = schema.maximum;
              transformations.push({
                path: currentPath,
                type: 'clamp',
                from: value,
                to: `max(${schema.maximum})`
              });
              hasTransformation = true;
            }
          }
          break;

        case 'boolean':
          if (typeof transformed !== 'boolean') {
            if (this._coerceTypes) {
              if (transformed === 'true' || transformed === '1' || transformed === 'yes' || transformed === 'on') {
                transformed = true;
                transformations.push({
                  path: currentPath,
                  type: 'coerce',
                  from: String(value),
                  to: true
                });
                hasTransformation = true;
              } else if (transformed === 'false' || transformed === '0' || transformed === 'no' || transformed === 'off') {
                transformed = false;
                transformations.push({
                  path: currentPath,
                  type: 'coerce',
                  from: String(value),
                  to: false
                });
                hasTransformation = true;
              }
            }
          }
          break;

        case 'array':
          if (!Array.isArray(transformed)) {
            if (this._coerceTypes && typeof transformed === 'string') {
              transformed = transformed.split(',').map(s => s.trim());
              transformations.push({
                path: currentPath,
                type: 'coerce',
                from: typeof value,
                to: 'array'
              });
              hasTransformation = true;
            }
          }
          if (Array.isArray(transformed)) {
            if (schema.maxItems && transformed.length > schema.maxItems) {
              transformed = transformed.slice(0, schema.maxItems);
              transformations.push({
                path: currentPath,
                type: 'slice',
                from: `${value.length} items`,
                to: `${schema.maxItems} items`
              });
              hasTransformation = true;
            }
            if (schema.items) {
              transformed = transformed.map((item, index) => {
                return transformValue(item, schema.items, `${currentPath}[${index}]`, rootData);
              });
            }
          }
          break;

        case 'object':
          if (typeof transformed !== 'object' || transformed === null || Array.isArray(transformed)) {
            break;
          }
          const properties = schema.properties || {};
          const required = schema.required || [];
          
          for (const [key, propSchema] of Object.entries(properties)) {
            const propPath = `${currentPath}.${key}`;
            if (!(key in transformed)) {
              if (propSchema.default !== undefined) {
                transformed[key] = propSchema.default;
                transformations.push({
                  path: propPath,
                  type: 'default',
                  from: undefined,
                  to: propSchema.default
                });
                hasTransformation = true;
              } else if (required.includes(key) || this._strictMode) {
                if (propSchema.type === 'string') transformed[key] = '';
                else if (propSchema.type === 'number' || propSchema.type === 'integer') transformed[key] = 0;
                else if (propSchema.type === 'boolean') transformed[key] = false;
                else if (propSchema.type === 'array') transformed[key] = [];
                else if (propSchema.type === 'object') transformed[key] = {};
                if (required.includes(key)) {
                  transformations.push({
                    path: propPath,
                    type: 'fillRequired',
                    from: undefined,
                    to: `empty ${propSchema.type}`
                  });
                  hasTransformation = true;
                }
              }
            } else {
              transformed[key] = transformValue(transformed[key], propSchema, propPath, rootData);
            }
          }
          break;
      }

      return transformed;
    };

    let transformedData = transformValue(data, schema, 'root', data);
    const validation = this.validate(transformedData, schema);

    return {
      valid: validation.valid,
      data: validation.valid ? transformedData : null,
      transformed: transformedData,
      errors: validation.errors,
      warnings: validation.warnings,
      transformations,
      complianceRate: validation.errors.length === 0 ? 1.0 : 
        Math.max(0, 1 - (validation.errors.length / (Object.keys(schema.properties || {}).length + 1)))
    };
  }

  benchmark(data, schema, options = {}) {
    const iterations = options.iterations || 100;
    const results = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      const validation = this.validate(data, schema);
      const end = Date.now();

      results.push({
        iteration: i,
        valid: validation.valid,
        errorCount: validation.errors.length,
        warningCount: validation.warnings.length,
        duration: end - start
      });
    }

    const durations = results.map(r => r.duration);
    const validCount = results.filter(r => r.valid).length;

    return {
      iterations,
      validCount,
      invalidCount: iterations - validCount,
      complianceRate: validCount / iterations,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      p95Duration: durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)],
      p99Duration: durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.99)]
    };
  }

  autoFix(content, schema) {
    let fixed = content;

    fixed = fixed.replace(/```json\s*/gi, '```json\n');
    fixed = fixed.replace(/```\s*\n\s*\{/g, '```json\n{');
    fixed = fixed.replace(/\}\s*```\s*$/g, '}\n```');

    const extracted = this.extractJson(fixed);
    if (extracted.success) {
      const transformResult = this.transform(extracted.data, schema);
      if (transformResult.valid) {
        return { 
          success: true, 
          content: JSON.stringify(transformResult.transformed, null, 2), 
          data: transformResult.transformed,
          fixed: true,
          warnings: transformResult.warnings,
          transformations: transformResult.transformations
        };
      }
      
      const validation = this.validate(transformResult.transformed || extracted.data, schema);
      if (validation.valid) {
        return {
          success: true,
          content: JSON.stringify(transformResult.transformed, null, 2),
          data: transformResult.transformed,
          fixed: true,
          warnings: [...validation.warnings, ...transformResult.warnings],
          transformations: transformResult.transformations
        };
      }

      return {
        success: false,
        content: fixed,
        data: extracted.data,
        fixed: false,
        errors: validation.errors,
        warnings: [...validation.warnings, ...transformResult.warnings]
      };
    }

    return {
      success: false,
      content: fixed,
      data: null,
      fixed: false,
      errors: [{ path: 'root', pathJsonPath: '$', message: 'Failed to extract valid JSON from content' }]
    };
  }

  _coerceValues(data, schema) {
    if (data === null || data === undefined) return data;

    if (Array.isArray(data)) {
      if (schema.items) {
        return data.map((item, i) => this._coerceValues(item, schema.items));
      }
      return data;
    }

    if (typeof data === 'object' && schema.type === 'object') {
      const coerced = {};
      const properties = schema.properties || {};
      
      for (const [key, value] of Object.entries(data)) {
        if (properties[key]) {
          coerced[key] = this._coerceValues(value, properties[key]);
        } else {
          coerced[key] = value;
        }
      }
      
      for (const [key, propSchema] of Object.entries(properties)) {
        if (!(key in coerced)) {
          if (propSchema.type === 'string') coerced[key] = '';
          else if (propSchema.type === 'number' || propSchema.type === 'integer') coerced[key] = 0;
          else if (propSchema.type === 'boolean') coerced[key] = false;
          else if (propSchema.type === 'array') coerced[key] = [];
          else if (propSchema.type === 'object') coerced[key] = {};
        }
      }
      
      return coerced;
    }

    return data;
  }

  async validateWithRetry(content, schema, options = {}) {
    let lastResult = null;
    let attempts = 0;
    const maxAttempts = options.maxRetries || this._maxRetries;

    while (attempts < maxAttempts) {
      attempts++;

      const extracted = this.extractJson(content);
      if (extracted.success) {
        const validation = this.validate(extracted.data, schema);
        
        if (validation.valid) {
          return {
            success: true,
            data: extracted.data,
            attempts,
            content: JSON.stringify(extracted.data, null, 2),
            fixed: false,
            warnings: validation.warnings
          };
        }

        if (this._enableAutoFix && !validation.valid) {
          const fixed = this.autoFix(content, schema);
          if (fixed.success) {
            return {
              success: true,
              data: fixed.data,
              attempts,
              content: fixed.content,
              fixed: true,
              warnings: fixed.warnings
            };
          }
        }

        lastResult = {
          success: false,
          errors: validation.errors,
          warnings: validation.warnings,
          attempts
        };
      } else {
        if (this._enableAutoFix) {
          const fixed = this.autoFix(content, schema);
          if (fixed.success) {
            const validation = this.validate(fixed.data, schema);
            if (validation.valid) {
              return {
                success: true,
                data: fixed.data,
                attempts,
                content: fixed.content,
                fixed: true,
                warnings: validation.warnings
              };
            }
            lastResult = {
              success: false,
              errors: validation.errors,
              warnings: [...validation.warnings, ...fixed.warnings],
              attempts
            };
          } else {
            lastResult = {
              success: false,
              errors: fixed.errors,
              warnings: fixed.warnings,
              attempts
            };
          }
        } else {
          lastResult = {
            success: false,
            errors: [{ path: 'root', pathJsonPath: '$', message: 'Failed to extract valid JSON from content' }],
            warnings: [],
            attempts
          };
        }
      }

      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100 * attempts));
      }
    }

    return lastResult;
  }

  generateSchemaPrompt(schema, taskDescription = 'output') {
    const schemaStr = JSON.stringify(schema, null, 2);
    return `You must respond with ONLY a valid JSON object that matches this schema:
${schemaStr}

Requirements:
- Output must be valid JSON
- All required fields must be present
- Types must match exactly
- Do not include any text before or after the JSON

Example valid response:
${JSON.stringify(this._generateExample(schema), null, 2)}`;
  }

  _generateExample(schema) {
    if (!schema) return {};

    switch (schema.type) {
      case 'string':
        if (schema.enum) return schema.enum[0];
        if (schema.default !== undefined) return schema.default;
        return 'example';
      case 'number':
      case 'integer':
        if (schema.default !== undefined) return schema.default;
        return schema.type === 'integer' ? 42 : 3.14;
      case 'boolean':
        return true;
      case 'array':
        if (schema.items) {
          return [this._generateExample(schema.items)];
        }
        return [];
      case 'object':
        const obj = {};
        const props = schema.properties || {};
        const required = schema.required || [];
        for (const [key, propSchema] of Object.entries(props)) {
          if (!this._strictMode || required.includes(key)) {
            obj[key] = this._generateExample(propSchema);
          }
        }
        return obj;
      default:
        return null;
    }
  }

  predictAndWarm(requests, fetchFn, options = {}) {
    const predictions = this._analyzeRequestPatterns(requests);
    const warmed = [];
    const failed = [];

    const warm = async (request) => {
      try {
        const key = this._hashRequest(request);
        if (!this.has(request)) {
          const response = await fetchFn(request);
          this.set(request, response, options);
          warmed.push({ key, request });
        }
      } catch (e) {
        failed.push({ request, error: e.message });
      }
    };

    const batchSize = options.batchSize || 5;
    for (let i = 0; i < predictions.length; i += batchSize) {
      const batch = predictions.slice(i, i + batchSize);
      Promise.all(batch.map(warm));
    }

    return { warmed, failed, total: predictions.length };
  }

  _analyzeRequestPatterns(requests) {
    const frequency = new Map();
    for (const req of requests) {
      const key = this._hashRequest(req);
      frequency.set(key, (frequency.get(key) || 0) + 1);
    }
    return Array.from(frequency.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);
  }

  warmWithTTL(targetTtl = 0.8) {
    const entries = this.getEntries();
    const toWarm = entries.filter(e => {
      const ageRatio = e.age / e.ttl;
      return ageRatio >= targetTtl;
    });

    return {
      entries: toWarm.length,
      entriesDetail: toWarm.map(e => ({
        key: e.key,
        ageRatio: Math.round(e.age / e.ttl * 100) / 100,
        remainingTtl: e.remainingTtl
      }))
    };
  }

  setDistributedSync(nodes, key, value, options = {}) {
    const syncPromises = nodes.map(node => {
      if (node.set) return node.set(key, value, options);
      return Promise.resolve(false);
    });
    return Promise.all(syncPromises);
  }

  getDistributed(nodes, key) {
    const fetchPromises = nodes.map(node => {
      if (node.get) return node.get(key);
      return Promise.resolve(null);
    });
    return Promise.any(fetchPromises).catch(() => null);
  }

  invalidateDistributed(nodes, key) {
    const invalidatePromises = nodes.map(node => {
      if (node.invalidate) return node.invalidate(key);
      return Promise.resolve(false);
    });
    return Promise.all(invalidatePromises);
  }

  getDistributedStats(nodes) {
    return Promise.all(
      nodes.map(async (node, idx) => {
        if (node.getStats) {
          const stats = await node.getStats();
          return { node: idx, ...stats };
        }
        return { node: idx, error: 'Stats not available' };
      })
    );
  }

  optimizeForThroughput(targetQps) {
    const currentStats = this.getStats();
    if (currentStats.qps >= targetQps) {
      return { optimized: false, reason: 'Already meeting target QPS' };
    }

    const newMaxSize = Math.min(this._maxSize * 2, 5000);
    const newMaxMemory = Math.min(this._maxMemory * 2, 200 * 1024 * 1024);

    this.setMaxSize(newMaxSize);
    this.setMaxMemory(newMaxMemory);

    return {
      optimized: true,
      previousMaxSize: this._maxSize,
      newMaxSize,
      previousMaxMemory: this._maxMemory,
      newMaxMemory,
      estimatedQpsIncrease: '2x'
    };
  }

  getHitRateTrend(windowMs = 300000) {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    const hits = this._hits;
    const misses = this._misses;
    const total = hits + misses;

    return {
      hitRate: total > 0 ? hits / total : 0,
      hits,
      misses,
      windowMs,
      estimate: hits / (windowMs / 1000) * 60
    };
  }
}

export class StreamingValidator {
  constructor(options = {}) {
    this._schema = null;
    this._validator = new StructuredOutputValidator(options);
    this._buffer = '';
    this._depth = 0;
    this._inString = false;
    this._escape = false;
    this._currentPath = '';
    this._errors = [];
    this._warnings = [];
    this._validating = false;
    this._aborted = false;
    this._complete = false;
    this._tokenCount = 0;
    this._onError = options.onError || null;
    this._onWarning = options.onWarning || null;
    this._onProgress = options.onProgress || null;
    this._maxErrors = options.maxErrors || 10;
    this._earlyStop = options.earlyStop !== false;
  }

  setSchema(schema) {
    this._schema = schema;
    this.reset();
    return this;
  }

  reset() {
    this._buffer = '';
    this._depth = 0;
    this._inString = false;
    this._escape = false;
    this._currentPath = '';
    this._errors = [];
    this._warnings = [];
    this._validating = false;
    this._aborted = false;
    this._complete = false;
    this._tokenCount = 0;
    return this;
  }

  async *validateStream(stream, schema) {
    if (!schema) {
      throw new Error('Schema is required for streaming validation');
    }

    this._schema = schema;
    this.reset();
    this._validating = true;

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let chunkCount = 0;

    try {
      while (!this._aborted) {
        const { done, value } = await reader.read();

        if (done) {
          if (this._buffer.trim()) {
            yield this._finalize();
          }
          break;
        }

        chunkCount++;
        this._tokenCount += value.length;

        const text = decoder.decode(value, { stream: true });
        this._buffer += text;

        const result = this._processBuffer();

        if (this._onProgress) {
          this._onProgress({
            chunk: chunkCount,
            tokens: this._tokenCount,
            bufferLength: this._buffer.length,
            progress: this._estimateProgress(),
            partial: result
          });
        }

        if (result.errors && result.errors.length > 0 && this._earlyStop) {
          this._aborted = true;
          yield {
            valid: false,
            partial: true,
            aborted: true,
            errors: result.errors,
            warnings: result.warnings,
            tokensReceived: this._tokenCount,
            chunksProcessed: chunkCount,
            message: 'Validation failed early - stream aborted to save tokens'
          };
          break;
        }

        yield {
          valid: result.valid,
          partial: true,
          aborted: false,
          errors: result.errors || [],
          warnings: result.warnings || [],
          tokensReceived: this._tokenCount,
          chunksProcessed: chunkCount,
          progress: this._estimateProgress(),
          bufferPreview: this._buffer.slice(-100)
        };
      }
    } finally {
      reader.releaseLock();
      this._validating = false;
    }
  }

  _processBuffer() {
    const errors = [];
    const warnings = [];

    if (!this._schema) {
      return { valid: false, errors: [{ message: 'No schema set' }], warnings: [] };
    }

    const validation = this._partialValidate(this._buffer, this._schema);
    
    if (validation.fatal) {
      errors.push(...validation.errors);
      this._errors.push(...validation.errors);
    } else {
      errors.push(...validation.errors);
      warnings.push(...validation.warnings);
      this._errors.push(...validation.errors);
      this._warnings.push(...validation.warnings);
    }

    if (this._errors.length > this._maxErrors) {
      this._aborted = true;
    }

    return {
      valid: errors.length === 0 && !validation.fatal,
      errors: this._errors.slice(-this._maxErrors),
      warnings: this._warnings.slice(-this._maxErrors),
      progress: this._estimateProgress(),
      isComplete: validation.complete
    };
  }

  _partialValidate(buffer, schema) {
    const errors = [];
    const warnings = [];
    let fatal = false;
    let complete = false;

    const trimmed = buffer.trim();

    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return { valid: false, errors: [{ message: 'Invalid JSON start', path: 'root' }], warnings: [], fatal: true, complete: false };
    }

    try {
      const parsed = JSON.parse(trimmed);
      complete = true;
      const fullValidation = this._validator.validate(parsed, schema);
      return {
        valid: fullValidation.valid,
        errors: fullValidation.errors,
        warnings: fullValidation.warnings,
        fatal: false,
        complete: true
      };
    } catch (e) {
      const parseError = e.message;

      if (parseError.includes('Unexpected end')) {
        return { valid: true, errors: [], warnings: [], fatal: false, complete: false };
      }

      const errorPatterns = [
        { pattern: /position (\d+)/, type: 'position' },
        { pattern: /at line (\d+)/, type: 'line' }
      ];

      let errorInfo = { position: 0, message: parseError };
      for (const ep of errorPatterns) {
        const match = parseError.match(ep.pattern);
        if (match) {
          errorInfo = { position: parseInt(match[1]), type: ep.type };
          break;
        }
      }

      const pathInfo = this._inferPathFromPosition(buffer, errorInfo.position);
      
      if (errorInfo.position > buffer.length * 0.8) {
        return { valid: true, errors: [], warnings: [{ message: 'Almost complete, waiting for more data', path: pathInfo.path }], fatal: false, complete: false };
      }

      errors.push({
        path: pathInfo.path,
        pathJsonPath: this._toJsonPath(pathInfo.path),
        message: `Parse error near '${pathInfo.context}': ${parseError}`,
        position: errorInfo.position,
        recoverable: errorInfo.position > buffer.length * 0.5
      });

      return { valid: false, errors, warnings, fatal: errorInfo.position < buffer.length * 0.3, complete: false };
    }
  }

  _inferPathFromPosition(buffer, position) {
    const beforeError = buffer.substring(0, Math.min(position, buffer.length));
    const afterError = buffer.substring(position);
    
    const openBraces = (beforeError.match(/\{/g) || []).length;
    const closeBraces = (beforeError.match(/\}/g) || []).length;
    const openBrackets = (beforeError.match(/\[/g) || []).length;
    const closeBrackets = (beforeError.match(/\]/g) || []).length;

    let path = '$';
    
    const braceDepth = openBraces - closeBraces;
    const bracketDepth = openBrackets - closeBrackets;

    if (braceDepth > 0) {
      const lastKey = beforeError.match(/"([^"]+)"\s*:/g);
      if (lastKey) {
        path = `$.${lastKey[lastKey.length - 1].replace(/[":]/g, '')}`;
      }
    }

    if (bracketDepth > 0) {
      const arrayContent = beforeError.substring(beforeError.lastIndexOf('['));
      const items = (arrayContent.match(/,/g) || []).length;
      path += `[${items}]`;
    }

    const contextMatch = beforeError.match(/"([^"]+)"\s*$/);
    const context = contextMatch ? contextMatch[1] : buffer.substring(Math.max(0, position - 20), position);

    return { path, context: context.slice(-30) };
  }

  _estimateProgress() {
    if (!this._schema) return 0;

    const props = this._schema.properties ? Object.keys(this._schema.properties).length : 0;
    if (props === 0) return 0.5;

    const buffer = this._buffer;
    
    let foundProps = 0;
    for (const key of Object.keys(this._schema.properties || {})) {
      if (buffer.includes(`"${key}"`)) {
        foundProps++;
      }
    }

    const structureScore = buffer.includes('{') && buffer.includes('}') ? 0.3 : 
                          buffer.includes('{') ? 0.15 : 0;

    const propertyScore = (foundProps / props) * 0.7;

    return Math.min(0.95, structureScore + propertyScore);
  }

  _toJsonPath(path) {
    return path.replace(/^\./, '').replace(/\.\[(\d+)\]/g, '[$1]').replace(/\.([^.\[\]]+)/g, '.$1');
  }

  _finalize() {
    const trimmed = this._buffer.trim();

    try {
      const parsed = JSON.parse(trimmed);
      const validation = this._validator.validate(parsed, this._schema);
      
      this._complete = true;

      return {
        valid: validation.valid,
        partial: false,
        aborted: false,
        complete: true,
        data: validation.valid ? parsed : null,
        errors: validation.errors,
        warnings: validation.warnings,
        tokensReceived: this._tokenCount,
        message: validation.valid ? 'Validation passed' : 'Validation failed'
      };
    } catch (e) {
      return {
        valid: false,
        partial: true,
        aborted: false,
        complete: false,
        errors: [{ message: `Final parse failed: ${e.message}` }],
        warnings: [],
        tokensReceived: this._tokenCount,
        message: 'Stream ended but JSON incomplete'
      };
    }
  }

  validateChunk(chunk, isLast = false) {
    this._buffer += chunk;
    this._tokenCount += chunk.length;

    if (isLast) {
      return this._finalize();
    }

    return this._processBuffer();
  }

  getStatus() {
    return {
      isValidating: this._validating,
      isAborted: this._aborted,
      isComplete: this._complete,
      bufferLength: this._buffer.length,
      tokenCount: this._tokenCount,
      errorCount: this._errors.length,
      warningCount: this._warnings.length,
      progress: this._estimateProgress(),
      schemaSet: !!this._schema
    };
  }

  abort() {
    this._aborted = true;
    return {
      tokensProcessed: this._tokenCount,
      errorsFound: this._errors.length,
      savedTokens: this._estimateSavedTokens()
    };
  }

  _estimateSavedTokens() {
    const avgTokenSize = 4;
    const estimatedTotalTokens = this._buffer.length / avgTokenSize;
    const processedTokens = this._tokenCount / avgTokenSize;
    return Math.max(0, Math.floor(estimatedTotalTokens * 0.3));
  }

  getErrors() {
    return this._errors.slice();
  }

  getWarnings() {
    return this._warnings.slice();
  }

  getBufferPreview(length = 100) {
    return this._buffer.slice(-length);
  }
}

export class ValidationErrorExplainer {
  constructor(options = {}) {
    this._locale = options.locale || 'en';
    this._includeCode = options.includeCode !== false;
    this._includeExamples = options.includeExamples !== false;
    this._explanationCache = new Map();
  }

  explain(validationResult, schema, context = {}) {
    if (validationResult.valid) {
      return {
        valid: true,
        message: 'Validation passed successfully',
        explanations: []
      };
    }

    const explanations = validationResult.errors.map(error => {
      const explanation = this._explainError(error, schema, context);
      return {
        ...error,
        explanation: explanation.message,
        severity: explanation.severity,
        fixSuggestion: explanation.fix,
        codeExample: this._includeCode ? explanation.code : null,
        learnMore: explanation.link
      };
    });

    const criticalIssues = explanations.filter(e => e.severity === 'critical');
    const majorIssues = explanations.filter(e => e.severity === 'major');
    const minorIssues = explanations.filter(e => e.severity === 'minor');

    return {
      valid: false,
      totalErrors: validationResult.errors.length,
      criticalCount: criticalIssues.length,
      majorCount: majorIssues.length,
      minorCount: minorIssues.length,
      message: this._generateSummary(validationResult.errors.length, criticalIssues.length, majorIssues.length),
      explanations,
      criticalIssues,
      majorIssues,
      minorIssues,
      overallFixDifficulty: this._calculateFixDifficulty(explanations),
      estimatedFixTime: this._estimateFixTime(explanations)
    };
  }

  _explainError(error, schema, context = {}) {
    const errorType = this._classifyError(error);
    const pathInfo = this._getFieldInfo(error.path, schema);

    switch (errorType) {
      case 'missing_required':
        return {
          message: `The required field '${pathInfo.fieldName}' is missing.`,
          severity: 'critical',
          fix: `Add the field '${pathInfo.fieldName}' with a ${pathInfo.expectedType} value.`,
          code: `{\n  "${pathInfo.fieldName}": <${pathInfo.expectedType}${pathInfo.defaultValue !== undefined ? `, default: ${JSON.stringify(pathInfo.defaultValue)}` : ''}>\n}`,
          link: `https://docs.example.com/schemas#required-fields`
        };

      case 'type_mismatch':
        return {
          message: `Expected ${pathInfo.expectedType} but received ${error.received || typeof error.received}.`,
          severity: 'critical',
          fix: `Convert the value at '${pathInfo.fieldName}' to a ${pathInfo.expectedType}.`,
          code: `// Current: ${error.received}\n// Fix:\nconst fixed = ${this._getConversionCode(pathInfo.expectedType, pathInfo.fieldName)};`,
          link: `https://docs.example.com/schemas#type-conversion`
        };

      case 'invalid_enum':
        const validOptions = pathInfo.enumValues || [];
        return {
          message: `Value '${error.received}' is not in the allowed values: ${validOptions.join(', ')}.`,
          severity: 'major',
          fix: `Use one of the valid values: ${validOptions.join(' | ')}.`,
          code: `// Use one of:\n${validOptions.map(v => `  "${v}"`).join('\n')}`,
          link: `https://docs.example.com/schemas#enums`
        };

      case 'string_too_short':
        return {
          message: `String is too short (${error.received} chars), minimum is ${error.expected}.`,
          severity: 'major',
          fix: `Provide a string with at least ${error.expected} characters.`,
          code: `// Current length: ${error.received}\n// Minimum: ${error.expected}`,
          link: `https://docs.example.com/schemas#string-constraints`
        };

      case 'string_too_long':
        return {
          message: `String exceeds maximum length (${error.received} chars), maximum is ${error.expected}.`,
          severity: 'minor',
          fix: `Truncate the string to ${error.expected} characters or less.`,
          code: `const truncated = value.substring(0, ${error.expected});`,
          link: `https://docs.example.com/schemas#string-constraints`
        };

      case 'number_out_of_range':
        const rangeType = error.received < error.expected ? 'minimum' : 'maximum';
        return {
          message: `Number ${rangeType} is ${error.expected}, but got ${error.received}.`,
          severity: 'major',
          fix: `Ensure the value is between the allowed range.`,
          code: `// Use a value between ${schema.properties?.[pathInfo.fieldName]?.minimum || 'min'} and ${schema.properties?.[pathInfo.fieldName]?.maximum || 'max'}`,
          link: `https://docs.example.com/schemas#number-constraints`
        };

      case 'invalid_pattern':
        return {
          message: `String does not match the required pattern: ${error.expected}.`,
          severity: 'major',
          fix: `Ensure the string matches the pattern regex: ${error.expected}`,
          code: `// Pattern: ${error.expected}\nconst matches = /${error.expected}/.test(value);`,
          link: `https://docs.example.com/schemas#patterns`
        };

      case 'array_too_short':
        return {
          message: `Array has ${error.received} items, minimum required is ${error.expected}.`,
          severity: 'major',
          fix: `Add at least ${error.expected - error.received} more item(s) to the array.`,
          code: `// Current: ${error.received} items\n// Required: ${error.expected} items\narray.push(...newItems);`,
          link: `https://docs.example.com/schemas#array-constraints`
        };

      case 'array_too_long':
        return {
          message: `Array has ${error.received} items, maximum allowed is ${error.expected}.`,
          severity: 'minor',
          fix: `Remove ${error.received - error.expected} item(s) from the array.`,
          code: `const trimmed = array.slice(0, ${error.expected});`,
          link: `https://docs.example.com/schemas#array-constraints`
        };

      case 'unexpected_field':
        return {
          message: `Field '${error.received}' is not allowed in this schema.`,
          severity: 'minor',
          fix: `Remove the unexpected field '${error.received}' or set 'additionalProperties: true' in schema.`,
          code: `// Remove this field:\ndelete object['${error.received}'];`,
          link: `https://docs.example.com/schemas#additional-properties`
        };

      case 'condition_failed':
        return {
          message: `Conditional validation failed: ${error.message}`,
          severity: 'major',
          fix: `Check the conditional rules for this field based on related field values.`,
          code: `// Review the 'if/then' conditions in your schema definition`,
          link: `https://docs.example.com/schemas#conditions`
        };

      case 'custom_validation':
        return {
          message: `Custom validation failed: ${error.message}`,
          severity: 'major',
          fix: `Fix the custom validation logic for this field.`,
          code: `// Check custom validator: ${error.expected}`,
          link: `https://docs.example.com/schemas#custom-validators`
        };

      default:
        return {
          message: error.message || `Validation failed at '${error.path}'`,
          severity: 'minor',
          fix: `Review the value at '${error.path}' and ensure it matches the schema requirements.`,
          code: null,
          link: `https://docs.example.com/schemas`
        };
    }
  }

  _classifyError(error) {
    const msg = (error.message || '').toLowerCase();
    const path = error.path || '';

    if (msg.includes('missing required')) return 'missing_required';
    if (msg.includes('expected') && msg.includes('received')) return 'type_mismatch';
    if (msg.includes('must be one of') || msg.includes('enum')) return 'invalid_enum';
    if (msg.includes('length') && msg.includes('less than')) return 'string_too_short';
    if (msg.includes('length') && msg.includes('exceeds')) return 'string_too_long';
    if (msg.includes('less than minimum') || msg.includes('exceeds maximum')) return 'number_out_of_range';
    if (msg.includes('does not match pattern')) return 'invalid_pattern';
    if (msg.includes('length') && msg.includes('less than') && msg.includes('array')) return 'array_too_short';
    if (msg.includes('length') && msg.includes('exceeds') && msg.includes('array')) return 'array_too_long';
    if (msg.includes('unexpected field')) return 'unexpected_field';
    if (msg.includes('condition')) return 'condition_failed';
    if (msg.includes('custom validation') || msg.includes('validator')) return 'custom_validation';
    return 'unknown';
  }

  _getFieldInfo(path, schema) {
    const parts = path.replace(/^\$\.?/, '').split(/\.|\[/).filter(Boolean);
    let current = schema;
    let fieldName = parts[parts.length - 1]?.replace(/\]/g, '') || 'root';
    let expectedType = 'any';
    let enumValues = null;
    let defaultValue = undefined;

    for (const part of parts) {
      if (current?.properties?.[part]) {
        current = current.properties[part];
      } else if (current?.items?.properties?.[part]) {
        current = current.items.properties[part];
      } else if (current?.items) {
        current = current.items;
      }
    }

    if (current) {
      expectedType = current.type || 'any';
      enumValues = current.enum;
      defaultValue = current.default;
    }

    return { fieldName, expectedType, enumValues, defaultValue };
  }

  _getConversionCode(targetType, fieldName) {
    switch (targetType) {
      case 'string':
        return `String(value.${fieldName})`;
      case 'number':
      case 'integer':
        return `Number(value.${fieldName})`;
      case 'boolean':
        return `Boolean(value.${fieldName})`;
      case 'array':
        return `Array.isArray(value.${fieldName}) ? value.${fieldName} : [value.${fieldName}]`;
      default:
        return `value.${fieldName}`;
    }
  }

  _generateSummary(total, critical, major) {
    if (critical > 0) {
      return `Found ${critical} critical error(s) that must be fixed. ${total > critical ? `${total - critical} other issue(s) also need attention.` : ''}`;
    }
    if (major > 0) {
      return `Found ${major} major issue(s) that should be fixed. ${total > major ? `${total - major} minor issue(s) also exist.` : ''}`;
    }
    return `Found ${total} minor issue(s) that could be improved.`;
  }

  _calculateFixDifficulty(explanations) {
    const critical = explanations.filter(e => e.severity === 'critical').length;
    const major = explanations.filter(e => e.severity === 'major').length;

    if (critical > 3) return 'hard';
    if (critical > 0 || major > 5) return 'medium';
    return 'easy';
  }

  _estimateFixTime(explanations) {
    const critical = explanations.filter(e => e.severity === 'critical').length;
    const major = explanations.filter(e => e.severity === 'major').length;
    const minor = explanations.filter(e => e.severity === 'minor').length;

    const minutes = critical * 5 + major * 2 + minor * 0.5;

    if (minutes < 5) return '~1 minute';
    if (minutes < 15) return '~5 minutes';
    if (minutes < 30) return '~10-15 minutes';
    return `~${Math.ceil(minutes / 5) * 5} minutes`;
  }
}

export class SchemaAutoGenerator {
  constructor(options = {}) {
    this._strictMode = options.strictMode !== false;
    this._requiredByDefault = options.requiredByDefault !== false;
    this._inferEnums = options.inferEnums !== false;
    this._typeInferenceDepth = options.typeInferenceDepth || 3;
  }

  fromTypeScript(typeString) {
    try {
      const cleaned = this._preprocessTypeScript(typeString);
      const schema = this._parseTypeScript(cleaned);
      return { success: true, schema };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  _preprocessTypeScript(typeString) {
    return typeString
      .replace(/interface\s+\w+\s+/g, 'type __TEMP__ = ')
      .replace(/:\s*string(\s*[;=])/gi, ': "STRING"$1')
      .replace(/:\s*number(\s*[;=])/gi, ': "NUMBER"$1')
      .replace(/:\s*boolean(\s*[;=])/gi, ': "BOOLEAN"$1')
      .replace(/:\s*\[\](\s*[;=])/gi, ': "ARRAY"$1')
      .replace(/:\s*\{(\s*)\}/gi, ': "OBJECT"$1')
      .replace(/string\[\]/gi, '"STRING"[]')
      .replace(/number\[\]/gi, '"NUMBER"[]')
      .replace(/boolean\[\]/gi, '"BOOLEAN"[]');
  }

  _parseTypeScript(typeString) {
    const jsonMatch = typeString.match(/=\s*(\{[\s\S]*\})/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {}
    }

    const typeMap = {
      'STRING': 'string',
      'NUMBER': 'number',
      'BOOLEAN': 'boolean',
      'ARRAY': 'array',
      'OBJECT': 'object'
    };

    let result = typeString;
    for (const [key, value] of Object.entries(typeMap)) {
      result = result.replace(new RegExp(`"${key}"`, 'g'), `"${value}"`);
    }

    if (result.includes('?')) {
      const optionalFields = result.match(/\w+\?\s*:/g) || [];
      for (const field of optionalFields) {
        const fieldName = field.replace('?', '').replace(':', '').trim();
      }
    }

    return this._inferSchemaFromObject({ type: 'object' });
  }

  fromObject(obj, options = {}) {
    const maxDepth = options.maxDepth || this._typeInferenceDepth;
    const required = options.required || [];
    const inferEnums = options.inferEnums !== false;

    const schema = this._inferFromValue(obj, 'root', 0, maxDepth, required, inferEnums);
    
    return {
      success: true,
      schema: {
        type: 'object',
        ...schema
      }
    };
  }

  _inferFromValue(value, path, depth, maxDepth, required, inferEnums) {
    if (depth > maxDepth) {
      return { type: 'any' };
    }

    if (value === null) {
      return { type: 'null', description: path };
    }

    if (value === undefined) {
      return { type: 'any', description: path };
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return { type: 'array', items: {} };
      }

      const itemTypes = value.map((item, i) => this._inferFromValue(item, `${path}[${i}]`, depth + 1, maxDepth, required, inferEnums));
      const firstItem = itemTypes[0];
      const allSameType = itemTypes.every(t => t.type === firstItem.type);

      if (allSameType) {
        return {
          type: 'array',
          items: firstItem,
          minItems: 1
        };
      }

      return {
        type: 'array',
        items: { type: 'any' }
      };
    }

    if (typeof value === 'object') {
      const properties = {};
      const requiredFields = [];

      for (const [key, val] of Object.entries(value)) {
        properties[key] = this._inferFromValue(val, `${path}.${key}`, depth + 1, maxDepth, required, inferEnums);

        if (this._isRequired(key, required)) {
          requiredFields.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required: requiredFields.length > 0 ? requiredFields : undefined,
        additionalProperties: false
      };
    }

    switch (typeof value) {
      case 'string':
        if (inferEnums && this._looksLikeEnum(value)) {
          return { type: 'string', enum: this._extractEnumValues(value) };
        }
        if (this._isEmail(value)) return { type: 'string', format: 'email' };
        if (this._isUrl(value)) return { type: 'string', format: 'uri' };
        if (this._isDate(value)) return { type: 'string', format: 'date-time' };
        if (this._isUuid(value)) return { type: 'string', format: 'uuid' };
        if (value.length < 50) return { type: 'string', description: path };
        return { type: 'string', maxLength: value.length, description: path };

      case 'number':
        if (Number.isInteger(value)) {
          return { type: 'integer', description: path };
        }
        return { type: 'number', description: path };

      case 'boolean':
        return { type: 'boolean', description: path };

      default:
        return { type: 'any', description: path };
    }
  }

  _isRequired(fieldName, required) {
    if (!this._requiredByDefault) return false;
    if (Array.isArray(required)) return required.includes(fieldName);
    return true;
  }

  _looksLikeEnum(value) {
    const enumIndicators = ['_id', '_type', '_status', 'state', 'status', 'type', 'kind'];
    return enumIndicators.some(ind => value.toLowerCase().includes(ind));
  }

  _extractEnumValues(value) {
    const baseValue = value.replace(/[0-9]+$/, '');
    const numberMatch = value.match(/[0-9]+$/);
    if (numberMatch) {
      const num = parseInt(numberMatch[0]);
      if (num >= 1 && num <= 10) {
        return Array.from({ length: num }, (_, i) => `${baseValue}${i + 1}`);
      }
    }
    return [value];
  }

  _isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  _isUrl(value) {
    return /^https?:\/\/.+/.test(value);
  }

  _isDate(value) {
    return /^\d{4}-\d{2}-\d{2}/.test(value) && !isNaN(Date.parse(value));
  }

  _isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  fromJsonSchema(jsonSchema) {
    try {
      const schema = this._convertJsonSchema(jsonSchema);
      return { success: true, schema };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  _convertJsonSchema(jsonSchema) {
    const result = {
      type: jsonSchema.type || 'object',
      description: jsonSchema.description
    };

    if (jsonSchema.properties) {
      result.properties = {};
      for (const [key, prop] of Object.entries(jsonSchema.properties)) {
        result.properties[key] = this._convertJsonSchema(prop);
      }
    }

    if (jsonSchema.required) {
      result.required = jsonSchema.required;
    }

    if (jsonSchema.enum) {
      result.enum = jsonSchema.enum;
    }

    if (jsonSchema.minimum !== undefined) result.minimum = jsonSchema.minimum;
    if (jsonSchema.maximum !== undefined) result.maximum = jsonSchema.maximum;
    if (jsonSchema.minLength !== undefined) result.minLength = jsonSchema.minLength;
    if (jsonSchema.maxLength !== undefined) result.maxLength = jsonSchema.maxLength;
    if (jsonSchema.pattern) result.pattern = jsonSchema.pattern;
    if (jsonSchema.items) result.items = this._convertJsonSchema(jsonSchema.items);
    if (jsonSchema.additionalProperties !== undefined) {
      result.additionalProperties = jsonSchema.additionalProperties;
    }

    return result;
  }

  generateExamples(schema, count = 3) {
    const examples = [];
    for (let i = 0; i < count; i++) {
      examples.push(this._generateExample(schema, i));
    }
    return examples;
  }

  _generateExample(schema, index = 0) {
    if (!schema) return null;

    switch (schema.type) {
      case 'string':
        if (schema.enum) return schema.enum[index % schema.enum.length];
        if (schema.format === 'email') return `user${index}@example.com`;
        if (schema.format === 'uri') return `https://example.com/item${index}`;
        if (schema.format === 'date-time') return new Date().toISOString();
        if (schema.format === 'uuid') return `550e8400-e29b-41c4-a712-${String(index).padStart(12, '0')}`;
        if (schema.default !== undefined) return schema.default;
        return `example_${index}`;

      case 'number':
      case 'integer':
        if (schema.enum) return schema.enum[index % schema.enum.length];
        if (schema.minimum !== undefined && schema.maximum !== undefined) {
          return schema.minimum + Math.floor((schema.maximum - schema.minimum) * Math.random());
        }
        if (schema.default !== undefined) return schema.default;
        return schema.type === 'integer' ? index + 1 : 3.14;

      case 'boolean':
        return index % 2 === 0;

      case 'array':
        const items = [];
        const count = schema.minItems || Math.min(3, index + 1);
        for (let i = 0; i < count; i++) {
          items.push(this._generateExample(schema.items, i));
        }
        return items;

      case 'object':
        const obj = {};
        const props = schema.properties || {};
        const required = schema.required || [];
        for (const [key, propSchema] of Object.entries(props)) {
          if (required.includes(key) || !this._strictMode) {
            obj[key] = this._generateExample(propSchema, index);
          }
        }
        return obj;

      default:
        return null;
    }
  }

  diff(schemaA, schemaB) {
    const differences = [];

    this._compareSchemas(schemaA, schemaB, '', differences);

    return {
      areEqual: differences.length === 0,
      differences,
      breakingChanges: differences.filter(d => d.breaking),
      summary: this._summarizeDiff(differences)
    };
  }

  _compareSchemas(a, b, path, differences) {
    if (a.type !== b.type) {
      differences.push({
        path,
        type: 'type_changed',
        from: a.type,
        to: b.type,
        breaking: true
      });
      return;
    }

    if (a.type === 'object') {
      const aProps = Object.keys(a.properties || {});
      const bProps = Object.keys(b.properties || {});

      for (const prop of aProps) {
        if (!bProps.includes(prop)) {
          differences.push({
            path: `${path}.${prop}`,
            type: 'property_removed',
            from: a.properties[prop],
            to: null,
            breaking: true
          });
        }
      }

      for (const prop of bProps) {
        if (!aProps.includes(prop)) {
          differences.push({
            path: `${path}.${prop}`,
            type: 'property_added',
            from: null,
            to: b.properties[prop],
            breaking: false
          });
        }
      }

      for (const prop of aProps) {
        if (bProps.includes(prop)) {
          this._compareSchemas(a.properties[prop], b.properties[prop], `${path}.${prop}`, differences);
        }
      }
    }

    if (a.enum && b.enum) {
      const aEnum = new Set(a.enum);
      const removed = a.enum.filter(v => !aEnum.has(v));
      if (removed.length > 0) {
        differences.push({
          path,
          type: 'enum_values_removed',
          from: a.enum,
          to: b.enum,
          breaking: true
        });
      }
    }

    const constraints = ['minimum', 'maximum', 'minLength', 'maxLength', 'required'];
    for (const constraint of constraints) {
      if (a[constraint] !== b[constraint]) {
        differences.push({
          path,
          type: `constraint_${constraint}_changed`,
          from: a[constraint],
          to: b[constraint],
          breaking: ['minimum', 'required'].includes(constraint)
        });
      }
    }
  }

  _summarizeDiff(differences) {
    const breaking = differences.filter(d => d.breaking);
    const added = differences.filter(d => d.type === 'property_added');
    const removed = differences.filter(d => d.type === 'property_removed');

    return {
      totalChanges: differences.length,
      breakingChanges: breaking.length,
      additions: added.length,
      removals: removed.length,
      message: breaking.length > 0 
        ? `⚠️ Breaking: ${breaking.length} change(s) that may break existing data`
        : '✅ No breaking changes detected'
    };
  }
}

export class SchemaVersionManager {
  constructor(options = {}) {
    this._versions = new Map();
    this._currentVersion = null;
    this._migrationStrategies = new Map();
    this._changePolicies = options.changePolicies || {
      allowBreaking: false,
      autoMigrate: true,
      keepOldVersions: true
    };
    this._migrationHistory = [];
  }

  registerVersion(versionId, schema, metadata = {}) {
    if (this._versions.has(versionId)) {
      throw new Error(`Version '${versionId}' already exists`);
    }

    const version = {
      id: versionId,
      schema,
      metadata,
      createdAt: Date.now(),
      usageCount: 0,
      migrationCount: 0
    };

    this._versions.set(versionId, version);

    if (!this._currentVersion) {
      this._currentVersion = versionId;
    }

    return this;
  }

  setCurrentVersion(versionId) {
    if (!this._versions.has(versionId)) {
      throw new Error(`Version '${versionId}' not found`);
    }

    const oldVersion = this._currentVersion;
    this._currentVersion = versionId;
    this._versions.get(versionId).usageCount++;

    return {
      previous: oldVersion,
      current: versionId
    };
  }

  getVersion(versionId = null) {
    const id = versionId || this._currentVersion;
    return this._versions.get(id) || null;
  }

  getCurrentSchema() {
    return this.getVersion(this._currentVersion)?.schema || null;
  }

  getAllVersions() {
    return Array.from(this._versions.entries()).map(([id, v]) => ({
      id,
      metadata: v.metadata,
      createdAt: v.createdAt,
      usageCount: v.usageCount,
      migrationCount: v.migrationCount,
      isCurrent: id === this._currentVersion
    }));
  }

  registerMigrationStrategy(fromVersion, toVersion, strategy) {
    const key = `${fromVersion}->${toVersion}`;
    this._migrationStrategies.set(key, strategy);
    return this;
  }

  migrate(data, fromVersion, toVersion = null) {
    const targetVersion = toVersion || this._currentVersion;
    
    if (fromVersion === targetVersion) {
      return { data, migrations: [], success: true };
    }

    const migrationPath = this._findMigrationPath(fromVersion, targetVersion);
    if (!migrationPath) {
      return { 
        data: null, 
        migrations: [], 
        success: false, 
        error: `No migration path found from '${fromVersion}' to '${targetVersion}'` 
      };
    }

    let currentData = data;
    const migrations = [];

    for (let i = 0; i < migrationPath.length - 1; i++) {
      const from = migrationPath[i];
      const to = migrationPath[i + 1];
      const key = `${from}->${to}`;
      const strategy = this._migrationStrategies.get(key);

      if (!strategy) {
        return {
          data: null,
          migrations,
          success: false,
          error: `No migration strategy for ${key}`
        };
      }

      const startTime = Date.now();
      try {
        const result = strategy.transform(currentData);
        const duration = Date.now() - startTime;

        migrations.push({
          from,
          to,
          duration,
          success: true
        });

        currentData = result;
      } catch (error) {
        migrations.push({
          from,
          to,
          duration: Date.now() - startTime,
          success: false,
          error: error.message
        });

        return {
          data: null,
          migrations,
          success: false,
          error: `Migration failed at ${from}->${to}: ${error.message}`
        };
      }
    }

    const targetVersionEntry = this._versions.get(targetVersion);
    if (targetVersionEntry) {
      targetVersionEntry.migrationCount++;
    }

    this._migrationHistory.push({
      timestamp: Date.now(),
      fromVersion,
      toVersion: targetVersion,
      migrations: migrations.length,
      success: true
    });

    return {
      data: currentData,
      migrations,
      success: true
    };
  }

  _findMigrationPath(from, to) {
    const graph = new Map();
    
    for (const [key] of this._migrationStrategies) {
      const [fromV, toV] = key.split('->');
      if (!graph.has(fromV)) graph.set(fromV, []);
      graph.get(fromV).push(toV);
    }

    const visited = new Set();
    const path = [];

    const dfs = (current) => {
      if (current === to) {
        return true;
      }

      visited.add(current);
      path.push(current);

      const neighbors = graph.get(current) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) {
            return true;
          }
        }
      }

      path.pop();
      return false;
    };

    if (dfs(from)) {
      path.push(to);
      return path;
    }

    for (const [versionId] of this._versions) {
      visited.clear();
      path.length = 0;
      if (dfs(versionId)) {
        path.push(to);
        return path;
      }
    }

    return null;
  }

  canMigrate(fromVersion, toVersion = null) {
    const target = toVersion || this._currentVersion;
    return this._findMigrationPath(fromVersion, target) !== null;
  }

  getMigrationStatus(fromVersion, toVersion = null) {
    const target = toVersion || this._currentVersion;
    const path = this._findMigrationPath(fromVersion, target);

    if (!path) {
      return {
        possible: false,
        path: null,
        steps: 0,
        estimatedComplexity: 'unknown'
      };
    }

    return {
      possible: true,
      path,
      steps: path.length - 1,
      estimatedComplexity: path.length <= 2 ? 'simple' : path.length <= 4 ? 'moderate' : 'complex'
    };
  }

  rollback(times = 1) {
    const history = this._migrationHistory;
    if (history.length === 0) {
      return { success: false, error: 'No migrations to rollback' };
    }

    const lastMigration = history[history.length - 1];
    const rollbackResult = this.migrate(
      null,
      lastMigration.toVersion,
      lastMigration.fromVersion
    );

    if (rollbackResult.success) {
      history.pop();
    }

    return rollbackResult;
  }

  getMigrationHistory() {
    return [...this._migrationHistory];
  }

  getVersionStats() {
    const versions = Array.from(this._versions.entries());
    
    return {
      totalVersions: versions.length,
      currentVersion: this._currentVersion,
      totalMigrations: this._migrationHistory.length,
      migrationsByVersion: versions.reduce((acc, [id, v]) => {
        acc[id] = v.migrationCount;
        return acc;
      }, {}),
      usageByVersion: versions.reduce((acc, [id, v]) => {
        acc[id] = v.usageCount;
        return acc;
      }, {})
    };
  }

  registerDefaultMigrations() {
    this.registerMigrationStrategy('1.0', '2.0', {
      transform: (data) => {
        const migrated = { ...data };
        if (migrated.name !== undefined && migrated.fullName === undefined) {
          migrated.fullName = migrated.name;
          delete migrated.name;
        }
        return migrated;
      },
      description: 'Renamed name to fullName'
    });

    this.registerMigrationStrategy('2.0', '3.0', {
      transform: (data) => {
        const migrated = { ...data };
        migrated.metadata = {
          version: '3.0',
          migratedFrom: '2.0',
          migratedAt: Date.now()
        };
        return migrated;
      },
      description: 'Added metadata wrapper'
    });

    return this;
  }
}

export class FormatConverter {
  constructor(options = {}) {
    this._markdownOptions = options.markdown || {};
    this._htmlOptions = options.html || {};
  }

  markdownToJson(markdown) {
    const result = {
      content: [],
      metadata: {}
    };

    const lines = markdown.split('\n');
    let currentBlock = null;

    for (const line of lines) {
      if (line.startsWith('#')) {
        const match = line.match(/^(#{1,6})\s+(.+)$/);
        if (match) {
          result.content.push({
            type: 'heading',
            level: match[1].length,
            text: match[2]
          });
        }
      } else if (line.startsWith('```')) {
        const lang = line.match(/^```(\w*)/)?.[1] || '';
        if (currentBlock) {
          result.content.push(currentBlock);
          currentBlock = null;
        } else {
          currentBlock = { type: 'code', language: lang, code: '' };
        }
      } else if (currentBlock) {
        currentBlock.code += line + '\n';
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        result.content.push({
          type: 'list_item',
          text: line.substring(2)
        });
      } else if (line.startsWith('> ')) {
        result.content.push({
          type: 'blockquote',
          text: line.substring(2)
        });
      } else if (line.trim() === '') {
        continue;
      } else {
        result.content.push({
          type: 'paragraph',
          text: line
        });
      }
    }

    if (currentBlock) {
      result.content.push(currentBlock);
    }

    return result;
  }

  jsonToMarkdown(json) {
    if (typeof json === 'string') {
      return json;
    }

    if (Array.isArray(json)) {
      return json.map(item => this.jsonToMarkdown(item)).join('\n\n');
    }

    if (json.type && json.text) {
      switch (json.type) {
        case 'heading':
          return '#'.repeat(json.level) + ' ' + json.text;
        case 'code':
          return '```' + (json.language || '') + '\n' + json.code + '```';
        case 'paragraph':
          return json.text;
        case 'list_item':
          return '- ' + json.text;
        case 'blockquote':
          return '> ' + json.text;
        default:
          return json.text || '';
      }
    }

    if (typeof json === 'object' && json !== null) {
      const parts = [];
      if (json.content && Array.isArray(json.content)) {
        parts.push(...json.content.map(item => this.jsonToMarkdown(item)));
      }
      return parts.join('\n\n');
    }

    return String(json);
  }

  markdownToHtml(markdown) {
    let html = markdown;

    html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    return html;
  }

  htmlToMarkdown(html) {
    let md = html;

    md = md.replace(/<h[1-6]>([^<]+)<\/h[1-6]>/gi, (match, text, offset) => {
      const level = match.match(/<h([1-6])>/i)[1];
      return '#'.repeat(level) + ' ' + text + '\n\n';
    });

    md = md.replace(/<pre><code class="language-(\w*)">([\s\S]*?)<\/code><\/pre>/gi, '```$1\n$2```\n\n');
    md = md.replace(/<code>([^<]+)<\/code>/g, '`$1`');

    md = md.replace(/<strong>([^<]+)<\/strong>/g, '**$1**');
    md = md.replace(/<em>([^<]+)<\/em>/g, '*$1*');

    md = md.replace(/<a href="([^"]+)">([^<]+)<\/a>/g, '[$2]($1)');

    md = md.replace(/<blockquote>([^<]+)<\/blockquote>/gi, '> $1\n\n');

    md = md.replace(/<li>([^<]+)<\/li>/gi, '- $1\n');
    md = md.replace(/<\/?ul>/gi, '');

    md = md.replace(/<p>([^<]*)<\/p>/gi, '$1\n\n');

    md = md.replace(/<[^>]+>/g, '');
    md = md.replace(/&lt;/g, '<');
    md = md.replace(/&gt;/g, '>');
    md = md.replace(/&amp;/g, '&');

    md = md.replace(/\n{3,}/g, '\n\n');

    return md.trim();
  }

  jsonToHtml(json) {
    const markdown = this.jsonToMarkdown(json);
    return this.markdownToHtml(markdown);
  }

  htmlToJson(html) {
    const markdown = this.htmlToMarkdown(html);
    return this.markdownToJson(markdown);
  }

  jsonSchemaToMarkdown(schema) {
    let md = '# JSON Schema\n\n';

    if (schema.description) {
      md += `${schema.description}\n\n`;
    }

    md += '## Properties\n\n';

    const props = schema.properties || {};
    const required = schema.required || [];

    for (const [name, prop] of Object.entries(props)) {
      const req = required.includes(name) ? ' 🔴 **required**' : ' (optional)';
      md += `### \`${name}\`${req}\n\n`;
      md += `- **Type**: \`${prop.type || 'any'}\`\n`;

      if (prop.description) {
        md += `- **Description**: ${prop.description}\n`;
      }

      if (prop.enum) {
        md += `- **Enum**: \`${prop.enum.join('` | `')}\`\n`;
      }

      if (prop.format) {
        md += `- **Format**: \`${prop.format}\`\n`;
      }

      if (prop.minimum !== undefined) md += `- **Minimum**: \`${prop.minimum}\`\n`;
      if (prop.maximum !== undefined) md += `- **Maximum**: \`${prop.maximum}\`\n`;
      if (prop.minLength !== undefined) md += `- **Min Length**: \`${prop.minLength}\`\n`;
      if (prop.maxLength !== undefined) md += `- **Max Length**: \`${prop.maxLength}\`\n`;
      if (prop.pattern) md += `- **Pattern**: \`${prop.pattern}\`\n`;

      md += '\n';
    }

    if (schema.required && schema.required.length > 0) {
      md += '## Required Fields\n\n';
      md += schema.required.map(f => `- \`${f}\``).join('\n');
      md += '\n\n';
    }

    return md;
  }

  jsonSchemaToHtml(schema) {
    const markdown = this.jsonSchemaToMarkdown(schema);
    return this.markdownToHtml(markdown);
  }

  tableToJson(tableMarkdown) {
    const lines = tableMarkdown.trim().split('\n');
    if (lines.length < 2) return [];

    const headerLine = lines[0];
    const separatorLine = lines[1];
    
    if (!separatorLine.includes('---') && !separatorLine.includes('---:')) {
      return [];
    }

    const headers = headerLine.split('|').filter(c => c.trim()).map(h => h.trim());
    const data = [];

    for (let i = 2; i < lines.length; i++) {
      const values = lines[i].split('|').filter(c => c.trim()).map(v => v.trim());
      if (values.length === headers.length) {
        const row = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx];
        });
        data.push(row);
      }
    }

    return data;
  }

  jsonToTable(json, columns = null) {
    if (!Array.isArray(json) || json.length === 0) {
      return '';
    }

    const keys = columns || Object.keys(json[0]);
    
    const headerRow = '| ' + keys.join(' | ') + ' |';
    const separatorRow = '| ' + keys.map(() => '---').join(' | ') + ' |';
    
    const dataRows = json.map(item => {
      return '| ' + keys.map(k => item[k] ?? '').join(' | ') + ' |';
    });

    return [headerRow, separatorRow, ...dataRows].join('\n');
  }
}

export class MultimodalHandler {
  constructor(options = {}) {
    this._imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.tiff'];
    this._imageHosts = ['unsplash.com', 'imgur.com', 'cloudinary.com', 'res.cloudinary.com', 'picsum.photos', 'placekitten.com', 'api.dicebear.com', 'randomuser.me', 'pexels.com', 'pixabay.com'];
    this._audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.wma'];
    this._videoExtensions = ['.mp4', '.webm', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.m4v'];
    this._maxImageSize = options.maxImageSize || 10 * 1024 * 1024;
    this._enableDownload = options.enableDownload !== false;
    this._cache = new Map();
    this._cacheSize = options.cacheSize || 50;
  }

  detectContentTypes(content) {
    const results = {
      hasImages: false,
      hasAudio: false,
      hasVideo: false,
      images: [],
      audio: [],
      video: [],
      totalMediaItems: 0
    };

    const imageUrls = this.extractMediaUrls(content, 'image');
    const audioUrls = this.extractMediaUrls(content, 'audio');
    const videoUrls = this.extractMediaUrls(content, 'video');

    results.images = imageUrls;
    results.audio = audioUrls;
    results.video = videoUrls;
    results.hasImages = imageUrls.length > 0;
    results.hasAudio = audioUrls.length > 0;
    results.hasVideo = videoUrls.length > 0;
    results.totalMediaItems = imageUrls.length + audioUrls.length + videoUrls.length;

    return results;
  }

  extractMediaUrls(content, type = 'image') {
    const urls = [];
    const seen = new Set();

    if (type === 'image') {
      const patterns = [
        /!\[([^\]]*)\]\(([^)]+)\)/g,
        /<img[^>]+src=["']([^"']+)["'][^>]*>/gi,
        /data:image\/[^;]+;base64,[^\s"'<>]+/gi,
        /(?:https?:\/\/)?(?:[\w-]+\.)+(?:jpg|jpeg|png|gif|webp|svg|bmp|ico|avif|tiff)(?:\?\S*)?/gi,
        /(?:https?:\/\/)?(?:[\w-]+\.)+(?:unsplash|imgur|cloudinary|picsum|pexels|pixabay|dicebear|randomuser)(?:\.com|\.io)?[\/\?=\w\-.~%&:@#]+/gi
      ];

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const url = match[2] || match[0];
          if (!seen.has(url) && this._isValidImageUrl(url)) {
            seen.add(url);
            urls.push(this._parseImageUrl(url, match[1] || ''));
          }
        }
      }
    } else if (type === 'audio') {
      const patterns = [
        /<audio[^>]+src=["']([^"']+)["'][^>]*>/gi,
        /(?:https?:\/\/)?[\w-]+\.[\w]+(?:\.mp3|\.wav|\.ogg|\.m4a|\.flac|\.aac)(?:\?\S*)?/gi,
        /(?:https?:\/\/)?(?:soundcloud\.com|spotify\.com|music\.youtube\.com)[\/\w\-.~%&?=#]+/gi
      ];

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const url = match[1] || match[0];
          if (!seen.has(url)) {
            seen.add(url);
            urls.push({ url, type: this._detectAudioType(url), alt: '' });
          }
        }
      }
    } else if (type === 'video') {
      const patterns = [
        /<video[^>]+src=["']([^"']+)["'][^>]*>/gi,
        /<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi,
        /(?:https?:\/\/)?(?:youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com)[\/\w\-.~%&\?=#]+/gi,
        /(?:https?:\/\/)?[\w-]+\.[\w]+(?:\.mp4|\.webm|\.avi|\.mov)(?:\?\S*)?/gi
      ];

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const url = match[1] || match[0];
          if (!seen.has(url)) {
            seen.add(url);
            urls.push({ url, type: this._detectVideoType(url), alt: '' });
          }
        }
      }
    }

    return urls;
  }

  _isValidImageUrl(url) {
    if (url.startsWith('data:image')) return true;
    if (!url.startsWith('http')) return false;
    
    const lower = url.toLowerCase();
    for (const ext of this._imageExtensions) {
      if (lower.includes(ext)) return true;
    }
    for (const host of this._imageHosts) {
      if (lower.includes(host)) return true;
    }
    return false;
  }

  _parseImageUrl(url, alt = '') {
    return {
      url: this._normalizeUrl(url),
      alt: alt,
      type: this._detectImageType(url),
      isBase64: url.startsWith('data:image'),
      isRemote: url.startsWith('http'),
      size: url.length
    };
  }

  _detectImageType(url) {
    if (url.startsWith('data:image/')) {
      const mimeType = url.match(/data:image\/(\w+)/)?.[1] || 'unknown';
      return mimeType;
    }
    
    const ext = url.match(/\.(jpe?g|png|gif|webp|svg|bmp|ico|avif|tiff)(\?|$|\/)/i)?.[1]?.toLowerCase();
    const mimeTypes = {
      'jpg': 'jpeg', 'jpeg': 'jpeg', 'png': 'png', 'gif': 'gif',
      'webp': 'webp', 'svg': 'svg+xml', 'bmp': 'bmp', 'ico': 'x-icon',
      'avif': 'avif', 'tiff': 'tiff'
    };
    return mimeTypes[ext] || 'jpeg';
  }

  _detectAudioType(url) {
    const ext = url.match(/\.(mp3|wav|ogg|m4a|flac|aac)(\?|$|\/)/i)?.[1]?.toLowerCase();
    return ext || 'mp3';
  }

  _detectVideoType(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('vimeo.com')) return 'vimeo';
    if (url.includes('dailymotion.com')) return 'dailymotion';
    
    const ext = url.match(/\.(mp4|webm|avi|mov)(\?|$|\/)/i)?.[1]?.toLowerCase();
    return ext || 'mp4';
  }

  _normalizeUrl(url) {
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    if (url.startsWith('data:')) {
      return url.substring(0, 100) + '...[truncated]';
    }
    return url;
  }

  async fetchImageMetadata(url) {
    if (this._cache.has(url)) {
      return this._cache.get(url);
    }

    try {
      const response = await fetch(url, { method: 'HEAD' });
      const headers = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      const metadata = {
        url,
        contentType: headers['content-type'] || 'unknown',
        contentLength: parseInt(headers['content-length'], 10) || 0,
        lastModified: headers['last-modified'] || null,
        cacheControl: headers['cache-control'] || null,
        status: response.status,
        valid: response.ok
      };

      if (this._cache.size >= this._cacheSize) {
        const firstKey = this._cache.keys().next().value;
        this._cache.delete(firstKey);
      }
      this._cache.set(url, metadata);

      return metadata;
    } catch (error) {
      return {
        url,
        contentType: 'error',
        contentLength: 0,
        lastModified: null,
        cacheControl: null,
        status: 0,
        valid: false,
        error: error.message
      };
    }
  }

  renderImageMarkdown(url, alt = '', options = {}) {
    const width = options.width ? ` width="${options.width}"` : '';
    const height = options.height ? ` height="${options.height}"` : '';
    const loading = options.loading || 'lazy';
    
    return `![${alt}](${url})`;
  }

  renderVideoEmbed(url, options = {}) {
    const width = options.width || 560;
    const height = options.height || 315;

    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoId = this._extractYoutubeId(url);
      if (videoId) {
        return `<iframe width="${width}" height="${height}" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`;
      }
    }
    
    if (url.includes('vimeo.com')) {
      const videoId = url.match(/vimeo\.com\/(\d+)/)?.[1];
      if (videoId) {
        return `<iframe width="${width}" height="${height}" src="https://player.vimeo.com/video/${videoId}" frameborder="0" allowfullscreen></iframe>`;
      }
    }

    return `<video src="${url}" width="${width}" height="${height}" controls></video>`;
  }

  _extractYoutubeId(url) {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  processContent(content) {
    const detection = this.detectContentTypes(content);
    
    if (detection.totalMediaItems === 0) {
      return {
        processed: content,
        hasMultimedia: false,
        images: [],
        audio: [],
        video: [],
        summary: null
      };
    }

    let processed = content;

    if (detection.hasImages) {
      processed = this._processImageReferences(processed, detection.images);
    }

    if (detection.hasVideo) {
      processed = this._processVideoReferences(processed, detection.video);
    }

    return {
      processed,
      hasMultimedia: true,
      images: detection.images,
      audio: detection.audio,
      video: detection.video,
      summary: {
        totalImages: detection.images.length,
        totalAudio: detection.audio.length,
        totalVideo: detection.video.length,
        base64Images: detection.images.filter(i => i.isBase64).length,
        remoteImages: detection.images.filter(i => i.isRemote).length
      }
    };
  }

  _processImageReferences(content, images) {
    let processed = content;
    
    for (const img of images) {
      if (img.isBase64) {
        processed = processed.replace(img.url, '[Base64 Image]');
      }
    }
    
    return processed;
  }

  _processVideoReferences(content, videos) {
    let processed = content;
    
    for (const video of videos) {
      const embed = this.renderVideoEmbed(video.url);
      const pattern = new RegExp(this._escapeRegex(video.url), 'gi');
      processed = processed.replace(pattern, embed);
    }
    
    return processed;
  }

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  clearCache() {
    this._cache.clear();
  }

  getCacheSize() {
    return this._cache.size;
  }

  async extractTextFromImage(imageUrl, options = {}) {
    if (this._cache.has(`ocr:${imageUrl}`)) {
      return this._cache.get(`ocr:${imageUrl}`);
    }

    const apiEndpoint = options.apiEndpoint || 'https://api.example.com/ocr';
    const apiKey = options.apiKey;

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
        },
        body: JSON.stringify({
          image_url: imageUrl,
          language: options.language || 'auto',
          detect_orientation: options.detectOrientation !== false,
          paragraph: options.paragraph !== false
        })
      });

      const result = await response.json();
      
      const ocrResult = {
        success: true,
        text: result.text || result.transcription || '',
        confidence: result.confidence || 0.9,
        language: result.language || 'unknown',
        boundingBoxes: result.bounding_boxes || [],
        paragraphs: result.paragraphs || [],
        words: result.words || []
      };

      if (this._cache.size >= this._cacheSize) {
        const firstKey = this._cache.keys().next().value;
        this._cache.delete(firstKey);
      }
      this._cache.set(`ocr:${imageUrl}`, ocrResult);

      return ocrResult;
    } catch (error) {
      return {
        success: false,
        text: '',
        error: error.message,
        fallbackUsed: false
      };
    }
  }

  async extractKeyframesFromVideo(videoUrl, options = {}) {
    const maxFrames = options.maxFrames || 10;
    const interval = options.interval || 5;

    const cacheKey = `video:${videoUrl}:keyframes`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const apiEndpoint = options.apiEndpoint || 'https://api.example.com/video/keyframes';
    const apiKey = options.apiKey;

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
        },
        body: JSON.stringify({
          video_url: videoUrl,
          max_frames: maxFrames,
          interval_seconds: interval,
          extract_scene_changes: options.extractSceneChanges !== false,
          min_confidence: options.minConfidence || 0.5
        })
      });

      const result = await response.json();

      const keyframesResult = {
        success: true,
        frames: result.frames || [],
        sceneChanges: result.scene_changes || [],
        duration: result.duration || 0,
        timestamps: result.timestamps || []
      };

      this._cache.set(cacheKey, keyframesResult);
      return keyframesResult;
    } catch (error) {
      return {
        success: false,
        frames: [],
        error: error.message
      };
    }
  }

  async transcribeAudio(audioUrl, options = {}) {
    const language = options.language || 'auto';
    const cacheKey = `audio:${audioUrl}:${language}`;

    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const apiEndpoint = options.apiEndpoint || 'https://api.example.com/audio/transcribe';
    const apiKey = options.apiKey;

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
        },
        body: JSON.stringify({
          audio_url: audioUrl,
          language,
          task: options.task || 'transcribe',
          timestamp: options.includeTimestamps !== false,
          speaker_labels: options.speakerLabels || false
        })
      });

      const result = await response.json();

      const transcriptionResult = {
        success: true,
        text: result.text || '',
        segments: result.segments || [],
        language: result.language || language,
        duration: result.duration || 0,
        words: result.words || [],
        speakers: result.speakers || []
      };

      this._cache.set(cacheKey, transcriptionResult);
      return transcriptionResult;
    } catch (error) {
      return {
        success: false,
        text: '',
        error: error.message
      };
    }
  }

  async analyzeImage(imageUrl, options = {}) {
    const cacheKey = `vision:${imageUrl}`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const apiEndpoint = options.apiEndpoint || 'https://api.example.com/vision/analyze';
    const apiKey = options.apiKey;

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
        },
        body: JSON.stringify({
          image_url: imageUrl,
          features: options.features || ['objects', 'text', 'scene', 'faces'],
          max_labels: options.maxLabels || 20,
          includeOCR: options.includeOCR !== false
        })
      });

      const result = await response.json();

      const analysisResult = {
        success: true,
        labels: result.labels || [],
        objects: result.objects || [],
        faces: result.faces || [],
        scene: result.scene || {},
        text: result.text || '',
        confidence: result.confidence || 0.9,
        dominantColors: result.dominant_colors || []
      };

      this._cache.set(cacheKey, analysisResult);
      return analysisResult;
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async processMediaWithLLM(mediaContent, prompt, options = {}) {
    const mediaType = this.detectContentTypes(mediaContent);
    
    let context = '';
    
    if (mediaType.hasImages) {
      for (const img of mediaType.images) {
        const ocrResult = await this.extractTextFromImage(img.url);
        if (ocrResult.success) {
          context += `Image (${img.url}): "${ocrResult.text}"\n`;
        }
      }
    }

    if (mediaType.hasAudio) {
      for (const audio of mediaType.audio) {
        const transcription = await this.transcribeAudio(audio.url);
        if (transcription.success) {
          context += `Audio (${audio.url}): "${transcription.text}"\n`;
        }
      }
    }

    if (mediaType.hasVideo) {
      for (const video of mediaType.video) {
        const keyframes = await this.extractKeyframesFromVideo(video.url);
        if (keyframes.success) {
          context += `Video (${video.url}): ${keyframes.frames.length} keyframes extracted\n`;
        }
      }
    }

    return {
      mediaAnalysis: mediaType,
      extractedContext: context,
      suggestedPrompt: `${prompt}\n\nContext from media:\n${context}`
    };
  }

  extractMediaMetadata(url) {
    const extension = url.split('.').pop().toLowerCase().split('?')[0];
    const isImage = this._imageExtensions.includes(`.${extension}`);
    const isAudio = this._audioExtensions.includes(`.${extension}`);
    const isVideo = this._videoExtensions.includes(`.${extension}`);

    return {
      url,
      extension,
      type: isImage ? 'image' : isAudio ? 'audio' : isVideo ? 'video' : 'unknown',
      estimatedSize: this._estimateMediaSize(extension),
      supported: isImage || isAudio || isVideo
    };
  }

  _estimateMediaSize(extension) {
    const estimates = {
      '.jpg': '2-5 MB',
      '.png': '2-10 MB',
      '.gif': '1-5 MB',
      '.mp4': '50-500 MB',
      '.mp3': '3-10 MB',
      '.wav': '10-50 MB'
    };
    return estimates[`.${extension}`] || 'unknown';
  }
}

export class QualityScorer {
  constructor(options = {}) {
    this._weights = {
      relevance: options.relevanceWeight || 0.20,
      completeness: options.completenessWeight || 0.15,
      consistency: options.consistencyWeight || 0.10,
      hallucination: options.hallucinationWeight || 0.08,
      toxicity: options.toxicityWeight || 0.08,
      faithfulness: options.faithfulnessWeight || 0.08,
      factuality: options.factualityWeight || 0.07,
      coherence: options.coherenceWeight || 0.07,
      conciseness: options.concisenessWeight || 0.05,
      readability: options.readabilityWeight || 0.05,
      sentiment: options.sentimentWeight || 0.04,
      styleConsistency: options.styleConsistencyWeight || 0.03
    };

    this._certaintyPatterns = [
      /definitely|absolutely|certainly|obviously|clearly/i,
      /always|never|every|none|all/i,
      /must be|has to be|guaranteed|100%/i,
      /proven|scientific|fact|truth/i
    ];

    this._vaguePatterns = [
      /maybe|perhaps|might|could be|possibly/i,
      /somewhat|kind of|sort of|a bit/i,
      /seems|appears|looks like/i,
      /I think|I believe|I feel/i
    ];

    this._hedgePatterns = [
      /typically|usually|often|sometimes/i,
      /generally|normally|ordinarily/i,
      /in most cases|most likely|probably/i
    ];

    this._toxicPatterns = [
      /stupid|dumb|idiot|loser/i,
      /hate|terrible|awful|worst/i,
      /moron|fool|ignorant/i,
      /you are|you're incompetent/i
    ];

    this._factClaimPatterns = [
      /\b(percent|percentage|%|rate|ratio)\b/gi,
      /\b(million|billion|trillion|thousand)\b/gi,
      /\b(always|never|every|none)\b/gi,
      /\b(first|second|third|latest|newest)\b/gi,
      /\b(best|worst|top|bottom)\b/gi
    ];

    this._positivePatterns = [
      /excellent|amazing|wonderful|fantastic|great|good|helpful/i,
      /love|like|appreciate|prefer/i,
      /correct|right|perfect|ideal/i,
      /easy|simple|clear|obvious/i,
      /success|successful|achieve|improve/i
    ];

    this._negativePatterns = [
      /terrible|awful|horrible|bad|poor|wrong/i,
      /hate|dislike|disapprove|reject/i,
      /fail|failure|wrong|mistake|error/i,
      /difficult|hard|complex|confusing|unclear/i,
      /problem|issue|bug|broken/i
    ];

    this._technicalPatterns = [
      /\b\d+\s*\(\s*\d+\s*\)/,
      /\bfunction\s*\(/,
      /\bclass\s+\w+/,
      /\bconst\s+\w+\s*=/,
      /\bvar\s+\w+\s*=/,
      /\blet\s+\w+\s*=/,
      /=>\s*{/,
      /\bif\s*\(/,
      /\bfor\s*\(/,
      /\bwhile\s*\(/,
      /\breturn\s+/,
      /\bimport\s+/,
      /\bexport\s+/,
      /\basync\s+/,
      /\bawait\s+/,
      /\btry\s*{/,
      /\bcatch\s*\(/,
      /```\w*/,
      /\{[\s\S]*?:[\s\S]*?\}/
    ];

    this._formalPatterns = [
      /\btherefore|thus|hence|consequently/i,
      /\bfurthermore|moreover|additionally|similarly/i,
      /\bhowever|nevertheless|although|whereas/i,
      /\bsubsequently|accordingly|meanwhile/i,
      /\bprimarily|essentially|fundamentally/i,
      /\bnotwithstanding|henceforth|thereby/i
    ];

    this._internalConsistencyCache = new Map();
    this._maxCacheSize = options.cacheSize || 100;
    this._scoreHistory = [];
    this._maxHistorySize = options.maxHistorySize || 1000;
    this._userStyleProfile = null;
    this._sentimentWords = new Map();
  }

  calculateOverallScore(metrics) {
    const weightedSum = 
      metrics.relevance * this._weights.relevance +
      metrics.completeness * this._weights.completeness +
      metrics.consistency * this._weights.consistency +
      metrics.hallucinationResistance * this._weights.hallucination +
      metrics.toxicity * this._weights.toxicity +
      metrics.faithfulness * (this._weights.faithfulness || 0.08) +
      metrics.factuality * (this._weights.factuality || 0.07) +
      metrics.coherence * (this._weights.coherence || 0.07) +
      metrics.conciseness * (this._weights.conciseness || 0.05) +
      metrics.readability * (this._weights.readability || 0.05) +
      metrics.sentiment * (this._weights.sentiment || 0.04) +
      metrics.styleConsistency * (this._weights.styleConsistency || 0.03);
    
    return Math.round(weightedSum * 100) / 100;
  }

  score(content, context = {}) {
    const relevance = this.scoreRelevance(content, context.query || context.prompt || '');
    const completeness = this.scoreCompleteness(content, context.requiredFields || []);
    const consistency = this.scoreConsistency(content);
    const hallucinationResistance = this.scoreHallucinationResistance(content);
    const toxicity = this.scoreToxicity(content);
    const faithfulness = this.scoreFaithfulness(content, context.source || context.context || '');
    const factuality = this.scoreFactuality(content);
    const coherence = this.scoreCoherence(content);
    const conciseness = this.scoreConciseness(content);
    const readability = this.scoreReadability(content);
    const sentiment = this.scoreSentiment(content);
    const styleConsistency = this.scoreStyleConsistency(content, context.userStyle || null);

    const overall = this.calculateOverallScore({
      relevance,
      completeness,
      consistency,
      hallucinationResistance,
      toxicity,
      faithfulness,
      factuality,
      coherence,
      conciseness,
      readability,
      sentiment,
      styleConsistency
    });

    const result = {
      overall,
      relevance,
      completeness,
      consistency,
      hallucinationResistance,
      toxicity,
      faithfulness,
      factuality,
      coherence,
      conciseness,
      readability,
      sentiment,
      styleConsistency
    };

    this._addToHistory(result, context);

    return result;
  }

  _addToHistory(score, context = {}) {
    this._scoreHistory.push({
      timestamp: Date.now(),
      overall: score.overall,
      dimensions: { ...score },
      context: context.query || context.prompt || null
    });

    if (this._scoreHistory.length > this._maxHistorySize) {
      this._scoreHistory.shift();
    }
  }

  scoreRelevance(content, query) {
    if (!query || !content) return 0.5;
    
    const queryWords = this._normalizeText(query).split(/\s+/).filter(w => w.length > 2);
    const contentWords = this._normalizeText(content);
    
    if (queryWords.length === 0) return 0.5;
    
    let matches = 0;
    for (const word of queryWords) {
      if (contentWords.includes(word)) matches++;
    }
    
    const matchRatio = matches / queryWords.length;
    
    const queryEntities = this._extractEntities(query);
    const contentEntities = this._extractEntities(content);
    let entityMatches = 0;
    for (const entity of queryEntities) {
      if (contentEntities.includes(entity)) entityMatches++;
    }
    const entityRatio = queryEntities.length > 0 ? entityMatches / queryEntities.length : 0;
    
    return Math.round((matchRatio * 0.6 + entityRatio * 0.4) * 100) / 100;
  }

  scoreCompleteness(content, requiredFields = []) {
    if (requiredFields.length === 0) {
      const stats = this._getBasicStats(content);
      if (stats.wordCount < 10) return 0.3;
      if (stats.wordCount < 30) return 0.6;
      if (stats.wordCount < 100) return 0.8;
      return 0.9;
    }

    let matched = 0;
    for (const field of requiredFields) {
      if (content.toLowerCase().includes(field.toLowerCase())) {
        matched++;
      }
    }

    return Math.round((matched / requiredFields.length) * 100) / 100;
  }

  scoreConsistency(content) {
    const contradictions = this._detectContradictions(content);
    
    if (contradictions.length === 0) return 1.0;
    
    const contradictionPenalty = Math.min(contradictions.length * 0.2, 0.8);
    return Math.max(0.1, 1 - contradictionPenalty);
  }

  scoreHallucinationResistance(content) {
    const certaintyStatements = this._findMatches(content, this._certaintyPatterns);
    const uncertainStatements = this._findMatches(content, this._vaguePatterns);
    const hedgeStatements = this._findMatches(content, this._hedgePatterns);

    const totalQualifierCount = certaintyStatements.length + uncertainStatements.length + hedgeStatements.length;
    
    if (totalQualifierCount === 0) return 0.7;
    
    const certaintyRatio = certaintyStatements.length / totalQualifierCount;
    const uncertainRatio = uncertainStatements.length / totalQualifierCount;
    const hedgeRatio = hedgeStatements.length / totalQualifierCount;

    let score = 0.5;
    score += hedgeRatio * 0.3;
    score += uncertainRatio * 0.2;
    score -= certaintyRatio * 0.4;

    const facts = this._extractFacts(content);
    const claimsWithSupport = this._evaluateClaimSupport(content, facts);
    
    if (facts.length > 0) {
      const supportRatio = claimsWithSupport / facts.length;
      score = score * 0.6 + supportRatio * 0.4;
    }

    return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
  }

  scoreToxicity(content) {
    const toxicStatements = this._findMatches(content, this._toxicPatterns);
    
    if (toxicStatements.length === 0) return 1.0;
    
    const severity = toxicStatements.length === 1 ? 0.5 : toxicStatements.length === 2 ? 0.3 : 0.1;
    return severity;
  }

  _detectContradictions(content) {
    const contradictions = [];
    const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
    
    const positiveNegative = [
      [/\b(can|cannot|could)\b/i, /\b(cannot|cannot|cannot)\b/i],
      [/\b(always)\b/i, /\b(never)\b/i],
      [/\b(all)\b/i, /\b(none|no)\b/i],
      [/\b(always)\b/i, /\b(sometimes|rarely)\b/i],
      [/\b(must)\b/i, /\b(might not|may not)\b/i],
      [/\b(everyone)\b/i, /\b(nobody|no one)\b/i]
    ];

    for (let i = 0; i < sentences.length; i++) {
      for (let j = i + 1; j < sentences.length; j++) {
        const s1 = sentences[i];
        const s2 = sentences[j];

        for (const [posPattern, negPattern] of positiveNegative) {
          const s1HasPos = posPattern.test(s1);
          const s2HasNeg = negPattern.test(s2);
          const s2HasPos = posPattern.test(s2);
          const s1HasNeg = negPattern.test(s1);

          if ((s1HasPos && s2HasNeg) || (s2HasPos && s1HasNeg)) {
            if (this._sentencesRelated(s1, s2)) {
              contradictions.push({
                sentence1: s1.substring(0, 50),
                sentence2: s2.substring(0, 50),
                type: 'contradiction'
              });
            }
          }
        }
      }
    }

    return contradictions;
  }

  _sentencesRelated(s1, s2) {
    const words1 = new Set(s1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(s2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    
    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) intersection++;
    }

    const union = words1.size + words2.size - intersection;
    const similarity = union > 0 ? intersection / union : 0;

    return similarity > 0.2;
  }

  _extractFacts(content) {
    const facts = [];
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    const factPatterns = [
      /\b(is|are|was|were)\s+[\w\s]+,\s+[\w\s]+/gi,
      /\b(\w+)\s+(is|are|was|were)\s+\w+/gi,
      /\bhas\s+\w+\s+(\w+)/gi,
      /\b(\w+)\s+contains?\s+\w+/gi
    ];

    for (const sentence of sentences) {
      for (const pattern of factPatterns) {
        const matches = sentence.match(pattern);
        if (matches) {
          facts.push(...matches);
        }
      }
    }

    return [...new Set(facts)];
  }

  _evaluateClaimSupport(content, facts) {
    if (facts.length === 0) return 0;
    
    let supported = 0;
    for (const fact of facts) {
      const surroundingContext = this._getContextAround(content, fact);
      if (this._hasSupportingEvidence(fact, surroundingContext)) {
        supported++;
      }
    }

    return supported;
  }

  _getContextAround(content, phrase, contextLength = 50) {
    const index = content.indexOf(phrase);
    if (index === -1) return '';
    
    const start = Math.max(0, index - contextLength);
    const end = Math.min(content.length, index + phrase.length + contextLength);
    return content.substring(start, end);
  }

  _hasSupportingEvidence(fact, context) {
    const supportIndicators = [
      /because|since|therefore|thus|hence/i,
      /according to|based on|study|research|data/i,
      /shows|demonstrates|indicates|suggests/i
    ];

    for (const pattern of supportIndicators) {
      if (pattern.test(context)) return true;
    }

    return fact.length > 10;
  }

  _countClaims(content) {
    const claimIndicators = [
      /\b(is|are|was|were)\b/i,
      /\b(has|have|had)\b/i,
      /\b(can|cannot|could)\b/i,
      /\b(will|would|should|may|might)\b/i,
      /\b(believes?|thinks?|knows?)\b/i
    ];

    let count = 0;
    for (const pattern of claimIndicators) {
      const matches = content.match(pattern);
      if (matches) count += matches.length;
    }

    return count;
  }

  _getUncertainClaimRatio(content) {
    const totalClaims = this._countClaims(content);
    if (totalClaims === 0) return 0;

    const uncertainClaims = this._findMatches(content, [...this._vaguePatterns, ...this._hedgePatterns]).length;
    return Math.round((uncertainClaims / totalClaims) * 100) / 100;
  }

  _countSelfReferences(content) {
    const selfRefPatterns = [
      /\bI\s+\w+/gi,
      /\bwe\s+\w+/gi,
      /\bmy\s+\w+/gi,
      /\bour\s+\w+/gi,
      /\b(am|was)\s+(going to|going|considering)/gi
    ];

    let count = 0;
    for (const pattern of selfRefPatterns) {
      const matches = content.match(pattern);
      if (matches) count += matches.length;
    }

    return count;
  }

  _countAnsweredQuestions(content, query) {
    if (!query.includes('?')) return -1;

    const questions = query.split('?').filter(q => q.trim().length > 0);
    let answered = 0;

    for (const question of questions) {
      const keyWords = question.split(/\s+/).filter(w => w.length > 3);
      let matchCount = 0;
      for (const word of keyWords) {
        if (content.toLowerCase().includes(word.toLowerCase())) {
          matchCount++;
        }
      }
      if (matchCount >= keyWords.length * 0.3) {
        answered++;
      }
    }

    return answered;
  }

  _collectFlags(content) {
    const flags = [];

    if (this._countSelfReferences(content) > 3) {
      flags.push({ type: 'excessive_self_reference', severity: 'low' });
    }

    const contradictions = this._detectContradictions(content);
    if (contradictions.length > 0) {
      flags.push({ type: 'contradictions', severity: 'medium', count: contradictions.length });
    }

    const toxicStatements = this._findMatches(content, this._toxicPatterns);
    if (toxicStatements.length > 0) {
      flags.push({ type: 'toxicity', severity: 'high', count: toxicStatements.length });
    }

    const certaintyCount = this._findMatches(content, this._certaintyPatterns).length;
    if (certaintyCount > 5) {
      flags.push({ type: 'overly_certain', severity: 'medium' });
    }

    const stats = this._getBasicStats(content);
    if (stats.wordCount < 10 && stats.sentenceCount < 2) {
      flags.push({ type: 'too_short', severity: 'low' });
    }

    return flags;
  }

  _findMatches(content, patterns) {
    const matches = [];
    for (const pattern of patterns) {
      const found = content.match(pattern);
      if (found) {
        matches.push(...found);
      }
    }
    return matches;
  }

  _normalizeText(text) {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _extractEntities(text) {
    const entityPatterns = [
      /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g,
      /\b\d+(?:\.\d+)*(?:\s*\w+)*/g
    ];

    const entities = new Set();
    for (const pattern of entityPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(e => entities.add(e));
      }
    }

    return Array.from(entities);
  }

  scoreFaithfulness(content, source = '') {
    if (!source) {
      return 0.7;
    }

    const contentWords = this._normalizeText(content).split(/\s+/);
    const sourceWords = this._normalizeText(source).split(/\s+/);

    let matchCount = 0;
    for (const word of contentWords) {
      if (sourceWords.includes(word) && word.length > 3) {
        matchCount++;
      }
    }

    const overlapRatio = contentWords.length > 0 ? matchCount / contentWords.length : 0;
    
    const sourceEntities = this._extractEntities(source);
    const contentEntities = this._extractEntities(content);
    
    let entityMatchCount = 0;
    for (const entity of contentEntities) {
      if (sourceEntities.includes(entity)) {
        entityMatchCount++;
      }
    }
    const entityRatio = contentEntities.length > 0 ? entityMatchCount / contentEntities.length : 0;

    const score = overlapRatio * 0.6 + entityRatio * 0.4;
    return Math.round(Math.min(1, score * 1.5) * 100) / 100;
  }

  scoreFactuality(content) {
    const factClaims = this._findMatches(content, this._factClaimPatterns);
    
    if (factClaims.length === 0) {
      return 0.8;
    }

    const quantifiedStatements = factClaims.length;
    const uncertaintyIndicators = this._findMatches(content, this._vaguePatterns).length +
                                  this._findMatches(content, this._hedgePatterns).length;
    
    if (uncertaintyIndicators === 0) {
      return Math.max(0.3, 1 - quantifiedStatements * 0.1);
    }

    const balanceRatio = uncertaintyIndicators / quantifiedStatements;
    
    if (balanceRatio >= 0.5) {
      return 0.9;
    } else if (balanceRatio >= 0.3) {
      return 0.75;
    } else if (balanceRatio >= 0.1) {
      return 0.6;
    }
    
    return Math.max(0.3, 0.6 - (0.1 * (1 - balanceRatio)));
  }

  scoreCoherence(content) {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    if (sentences.length <= 1) {
      return 0.9;
    }

    let transitionCount = 0;
    const transitionWords = [
      'however', 'therefore', 'furthermore', 'moreover', 'additionally',
      'consequently', 'nevertheless', 'meanwhile', 'although', 'because',
      'since', 'while', 'whereas', 'thus', 'hence'
    ];

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      for (const tw of transitionWords) {
        if (lower.includes(tw)) {
          transitionCount++;
          break;
        }
      }
    }

    const transitionScore = transitionCount / sentences.length;

    let topicConsistency = 0;
    if (sentences.length >= 2) {
      const firstSentenceWords = new Set(sentences[0].toLowerCase().split(/\s+/).filter(w => w.length > 4));
      
      for (let i = 1; i < sentences.length; i++) {
        const currentWords = new Set(sentences[i].toLowerCase().split(/\s+/).filter(w => w.length > 4));
        let intersection = 0;
        for (const word of firstSentenceWords) {
          if (currentWords.has(word)) intersection++;
        }
        topicConsistency += intersection / firstSentenceWords.size;
      }
      topicConsistency /= (sentences.length - 1);
    }

    const score = transitionScore * 0.4 + topicConsistency * 0.6;
    return Math.round(Math.min(1, score * 1.3) * 100) / 100;
  }

  scoreConciseness(content) {
    const stats = this._getBasicStats(content);
    
    const idealWordsPerSentence = 15;
    const actualWordsPerSentence = stats.wordCount / Math.max(1, stats.sentenceCount);
    const efficiencyRatio = actualWordsPerSentence / idealWordsPerSentence;

    let conciseness = 0.5;
    if (efficiencyRatio >= 0.8 && efficiencyRatio <= 1.5) {
      conciseness = 1.0;
    } else if (efficiencyRatio >= 0.5 && efficiencyRatio <= 2.0) {
      conciseness = 0.8;
    } else if (efficiencyRatio >= 0.3 && efficiencyRatio <= 3.0) {
      conciseness = 0.6;
    } else if (efficiencyRatio < 0.3) {
      conciseness = 0.4;
    } else {
      conciseness = 0.4;
    }

    const fillerPatterns = [
      /basically|essentially|literally|actually|really|very|quite|pretty\s+/gi,
      /\bthat is to say\b|\bin other words\b|\bto put it simply\b/gi
    ];
    
    let fillerCount = 0;
    for (const pattern of fillerPatterns) {
      const matches = content.match(pattern);
      if (matches) fillerCount += matches.length;
    }

    const fillerPenalty = Math.min(0.3, fillerCount * 0.05);
    conciseness = Math.max(0.1, conciseness - fillerPenalty);

    return Math.round(conciseness * 100) / 100;
  }

  scoreReadability(content) {
    const stats = this._getBasicStats(content);
    const words = content.split(/\s+/);
    const sentences = stats.sentenceCount;
    const syllables = words.reduce((sum, w) => sum + this._countSyllables(w), 0);
    const complexWords = words.filter(w => this._countSyllables(w) >= 3).length;
    
    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / Math.max(1, words.length);
    const avgSentenceLength = stats.wordCount / Math.max(1, sentences);
    const avgSyllablesPerWord = syllables / Math.max(1, words.length);
    const percentComplexWords = (complexWords / Math.max(1, words.length)) * 100;

    const fleschScore = 206.835 - (1.015 * avgSentenceLength) - (84.6 * avgSyllablesPerWord);
    const fleschKincaid = (0.39 * avgSentenceLength) + (11.8 * avgSyllablesPerWord) - 15.59;
    const smogIndex = 1.0430 * Math.sqrt(complexWords * (30 / Math.max(1, sentences))) + 3.1291;
    const fogIndex = 0.4 * (avgSentenceLength + percentComplexWords);
    const ari = (4.71 * avgWordLength) + (0.5 * avgSentenceLength) - 21.43;
    const colemanLiau = (5.89 * avgWordLength / 100) - (30 * sentences / Math.max(1, words.length)) - 15.8;

    const normalizedFlesch = Math.max(0, Math.min(100, fleschScore)) / 100;
    const fleschGrade = Math.max(0, Math.min(18, fleschKincaid));
    const smogGrade = Math.max(0, Math.min(18, smogIndex));
    const fogGrade = Math.max(0, Math.min(20, fogIndex));
    const ariGrade = Math.max(0, Math.min(18, ari));
    const colemanGrade = Math.max(0, Math.min(18, colemanLiau));

    const avgGradeLevel = (fleschGrade + smogGrade + fogGrade + ariGrade + colemanGrade) / 5;
    const gradeConsistency = 1 - (Math.max(fleschGrade, smogGrade, fogGrade, ariGrade, colemanGrade) - 
      Math.min(fleschGrade, smogGrade, fogGrade, ariGrade, colemanGrade)) / 10;

    const industryLevels = {
      '大众读物': { min: 0, max: 6 },
      '技术文档': { min: 8, max: 12 },
      '学术论文': { min: 12, max: 18 },
      '法律文书': { min: 15, max: 22 }
    };

    let bestIndustry = '通用';
    let industryMatch = 0;
    for (const [name, range] of Object.entries(industryLevels)) {
      if (avgGradeLevel >= range.min && avgGradeLevel <= range.max) {
        bestIndustry = name;
        industryMatch = 1;
        break;
      } else {
        const dist = Math.min(Math.abs(avgGradeLevel - range.min), Math.abs(avgGradeLevel - range.max));
        const match = Math.max(0, 1 - dist / 5);
        if (match > industryMatch) {
          industryMatch = match;
          bestIndustry = name;
        }
      }
    }

    const technicalDensity = this._countMatches(content, this._technicalPatterns) / Math.max(1, words.length / 50);
    const formalDensity = this._countMatches(content, this._formalPatterns) / Math.max(1, words.length / 100);
    const codeBlockCount = (content.match(/```[\s\S]*?```/g) || []).length;
    const urlCount = (content.match(/https?:\/\/[^\s]+/g) || []).length;

    const technicalScore = Math.min(1, technicalDensity * 2) * 0.7 + Math.min(1, codeBlockCount / 5) * 0.3;
    const formalScore = Math.min(1, formalDensity * 3);

    let readabilityLevel = 'simple';
    if (avgGradeLevel >= 13) readabilityLevel = 'academic';
    else if (avgGradeLevel >= 9) readabilityLevel = 'intermediate';
    else if (avgGradeLevel >= 6) readabilityLevel = 'standard';
    else if (avgGradeLevel >= 3) readabilityLevel = 'basic';

    const overallScore = (
      normalizedFlesch * 0.25 +
      gradeConsistency * 0.25 +
      technicalScore * 0.25 +
      formalScore * 0.15 +
      industryMatch * 0.1
    );

    return {
      score: Math.round(overallScore * 100) / 100,
      formulas: {
        flesch: Math.round(fleschScore * 100) / 100,
        fleschKincaid: Math.round(fleschGrade * 100) / 100,
        smog: Math.round(smogGrade * 100) / 100,
        fog: Math.round(fogGrade * 100) / 100,
        ari: Math.round(ariGrade * 100) / 100,
        colemanLiau: Math.round(colemanGrade * 100) / 100
      },
      averageGradeLevel: Math.round(avgGradeLevel * 100) / 100,
      gradeConsistency: Math.round(gradeConsistency * 100) / 100,
      readabilityLevel,
      recommendedAudience: this._getRecommendedAudience(avgGradeLevel),
      technicalScore: Math.round(technicalScore * 100) / 100,
      formalScore: Math.round(formalScore * 100) / 100,
      bestIndustryMatch: bestIndustry,
      wordStats: {
        totalWords: words.length,
        avgWordLength: Math.round(avgWordLength * 100) / 100,
        complexWords,
        percentComplex: Math.round(percentComplexWords * 100) / 100
      },
      sentenceStats: {
        totalSentences: sentences,
        avgWordsPerSentence: Math.round(avgSentenceLength * 100) / 100
      }
    };
  }

  _getRecommendedAudience(gradeLevel) {
    if (gradeLevel < 6) return 'General public, children';
    if (gradeLevel < 9) return 'Average adult, students';
    if (gradeLevel < 12) return 'Educated professionals';
    if (gradeLevel < 15) return 'Academic audience, specialists';
    return 'Expert audience, graduate level';
  }

  _countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  _countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  _countMatches(content, patterns) {
    let count = 0;
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) count += matches.length;
    }
    return count;
  }

  scoreSentiment(content) {
    const aspectPatterns = {
      quality: /(quality|perform|accuracy|reliable|fast|slow|efficien)/i,
      usability: /(easy|simple|intuitive|convenient|difficult|confus)/i,
      value: /(worth|price|cost|expensive|cheap|value|bargain)/i,
      support: /(support|service|help|responsive|team|response)/i,
      overall: /(overall|total|average|general|recommend)/i
    };

    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const aspectSentiments = {};
    let overallPositive = 0;
    let overallNegative = 0;
    let overallNeutral = 0;

    for (const [aspect, pattern] of Object.entries(aspectPatterns)) {
      const aspectSentences = sentences.filter(s => pattern.test(s));
      const posCount = this._countMatchesInSentences(aspectSentences, this._positivePatterns);
      const negCount = this._countMatchesInSentences(aspectSentences, this._negativePatterns);
      const total = posCount + negCount;

      if (total === 0) {
        aspectSentiments[aspect] = { score: 0.5, label: 'neutral', positive: 0, negative: 0, confidence: 0 };
      } else {
        const ratio = (posCount - negCount) / total;
        const confidence = Math.min(1, total / 3);
        aspectSentiments[aspect] = {
          score: Math.round((0.5 + ratio * 0.5) * 100) / 100,
          label: ratio > 0.2 ? 'positive' : ratio < -0.2 ? 'negative' : 'neutral',
          positive: posCount,
          negative: negCount,
          confidence: Math.round(confidence * 100) / 100
        };
      }

      if (aspect !== 'overall') {
        if (aspectSentiments[aspect].label === 'positive') overallPositive++;
        else if (aspectSentiments[aspect].label === 'negative') overallNegative++;
        else overallNeutral++;
      }
    }

    const emotionPatterns = {
      joy: /\b(happy|excited|delighted|pleased|thrilled|glad|joy|love|fantastic|wonderful)\b/i,
      anger: /\b(angry|furious|irritated|frustrated|annoyed|upset|rage|hate)\b/i,
      fear: /\b(afraid|scared|worried|anxious|nervous|terrified|panic|fear)\b/i,
      surprise: /\b(surprised|amazed|astonished|shocked|unexpected|stunned)\b/i,
      sadness: /\b(sad|depressed|disappointed|unhappy|miserable|sorry|grief|sorrow)\b/i
    };

    const emotions = {};
    let dominantEmotion = null;
    let maxEmotionCount = 0;

    for (const [emotion, pattern] of Object.entries(emotionPatterns)) {
      const matches = content.match(pattern);
      emotions[emotion] = { count: matches ? matches.length : 0 };
      if (emotions[emotion].count > maxEmotionCount) {
        maxEmotionCount = emotions[emotion].count;
        dominantEmotion = emotion;
      }
    }

    const totalPositive = this._countMatches(content, this._positivePatterns);
    const totalNegative = this._countMatches(content, this._negativePatterns);
    const totalSentiment = totalPositive + totalNegative;

    let sentimentScore = 0.5;
    let sentimentLabel = 'neutral';
    let sentimentIntensity = 0;

    if (totalSentiment > 0) {
      const rawScore = (totalPositive - totalNegative) / totalSentiment;
      sentimentScore = 0.5 + rawScore * 0.5;
      sentimentIntensity = Math.min(1, totalSentiment / 20);
      
      if (rawScore > 0.2) sentimentLabel = 'positive';
      else if (rawScore < -0.2) sentimentLabel = 'negative';
    }

    const subjectivity = totalSentiment / Math.max(1, content.split(/\s+/).length);
    const subjectivityScore = Math.min(1, subjectivity * 10);

    const negationPatterns = [/\bnot\b|\bno\b|\bnever\b|\bneither\b|\bwithout\b|\bdon't\b|\bdidn't\b|\bwon't\b|\bisn't\b|\baren't\b|\bwasn't\b|\baren't\b/gi];
    const negationCount = this._countMatches(content, negationPatterns);
    const negationEffect = Math.min(0.2, negationCount * 0.02);

    const intensifiedPatterns = [/\bvery\b|\breally\b|\babsolutely\b|\btotally\b|\bcompletely\b|\bextremely\b/gi];
    const intensifierCount = this._countMatches(content, intensifiedPatterns);
    const intensifierEffect = Math.min(0.15, intensifierCount * 0.03);

    const finalScore = Math.max(0, Math.min(1, sentimentScore - negationEffect + intensifierEffect));

    const polarityShift = this._detectPolarityShifts(sentences);

    return {
      score: Math.round(finalScore * 100) / 100,
      label: sentimentLabel,
      intensity: Math.round(sentimentIntensity * 100) / 100,
      subjectivity: Math.round(subjectivityScore * 100) / 100,
      aspects: aspectSentiments,
      emotions: {
        ...emotions,
        dominant: dominantEmotion,
        diversity: Object.values(emotions).filter(e => e.count > 0).length
      },
      modifiers: {
        negationCount,
        intensifierCount,
        negationEffect: Math.round(negationEffect * 100) / 100,
        intensifierEffect: Math.round(intensifierEffect * 100) / 100
      },
      polarityShifts: polarityShift,
      raw: {
        positive: totalPositive,
        negative: totalNegative,
        total: totalSentiment,
        netScore: Math.round((totalPositive - totalNegative) * 100) / 100
      },
      confidence: Math.round(Math.min(1, totalSentiment / 10) * 100) / 100
    };
  }

  _countMatchesInSentences(sentences, patterns) {
    let count = 0;
    for (const sentence of sentences) {
      for (const pattern of patterns) {
        const matches = sentence.match(pattern);
        if (matches) count += matches.length;
      }
    }
    return count;
  }

  _detectPolarityShifts(sentences) {
    const shifts = [];
    let lastPolarity = 0;

    for (let i = 0; i < sentences.length; i++) {
      const pos = this._countMatchesInSentences([sentences[i]], this._positivePatterns);
      const neg = this._countMatchesInSentences([sentences[i]], this._negativePatterns);
      const total = pos + neg;

      if (total === 0) continue;

      const polarity = (pos - neg) / total;

      if (lastPolarity !== 0 && polarity !== 0 && Math.sign(polarity) !== Math.sign(lastPolarity)) {
        shifts.push({
          sentenceIndex: i,
          from: lastPolarity > 0 ? 'positive' : 'negative',
          to: polarity > 0 ? 'positive' : 'negative',
          context: sentences[i].substring(0, 50)
        });
      }

      lastPolarity = polarity;
    }

    return {
      count: shifts.length,
      locations: shifts,
      hasShifts: shifts.length > 0
    };
  }

  buildUserStyleProfile(samples) {
    if (!Array.isArray(samples)) samples = [samples];
    const profiles = samples.map(sample => this._analyzeStyle(sample));
    
    this._userStyleProfile = {
      avgSentenceLength: profiles.reduce((sum, p) => sum + p.avgSentenceLength, 0) / profiles.length,
      avgWordLength: profiles.reduce((sum, p) => sum + p.avgWordLength, 0) / profiles.length,
      formalityLevel: profiles.reduce((sum, p) => sum + p.formalityLevel, 0) / profiles.length,
      technicalLevel: profiles.reduce((sum, p) => sum + p.technicalLevel, 0) / profiles.length
    };

    return this._userStyleProfile;
  }

  _analyzeStyle(text) {
    const words = text.split(/\s+/);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return {
      avgSentenceLength: words.length / Math.max(1, sentences.length),
      avgWordLength: words.reduce((sum, w) => sum + w.length, 0) / Math.max(1, words.length),
      formalityLevel: Math.min(1, this._countMatches(text, this._formalPatterns) / Math.max(1, words.length / 10)),
      technicalLevel: Math.min(1, this._countMatches(text, this._technicalPatterns) / Math.max(1, words.length / 10))
    };
  }

  scoreStyleConsistency(content, userStyle = null) {
    const targetProfile = userStyle || this._userStyleProfile;
    
    if (!targetProfile) {
      return { score: 0.7, consistency: 'unknown', message: 'No user style profile available' };
    }

    const contentStyle = this._analyzeStyleAdvanced(content);

    const sentenceLengthDiff = Math.abs(contentStyle.avgSentenceLength - targetProfile.avgSentenceLength) / Math.max(1, targetProfile.avgSentenceLength);
    const wordLengthDiff = Math.abs(contentStyle.avgWordLength - targetProfile.avgWordLength) / Math.max(1, targetProfile.avgWordLength);
    const formalityDiff = Math.abs(contentStyle.formalityLevel - targetProfile.formalityLevel);
    const technicalDiff = Math.abs(contentStyle.technicalLevel - targetProfile.technicalLevel);
    const punctuationDiff = Math.abs(contentStyle.punctuationDensity - targetProfile.punctuationDensity) / Math.max(0.01, targetProfile.punctuationDensity);
    const questionDiff = Math.abs(contentStyle.questionFrequency - targetProfile.questionFrequency) / Math.max(0.01, targetProfile.questionFrequency);

    const vocabularyOverlap = this._calculateVocabularyOverlap(
      contentStyle.uniqueWords || new Set(content.split(/\s+/)),
      targetProfile.uniqueWords || new Set()
    );

    const sentenceStructureDiff = this._calculateSentenceStructureDiff(contentStyle.sentencePatterns, targetProfile.sentencePatterns);

    const punctuationPatternsDiff = this._calculatePunctuationDiff(contentStyle.punctuationPatterns, targetProfile.punctuationPatterns);

    const dimensionScores = {
      sentenceLength: Math.max(0, 1 - sentenceLengthDiff),
      wordLength: Math.max(0, 1 - wordLengthDiff * 2),
      formality: Math.max(0, 1 - formalityDiff * 2),
      technical: Math.max(0, 1 - technicalDiff * 2),
      vocabulary: vocabularyOverlap,
      sentenceStructure: sentenceStructureDiff,
      punctuation: Math.max(0, 1 - punctuationPatternsDiff * 3)
    };

    const weights = {
      sentenceLength: 0.15,
      wordLength: 0.10,
      formality: 0.15,
      technical: 0.15,
      vocabulary: 0.20,
      sentenceStructure: 0.15,
      punctuation: 0.10
    };

    const weightedScore = Object.entries(dimensionScores).reduce(
      (sum, [dim, score]) => sum + score * weights[dim],
      0
    );

    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    const overallScore = weightedScore / totalWeight;

    let consistency = 'low';
    if (overallScore >= 0.75) consistency = 'high';
    else if (overallScore >= 0.5) consistency = 'medium';

    const styleDeviations = Object.entries(dimensionScores)
      .filter(([_, score]) => score < 0.6)
      .map(([dim, score]) => ({ dimension: dim, deviation: Math.round((1 - score) * 100) }));

    return {
      score: Math.round(overallScore * 100) / 100,
      consistency,
      dimensionScores: Object.fromEntries(
        Object.entries(dimensionScores).map(([k, v]) => [k, Math.round(v * 100) / 100])
      ),
      styleDeviations,
      targetProfile,
      contentProfile: {
        avgSentenceLength: Math.round(contentStyle.avgSentenceLength * 100) / 100,
        avgWordLength: Math.round(contentStyle.avgWordLength * 100) / 100,
        formalityLevel: Math.round(contentStyle.formalityLevel * 100) / 100,
        technicalLevel: Math.round(contentStyle.technicalLevel * 100) / 100,
        vocabularyRichness: Math.round(contentStyle.vocabularyRichness * 100) / 100
      },
      recommendations: this._generateStyleRecommendations(dimensionScores, targetProfile)
    };
  }

  _analyzeStyleAdvanced(text) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    
    const wordLengths = words.map(w => w.length);
    const sentenceLengths = sentences.map(s => s.split(/\s+/).length);
    
    const vocabularyRichness = uniqueWords.size / Math.max(1, words.length);
    
    const punctuationPatterns = {
      comma: (text.match(/,/g) || []).length,
      semicolon: (text.match(/;/g) || []).length,
      colon: (text.match(/:/g) || []).length,
      dash: (text.match(/-/g) || []).length,
      quotes: (text.match(/["']/g) || []).length,
      parentheses: (text.match(/[()]/g) || []).length
    };
    
    const totalPunctuation = Object.values(punctuationPatterns).reduce((a, b) => a + b, 0);
    
    const sentencePatterns = {
      simple: sentences.filter(s => !s.includes(',') && s.split(/\s+/).length < 15).length,
      complex: sentences.filter(s => s.includes(',') || s.split(/\s+/).length >= 20).length,
      compound: sentences.filter(s => /\b(and|but|or|however|therefore)\b/i.test(s)).length
    };
    
    const sentenceTypeDistribution = {
      declarative: (text.match(/\.\s+[A-Z]/g) || []).length,
      interrogative: (text.match(/\?\s*[A-Z]/g) || []).length,
      exclamatory: (text.match(/!\s*[A-Z]/g) || []).length
    };

    return {
      avgSentenceLength: words.length / Math.max(1, sentences.length),
      avgWordLength: wordLengths.reduce((a, b) => a + b, 0) / Math.max(1, wordLengths.length),
      formalityLevel: Math.min(1, this._countMatches(text, this._formalPatterns) / Math.max(1, words.length / 10)),
      technicalLevel: Math.min(1, this._countMatches(text, this._technicalPatterns) / Math.max(1, words.length / 10)),
      punctuationDensity: totalPunctuation / Math.max(1, text.length),
      questionFrequency: (text.match(/\?/g) || []).length / Math.max(1, sentences.length),
      vocabularyRichness,
      uniqueWords,
      punctuationPatterns,
      sentencePatterns,
      sentenceTypeDistribution,
      sentenceLengthVariance: this._calculateVariance(sentenceLengths),
      wordLengthVariance: this._calculateVariance(wordLengths)
    };
  }

  _calculateVariance(values) {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  _calculateVocabularyOverlap(words1, words2) {
    if (words1.size === 0 || words2.size === 0) return 0.5;
    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) intersection++;
    }
    const union = words1.size + words2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  _calculateSentenceStructureDiff(patterns1, patterns2) {
    const total1 = Object.values(patterns1).reduce((a, b) => a + b, 0) || 1;
    const total2 = Object.values(patterns2).reduce((a, b) => a + b, 0) || 1;
    
    let diff = 0;
    for (const key of new Set([...Object.keys(patterns1), ...Object.keys(patterns2)])) {
      const v1 = (patterns1[key] || 0) / total1;
      const v2 = (patterns2[key] || 0) / total2;
      diff += Math.abs(v1 - v2);
    }
    return Math.max(0, 1 - diff / 2);
  }

  _calculatePunctuationDiff(patterns1, patterns2) {
    const total1 = Object.values(patterns1).reduce((a, b) => a + b, 0) || 1;
    const total2 = Object.values(patterns2).reduce((a, b) => a + b, 0) || 1;
    
    let diff = 0;
    for (const key of new Set([...Object.keys(patterns1), ...Object.keys(patterns2)])) {
      const v1 = (patterns1[key] || 0) / total1;
      const v2 = (patterns2[key] || 0) / total2;
      diff += Math.abs(v1 - v2);
    }
    return Math.max(0, 1 - diff / 2);
  }

  _generateStyleRecommendations(dimensionScores, targetProfile) {
    const recommendations = [];
    
    if (dimensionScores.vocabulary < 0.6) {
      recommendations.push('Use more varied vocabulary to match writing style');
    }
    if (dimensionScores.sentenceLength < 0.6) {
      recommendations.push('Adjust sentence length to better match target style');
    }
    if (dimensionScores.formality < 0.6) {
      recommendations.push('Match the formality level of the target style');
    }
    if (dimensionScores.punctuation < 0.6) {
      recommendations.push('Adjust punctuation patterns to match target style');
    }
    
    return recommendations;
  }

  getScoreTrend(windowSize = 10) {
    if (this._scoreHistory.length < 2) {
      return { trend: 'insufficient_data', samples: this._scoreHistory.length };
    }

    const recent = this._scoreHistory.slice(-windowSize);
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));

    const firstAvg = firstHalf.reduce((sum, s) => sum + s.overall, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, s) => sum + s.overall, 0) / secondHalf.length;

    const change = secondAvg - firstAvg;
    let trend = 'stable';
    let trendStrength = 'weak';
    
    if (change > 0.1) { trend = 'strongly_improving'; trendStrength = 'strong'; }
    else if (change > 0.05) { trend = 'improving'; trendStrength = 'moderate'; }
    else if (change < -0.1) { trend = 'strongly_declining'; trendStrength = 'strong'; }
    else if (change < -0.05) { trend = 'declining'; trendStrength = 'moderate'; }

    const volatility = this._calculateVolatility(recent.map(s => s.overall));
    const trendSignificance = this._calculateTrendSignificance(recent.map(s => s.overall));
    const seasonality = this._detectSeasonality(recent);
    const drift = this._detectDrift(recent);
    
    let prediction = null;
    if (trend !== 'stable' && trendSignificance > 0.7) {
      const slope = this._calculateSlope(recent.map(s => s.overall));
      prediction = {
        nextExpectedScore: Math.round((secondAvg + slope * 3) * 100) / 100,
        confidence: Math.round(trendSignificance * 100) / 100,
        direction: trend.includes('improving') ? 'up' : trend.includes('declining') ? 'down' : 'stable'
      };
    }

    return {
      trend,
      trendStrength,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round((change / Math.max(0.01, firstAvg)) * 100) / 100,
      samples: recent.length,
      firstHalfAvg: Math.round(firstAvg * 100) / 100,
      secondHalfAvg: Math.round(secondAvg * 100) / 100,
      volatility: Math.round(volatility * 100) / 100,
      trendSignificance: Math.round(trendSignificance * 100) / 100,
      seasonality: seasonality.detected ? { ...seasonality } : null,
      drift: drift.detected ? { ...drift } : null,
      prediction,
      summary: this._generateTrendSummary(trend, change, volatility, trendSignificance)
    };
  }

  _calculateVolatility(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(variance);
  }

  _calculateTrendSignificance(values) {
    if (values.length < 4) return 0;
    const n = values.length;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let xDenominator = 0;
    let yDenominator = 0;
    
    for (let i = 0; i < n; i++) {
      const xDiff = i - xMean;
      const yDiff = values[i] - yMean;
      numerator += xDiff * yDiff;
      xDenominator += xDiff * xDiff;
      yDenominator += yDiff * yDiff;
    }
    
    const correlation = numerator / Math.sqrt(xDenominator * yDenominator);
    return Math.abs(correlation);
  }

  _calculateSlope(values) {
    const n = values.length;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (values[i] - yMean);
      denominator += (i - xMean) * (i - xMean);
    }
    
    return denominator !== 0 ? numerator / denominator : 0;
  }

  _detectSeasonality(recent) {
    if (recent.length < 6) return { detected: false };
    
    const values = recent.map(s => s.overall);
    const n = values.length;
    
    const autocorrelations = [];
    for (let lag = 1; lag <= Math.floor(n / 2); lag++) {
      let correlation = 0;
      for (let i = 0; i < n - lag; i++) {
        correlation += (values[i] - values[i + lag]);
      }
      autocorrelations.push({ lag, correlation: Math.abs(correlation / (n - lag)) });
    }
    
    const maxAutocorr = autocorrelations.reduce((max, a) => a.correlation > max.correlation ? a : max, { correlation: 0 });
    
    return {
      detected: maxAutocorr.correlation > 0.3,
      period: maxAutocorr.lag,
      strength: Math.min(1, maxAutocorr.correlation)
    };
  }

  _detectDrift(recent) {
    if (recent.length < 5) return { detected: false };
    
    const values = recent.map(s => s.overall);
    const windowSize = Math.floor(values.length / 2);
    
    const firstWindow = values.slice(0, windowSize);
    const secondWindow = values.slice(windowSize);
    
    const firstMean = firstWindow.reduce((a, b) => a + b, 0) / firstWindow.length;
    const secondMean = secondWindow.reduce((a, b) => a + b, 0) / secondWindow.length;
    
    const firstVariance = firstWindow.reduce((sum, v) => sum + Math.pow(v - firstMean, 2), 0) / firstWindow.length;
    const secondVariance = secondWindow.reduce((sum, v) => sum + Math.pow(v - secondMean, 2), 0) / secondWindow.length;
    
    const pooledStd = Math.sqrt((firstVariance + secondVariance) / 2);
    const effectSize = pooledStd > 0 ? Math.abs(secondMean - firstMean) / pooledStd : 0;
    
    return {
      detected: effectSize > 0.5,
      effectSize: Math.round(effectSize * 100) / 100,
      from: Math.round(firstMean * 100) / 100,
      to: Math.round(secondMean * 100) / 100,
      magnitude: effectSize > 1 ? 'large' : effectSize > 0.5 ? 'medium' : 'small'
    };
  }

  _generateTrendSummary(trend, change, volatility, significance) {
    if (trend === 'strongly_improving') {
      return `Quality is significantly improving. Consider current trajectory.`;
    }
    if (trend === 'strongly_declining') {
      return `Quality is significantly declining. Immediate attention recommended.`;
    }
    if (trend === 'improving') {
      return `Quality is gradually improving.`;
    }
    if (trend === 'declining') {
      return `Quality is gradually declining. Monitor closely.`;
    }
    if (volatility > 0.15) {
      return `Quality is stable but with high variability.`;
    }
    return `Quality is stable within normal parameters.`;
  }

  compareMultipleScores(...scores) {
    if (scores.length < 2) {
      return { error: 'At least 2 scores required for comparison' };
    }

    const dimensions = ['relevance', 'completeness', 'consistency', 'hallucinationResistance', 'toxicity', 'faithfulness', 'factuality', 'coherence', 'conciseness'];
    const result = { overall: {}, ranking: [], winner: null, statisticalTests: {} };

    scores.forEach((score, idx) => {
      result.overall[`score${idx + 1}`] = score.overall;
    });

    const sorted = Object.entries(result.overall).sort((a, b) => b[1] - a[1]);
    result.ranking = sorted.map(([key, value], idx) => ({ rank: idx + 1, key, value }));
    result.winner = sorted[0][0];

    const overallValues = scores.map(s => s.overall);
    const anovaResult = this._performANOVA(overallValues);
    result.statisticalTests.anova = anovaResult;

    if (scores.length === 2) {
      const tTestResult = this._performTTest(scores[0].overall, scores[1].overall);
      result.statisticalTests.tTest = tTestResult;
      result.statisticalTests.significantDifference = tTestResult.pValue < 0.05;
      result.statisticalTests.confidenceInterval = this._calculateConfidenceInterval(
        scores[0].overall - scores[1].overall,
        scores.length
      );
    }

    result.dimensionComparison = {};
    for (const dim of dimensions) {
      if (scores[0][dim] !== undefined) {
        const dimValues = scores.map(s => s[dim]);
        result.dimensionComparison[dim] = {
          values: dimValues.reduce((acc, v, i) => ({ ...acc, [`score${i + 1}`]: v }), {}),
          best: dimValues.indexOf(Math.max(...dimValues)),
          variance: this._calculateVariance(dimValues)
        };

        if (scores.length === 2) {
          result.dimensionComparison[dim].tTest = this._performTTest(dimValues[0], dimValues[1]);
        }
      }
    }

    const effectSizes = [];
    for (let i = 0; i < scores.length - 1; i++) {
      for (let j = i + 1; j < scores.length; j++) {
        const cohensD = this._calculateCohenD(scores[i].overall, scores[j].overall);
        effectSizes.push({
          comparison: `${i + 1} vs ${j + 1}`,
          cohenD: Math.round(cohensD * 100) / 100,
          interpretation: this._interpretCohenD(cohensD)
        });
      }
    }
    result.statisticalTests.effectSizes = effectSizes;

    return result;
  }

  _performANOVA(groups) {
    const allValues = groups.flat();
    const grandMean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
    
    let ssBetween = 0;
    let ssWithin = 0;
    
    for (const group of groups) {
      const groupMean = group.reduce((a, b) => a + b, 0) / group.length;
      ssBetween += group.length * Math.pow(groupMean - grandMean, 2);
      for (const value of group) {
        ssWithin += Math.pow(value - groupMean, 2);
      }
    }
    
    const dfBetween = groups.length - 1;
    const dfWithin = allValues.length - groups.length;
    
    const msBetween = ssBetween / dfBetween;
    const msWithin = ssWithin / dfWithin;
    
    const fStatistic = msWithin > 0 ? msBetween / msWithin : 0;
    const pValue = this._fDistributionPValue(fStatistic, dfBetween, dfWithin);
    
    return {
      fStatistic: Math.round(fStatistic * 100) / 100,
      pValue: Math.round(pValue * 1000) / 1000,
      significant: pValue < 0.05,
      effectSize: Math.round((ssBetween / (ssBetween + ssWithin)) * 100) / 100
    };
  }

  _performTTest(mean1, mean2, n1 = 1, n2 = 1) {
    const pooledStd = Math.sqrt(((n1 - 1) + (n2 - 1)) / (n1 + n2 - 2));
    const tStatistic = pooledStd > 0 ? (mean1 - mean2) / pooledStd : 0;
    const pValue = this._tDistributionPValue(Math.abs(tStatistic), n1 + n2 - 2);
    
    return {
      tStatistic: Math.round(tStatistic * 100) / 100,
      pValue: Math.round(pValue * 1000) / 1000,
      significant: pValue < 0.05,
      meanDifference: Math.round((mean1 - mean2) * 100) / 100
    };
  }

  _calculateCohenD(mean1, mean2) {
    const pooledStd = Math.sqrt(Math.pow(mean1 - 0.5, 2) + Math.pow(mean2 - 0.5, 2));
    return pooledStd > 0 ? (mean1 - mean2) / pooledStd : 0;
  }

  _interpretCohenD(d) {
    const absD = Math.abs(d);
    if (absD < 0.2) return 'negligible';
    if (absD < 0.5) return 'small';
    if (absD < 0.8) return 'medium';
    return 'large';
  }

  _calculateConfidenceInterval(difference, n, confidence = 0.95) {
    const stdError = Math.sqrt((1 / n) * 0.15);
    const zScore = confidence === 0.95 ? 1.96 : 2.576;
    const margin = zScore * stdError;
    
    return {
      lower: Math.round((difference - margin) * 100) / 100,
      upper: Math.round((difference + margin) * 100) / 100,
      confidence: confidence * 100 + '%'
    };
  }

  _tDistributionPValue(t, df) {
    const x = df / (df + t * t);
    return df > 1 ? this._betaIncomplete(df / 2, 0.5, x) : 0;
  }

  _fDistributionPValue(f, df1, df2) {
    const x = df1 * f / (df1 * f + df2);
    return this._betaIncomplete(df1 / 2, df2 / 2, x);
  }

  _betaIncomplete(a, b, x) {
    if (x < 0 || x > 1) return 0;
    if (x === 0) return 0;
    if (x === 1) return 1;
    
    const bt = Math.exp(
      this._logGamma(a + b) - this._logGamma(a) - this._logGamma(b) +
      a * Math.log(x) + b * Math.log(1 - x)
    );
    
    return bt * this._betaCF(a, b, x) / a;
  }

  _logGamma(x) {
    const coefficients = [
      76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.001208650973866179, -0.000005395239384953
    ];
    
    let y = x;
    let tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let sum = 1.000000000190015;
    
    for (let j = 0; j < 6; j++) {
      sum += coefficients[j] / ++y;
    }
    
    return -tmp + Math.log(2.5066282746310005 * sum / x);
  }

  _betaCF(a, b, x) {
    const maxIterations = 100;
    const epsilon = 1e-10;
    
    let am = 1;
    let bm = 1;
    let az = 1;
    let qab = a + b;
    let qap = a + 1;
    let qam = a - 1;
    let bz = 1 - qab * x / qap;
    
    for (let m = 1; m <= maxIterations; m++) {
      const em = m;
      const tem = em + em;
      let d = em * (b - m) * x / ((qam + tem) * (a + tem));
      const ap = az + am * d;
      const bp = bz + am * d * bz;
      const aap = ap / bp;
      const app = az / bz;
      const t = az * aap - am * app;
      const bpp = bp / bz;
      az = ap / bpp;
      bz = 1;
      am = aap;
      bm = bpp;
      
      if (Math.abs(t - bz * az) < epsilon * Math.abs(az)) {
        return az;
      }
    }
    
    return az;
  }

  analyzeScoreAnomalies(threshold = 0.15) {
    if (this._scoreHistory.length < 3) {
      return { anomalies: [], message: 'Not enough data for anomaly detection' };
    }

    const anomalies = [];
    const recent = this._scoreHistory.slice(-20);

    for (let i = 1; i < recent.length; i++) {
      const change = Math.abs(recent[i].overall - recent[i - 1].overall);
      if (change > threshold) {
        anomalies.push({
          timestamp: recent[i].timestamp,
          previousScore: recent[i - 1].overall,
          currentScore: recent[i].overall,
          change: Math.round(change * 100) / 100,
          severity: change > 0.3 ? 'high' : 'medium'
        });
      }
    }

    return {
      anomalies,
      anomalyRate: Math.round((anomalies.length / recent.length) * 100) / 100,
      avgScore: Math.round(recent.reduce((sum, s) => sum + s.overall, 0) / recent.length * 100) / 100
    };
  }

  compareScores(scoreA, scoreB) {
    const dimensions = ['relevance', 'completeness', 'consistency', 'hallucinationResistance', 'toxicity', 'faithfulness', 'factuality', 'coherence', 'conciseness', 'readability', 'sentiment', 'styleConsistency'];
    
    const comparison = {
      overall: { A: scoreA.overall, B: scoreB.overall, winner: scoreA.overall > scoreB.overall ? 'A' : 'B' },
      dimensions: {}
    };

    for (const dim of dimensions) {
      if (scoreA[dim] !== undefined && scoreB[dim] !== undefined) {
        const diff = scoreA[dim] - scoreB[dim];
        comparison.dimensions[dim] = {
          A: scoreA[dim],
          B: scoreB[dim],
          diff: Math.round(diff * 100) / 100,
          winner: diff > 0 ? 'A' : diff < 0 ? 'B' : 'tie'
        };
      }
    }

    const aWins = Object.values(comparison.dimensions).filter(d => d.winner === 'A').length;
    const bWins = Object.values(comparison.dimensions).filter(d => d.winner === 'B').length;
    comparison.dimensionWinner = aWins > bWins ? 'A' : bWins > aWins ? 'B' : 'tie';

    return comparison;
  }

  getQualityReport(content, context = {}) {
    const score = this.score(content, context);
    
    const thresholds = {
      excellent: 0.85,
      good: 0.7,
      acceptable: 0.5,
      poor: 0.3
    };

    let quality = 'poor';
    if (score.overall >= thresholds.excellent) quality = 'excellent';
    else if (score.overall >= thresholds.good) quality = 'good';
    else if (score.overall >= thresholds.acceptable) quality = 'acceptable';

    const strengths = [];
    const weaknesses = [];

    const dimensionThresholds = {
      relevance: 0.7,
      completeness: 0.7,
      consistency: 0.8,
      hallucinationResistance: 0.7,
      toxicity: 0.8,
      faithfulness: 0.6,
      factuality: 0.6,
      coherence: 0.6,
      conciseness: 0.5,
      readability: 0.5,
      sentiment: 0.5,
      styleConsistency: 0.5
    };

    for (const [dim, threshold] of Object.entries(dimensionThresholds)) {
      if (score[dim] && score[dim].score !== undefined) {
        if (score[dim].score >= threshold) {
          strengths.push({ dimension: dim, score: score[dim].score });
        } else {
          weaknesses.push({ dimension: dim, score: score[dim].score, below: threshold - score[dim].score });
        }
      } else if (score[dim] !== undefined && typeof score[dim] === 'number') {
        if (score[dim] >= threshold) {
          strengths.push({ dimension: dim, score: score[dim] });
        } else {
          weaknesses.push({ dimension: dim, score: score[dim], below: threshold - score[dim] });
        }
      }
    }

    const improvementSuggestions = weaknesses.map(w => {
      const suggestions = {
        relevance: 'Include more keywords from the query',
        completeness: 'Add more details or address missing aspects',
        consistency: 'Check for contradictory statements',
        hallucinationResistance: 'Use more cautious language, avoid absolute claims',
        toxicity: 'Remove offensive or aggressive language',
        faithfulness: 'Stay closer to the source material',
        factuality: 'Add uncertainty qualifiers to statistical claims',
        coherence: 'Use transition words to connect ideas',
        conciseness: 'Remove filler words and redundant phrases',
        readability: 'Simplify sentence structure or use simpler vocabulary',
        sentiment: 'Adjust tone to better match expected sentiment',
        styleConsistency: 'Match the writing style of previous responses'
      };
      return suggestions[w.dimension] || `Improve ${w.dimension}`;
    });

    return {
      score,
      quality,
      grade: this._getGrade(score.overall),
      strengths,
      weaknesses,
      improvementSuggestions,
      summary: this._generateQualitySummary(score, quality)
    };
  }

  _generateQualitySummary(score, quality) {
    const qualityMessages = {
      excellent: `This is an excellent response with an overall score of ${score.overall}. It performs well across all dimensions.`,
      good: `This is a good response with an overall score of ${score.overall}. Consider improving ${score.weaknesses?.map(w => w.dimension).join(', ') || 'some areas'}.`,
      acceptable: `This is an acceptable response with an overall score of ${score.overall}. Several improvements could be made.`,
      poor: `This response needs significant improvement. Overall score: ${score.overall}.`
    };
    return qualityMessages[quality];
  }

  _getBasicStats(content) {
    const words = content.split(/\s+/).filter(w => w.length > 0);
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return {
      wordCount: words.length,
      sentenceCount: sentences.length
    };
  }

  _getGrade(score) {
    if (score >= 0.9) return 'A';
    if (score >= 0.8) return 'B';
    if (score >= 0.7) return 'C';
    if (score >= 0.5) return 'D';
    return 'F';
  }

  async scoreAsync(content, context = {}) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(this.score(content, context));
      }, 0);
    });
  }

  getWeights() {
    return { ...this._weights };
  }

  setWeights(weights) {
    this._weights = { ...this._weights, ...weights };
    return this;
  }
}

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
    return `cache_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`;
  }

  _hashRequest(request) {
    const str = JSON.stringify(request);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  _estimateSize(value) {
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 0;
    }
  }

  _isExpired(entry) {
    if (!entry.ttl) return false;
    return Date.now() > entry.createdAt + entry.ttl;
  }

  _evictIfNeeded(requiredSpace = 0) {
    const currentSize = this._getTotalSize();
    const availableSpace = this._maxMemory - currentSize;

    if (availableSpace < requiredSpace || this._storage.size >= this._maxSize) {
      if (this._evictionPolicy === 'lru') {
        this._evictLRU(requiredSpace);
      } else if (this._evictionPolicy === 'ttl') {
        this._evictTTL();
      } else if (this._evictionPolicy === 'size') {
        this._evictBySize();
      }
    }
  }

  _evictLRU(requiredSpace) {
    while (this._storage.size > 0) {
      const oldestKey = this._accessOrder.shift();
      if (oldestKey) {
        const entry = this._storage.get(oldestKey);
        if (entry) {
          this._storage.delete(oldestKey);
          this._evictions++;
          if (this._getTotalSize() + requiredSpace <= this._maxMemory) {
            break;
          }
        }
      }
    }
  }

  _evictTTL() {
    const now = Date.now();
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this._storage.entries()) {
      const expiresAt = entry.createdAt + (entry.ttl || this._defaultTtl);
      if (expiresAt < oldestTime) {
        oldestTime = expiresAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this._storage.delete(oldestKey);
      this._accessOrder = this._accessOrder.filter(k => k !== oldestKey);
      this._evictions++;
    }
  }

  _evictBySize() {
    let largestKey = null;
    let largestSize = 0;

    for (const [key, entry] of this._storage.entries()) {
      if (entry.size > largestSize) {
        largestSize = entry.size;
        largestKey = key;
      }
    }

    if (largestKey) {
      this._storage.delete(largestKey);
      this._accessOrder = this._accessOrder.filter(k => k !== largestKey);
      this._evictions++;
    }
  }

  _getTotalSize() {
    let total = 0;
    for (const entry of this._storage.values()) {
      total += entry.size || 0;
    }
    return total;
  }

  _updateAccessOrder(key) {
    this._accessOrder = this._accessOrder.filter(k => k !== key);
    this._accessOrder.push(key);
  }

  set(request, response, options = {}) {
    const key = this._hashRequest(request);
    const existing = this._storage.get(key);

    if (existing) {
      this._accessOrder = this._accessOrder.filter(k => k !== key);
    }

    const size = options.size || this._estimateSize(response);
    this._evictIfNeeded(size);

    const entry = {
      response,
      createdAt: Date.now(),
      ttl: options.ttl || this._defaultTtl,
      size,
      tags: options.tags || [],
      metadata: options.metadata || {},
      accessCount: (existing?.accessCount || 0),
      lastAccessed: Date.now()
    };

    this._storage.set(key, entry);
    this._accessOrder.push(key);

    return key;
  }

  get(request) {
    const key = this._hashRequest(request);
    const entry = this._storage.get(key);

    if (!entry) {
      this._misses++;
      return null;
    }

    if (this._isExpired(entry)) {
      this._storage.delete(key);
      this._accessOrder = this._accessOrder.filter(k => k !== key);
      this._misses++;
      return null;
    }

    this._updateAccessOrder(key);
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    this._hits++;

    return {
      response: entry.response,
      metadata: entry.metadata,
      age: Date.now() - entry.createdAt,
      ttl: entry.ttl,
      remainingTtl: Math.max(0, entry.ttl - (Date.now() - entry.createdAt))
    };
  }

  has(request) {
    const key = this._hashRequest(request);
    const entry = this._storage.get(key);

    if (!entry) return false;
    if (this._isExpired(entry)) {
      this._storage.delete(key);
      this._accessOrder = this._accessOrder.filter(k => k !== key);
      return false;
    }

    return true;
  }

  invalidate(request) {
    const key = this._hashRequest(request);
    const deleted = this._storage.delete(key);
    this._accessOrder = this._accessOrder.filter(k => k !== key);
    return deleted;
  }

  invalidateByTag(tag) {
    let count = 0;
    for (const [key, entry] of this._storage.entries()) {
      if (entry.tags && entry.tags.includes(tag)) {
        this._storage.delete(key);
        this._accessOrder = this._accessOrder.filter(k => k !== key);
        count++;
      }
    }
    return count;
  }

  invalidateByPattern(pattern) {
    let count = 0;
    const regex = new RegExp(pattern);

    for (const [key, entry] of this._storage.entries()) {
      if (regex.test(key)) {
        this._storage.delete(key);
        this._accessOrder = this._accessOrder.filter(k => k !== key);
        count++;
      }
    }
    return count;
  }

  clear() {
    const size = this._storage.size;
    this._storage.clear();
    this._accessOrder = [];
    return size;
  }

  getStats() {
    const total = this._hits + this._misses;
    return {
      size: this._storage.size,
      maxSize: this._maxSize,
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? Math.round((this._hits / total) * 100) / 100 : 0,
      evictions: this._evictions,
      totalMemory: this._getTotalSize(),
      maxMemory: this._maxMemory,
      memoryUsagePercent: Math.round((this._getTotalSize() / this._maxMemory) * 100) / 100,
      evictionPolicy: this._evictionPolicy
    };
  }

  getEntries() {
    const entries = [];
    for (const [key, entry] of this._storage.entries()) {
      entries.push({
        key: key.substring(0, 20) + '...',
        age: Date.now() - entry.createdAt,
        ttl: entry.ttl,
        remainingTtl: Math.max(0, entry.ttl - (Date.now() - entry.createdAt)),
        size: entry.size,
        accessCount: entry.accessCount,
        lastAccessed: entry.lastAccessed,
        tags: entry.tags,
        expired: this._isExpired(entry)
      });
    }
    return entries.sort((a, b) => b.lastAccessed - a.lastAccessed);
  }

  prune() {
    let pruned = 0;
    for (const [key, entry] of this._storage.entries()) {
      if (this._isExpired(entry)) {
        this._storage.delete(key);
        this._accessOrder = this._accessOrder.filter(k => k !== key);
        pruned++;
      }
    }
    return pruned;
  }

  setMaxSize(maxSize) {
    this._maxSize = maxSize;
    this._evictIfNeeded();
  }

  setMaxMemory(maxMemory) {
    this._maxMemory = maxMemory;
    this._evictIfNeeded();
  }

  setEvictionPolicy(policy) {
    const validPolicies = ['lru', 'ttl', 'size'];
    if (validPolicies.includes(policy)) {
      this._evictionPolicy = policy;
    }
  }

  setDefaultTtl(ttl) {
    this._defaultTtl = ttl;
  }

  calculateAdaptiveTtl(qualityScore, baseTtl = null) {
    const base = baseTtl || this._defaultTtl;
    
    if (qualityScore >= 0.9) {
      return base * 3;
    }
    if (qualityScore >= 0.8) {
      return base * 2;
    }
    if (qualityScore >= 0.7) {
      return base * 1.5;
    }
    if (qualityScore >= 0.5) {
      return base;
    }
    if (qualityScore >= 0.3) {
      return base * 0.5;
    }
    return base * 0.25;
  }

  setWithQuality(request, response, qualityScore, options = {}) {
    const adaptiveTtl = options.adaptiveTtl !== false;
    const ttl = adaptiveTtl 
      ? this.calculateAdaptiveTtl(qualityScore, options.ttl)
      : (options.ttl || this._defaultTtl);

    return this.set(request, response, {
      ...options,
      ttl,
      metadata: {
        ...options.metadata,
        qualityScore,
        qualityGrade: this._getGrade(qualityScore),
        adaptiveTtl,
        cachedAt: Date.now()
      }
    });
  }

  getWithQuality(request) {
    const result = this.get(request);
    if (!result) return null;

    return {
      ...result,
      qualityScore: result.metadata?.qualityScore,
      qualityGrade: result.metadata?.qualityGrade,
      isSuspicious: this._isSuspicious(result.metadata)
    };
  }

  _isSuspicious(metadata) {
    if (!metadata) return false;
    
    const hasLowQuality = metadata.qualityScore !== undefined && metadata.qualityScore < 0.5;
    const hasValidationFailed = metadata.validationFailed === true;
    
    return hasLowQuality || hasValidationFailed;
  }

  markAsVerified(key, verificationResult) {
    const entry = this._storage.get(key);
    if (entry) {
      entry.metadata = {
        ...entry.metadata,
        verified: true,
        verificationResult
      };
    }
  }

  markAsSuspicious(key, reason) {
    const entry = this._storage.get(key);
    if (entry) {
      entry.metadata = {
        ...entry.metadata,
        suspicious: true,
        suspiciousReason: reason
      };
    }
  }

  getHighQualityEntries(minScore = 0.8) {
    const entries = [];
    for (const [key, entry] of this._storage.entries()) {
      if (entry.metadata?.qualityScore >= minScore) {
        entries.push({
          key,
          qualityScore: entry.metadata.qualityScore,
          qualityGrade: entry.metadata.qualityGrade,
          age: Date.now() - entry.createdAt,
          ttl: entry.ttl,
          accessCount: entry.accessCount
        });
      }
    }
    return entries.sort((a, b) => b.qualityScore - a.qualityScore);
  }

  getLowQualityEntries(maxScore = 0.5) {
    const entries = [];
    for (const [key, entry] of this._storage.entries()) {
      if (entry.metadata?.qualityScore !== undefined && entry.metadata.qualityScore <= maxScore) {
        entries.push({
          key,
          qualityScore: entry.metadata.qualityScore,
          qualityGrade: entry.metadata.qualityGrade,
          suspicious: this._isSuspicious(entry.metadata),
          suspiciousReason: entry.metadata.suspiciousReason,
          age: Date.now() - entry.createdAt,
          ttl: entry.ttl
        });
      }
    }
    return entries.sort((a, b) => a.qualityScore - b.qualityScore);
  }

  _getGrade(score) {
    if (score >= 0.9) return 'A';
    if (score >= 0.8) return 'B';
    if (score >= 0.7) return 'C';
    if (score >= 0.5) return 'D';
    return 'F';
  }

  invalidateLowQuality(maxScore = 0.3) {
    let count = 0;
    for (const [key, entry] of this._storage.entries()) {
      if (entry.metadata?.qualityScore !== undefined && entry.metadata.qualityScore <= maxScore) {
        this._storage.delete(key);
        this._accessOrder = this._accessOrder.filter(k => k !== key);
        count++;
      }
    }
    return count;
  }

  getQualityStats() {
    const entries = Array.from(this._storage.values());
    const withQuality = entries.filter(e => e.metadata?.qualityScore !== undefined);
    
    if (withQuality.length === 0) {
      return {
        total: entries.length,
        withQualityScore: 0,
        avgQualityScore: null,
        gradeDistribution: {},
        suspiciousCount: 0
      };
    }

    const scores = withQuality.map(e => e.metadata.qualityScore);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    const gradeDist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    for (const entry of withQuality) {
      const grade = entry.metadata.qualityGrade || this._getGrade(entry.metadata.qualityScore);
      if (gradeDist[grade] !== undefined) {
        gradeDist[grade]++;
      }
    }

    let suspiciousCount = 0;
    for (const entry of withQuality) {
      if (this._isSuspicious(entry.metadata)) {
        suspiciousCount++;
      }
    }

    return {
      total: entries.length,
      withQualityScore: withQuality.length,
      avgQualityScore: Math.round(avgScore * 100) / 100,
      gradeDistribution: gradeDist,
      suspiciousCount,
      highQualityCount: withQuality.filter(e => e.metadata.qualityScore >= 0.8).length,
      lowQualityCount: withQuality.filter(e => e.metadata.qualityScore < 0.5).length
    };
  }
}

export class SmartRouter {
  constructor(options = {}) {
    this._providers = new Map();
    this._defaultProvider = options.defaultProvider || DEFAULT_PROVIDER;
    this._healthThreshold = options.healthThreshold || 0.3;
    this._weightDecay = options.weightDecay || 0.95;
  }

  registerProvider(name, config = {}) {
    this._providers.set(name, {
      name,
      config,
      metrics: new MetricsCollector({
        windowSize: 60000,
        maxMetrics: 5000
      }),
      weight: 1,
      lastUsed: 0,
      consecutiveFailures: 0,
      isHealthy: true
    });
  }

  recordSuccess(provider, latency) {
    const p = this._providers.get(provider);
    if (!p) return;
    
    p.metrics.recordRequest(true, latency, 200, 'success');
    p.consecutiveFailures = 0;
    p.weight = Math.min(2, p.weight * (1 / this._weightDecay));
  }

  recordFailure(provider, statusCode, latency) {
    const p = this._providers.get(provider);
    if (!p) return;
    
    const success = statusCode >= 200 && statusCode < 300;
    p.metrics.recordRequest(success, latency, statusCode, this._classifyError(statusCode));
    
    if (!success) {
      p.consecutiveFailures++;
      p.weight = Math.max(0.1, p.weight * this._weightDecay);
      
      if (p.consecutiveFailures >= 3) {
        p.isHealthy = false;
      }
    }
  }

  _classifyError(statusCode) {
    if (statusCode === 429) return 'rate_limit';
    if (statusCode >= 500) return 'server_error';
    if (statusCode === 401 || statusCode === 403) return 'auth';
    if (statusCode === 408) return 'timeout';
    return 'other';
  }

  selectProvider(request) {
    const available = Array.from(this._providers.entries())
      .filter(([name, p]) => {
        if (!p.isHealthy && p.consecutiveFailures >= 3) return false;
        return true;
      })
      .map(([name, p]) => ({
        name,
        health: p.metrics.getHealthScore(),
        weight: p.weight,
        lastUsed: p.lastUsed
      }));

    if (available.length === 0) {
      return this._defaultProvider;
    }

    const now = Date.now();
    const scored = available.map(p => ({
      ...p,
      score: p.health * p.weight * (p.lastUsed < now - 30000 ? 1.5 : 1)
    }));

    scored.sort((a, b) => b.score - a.score);
    
    const selected = scored[0].name;
    const provider = this._providers.get(selected);
    if (provider) {
      provider.lastUsed = now;
    }

    return selected;
  }

  getProviderHealth(provider) {
    const p = this._providers.get(provider);
    if (!p) return null;
    
    return {
      ...p.metrics.getStats(),
      weight: p.weight,
      isHealthy: p.isHealthy,
      consecutiveFailures: p.consecutiveFailures
    };
  }

  getAllProvidersHealth() {
    const result = {};
    for (const [name, p] of this._providers.entries()) {
      result[name] = {
        ...p.metrics.getStats(),
        weight: p.weight,
        isHealthy: p.isHealthy,
        consecutiveFailures: p.consecutiveFailures
      };
    }
    return result;
  }

  getStatus() {
    return {
      providers: Array.from(this._providers.keys()),
      defaultProvider: this._defaultProvider,
      healthThreshold: this._healthThreshold,
      allHealth: this.getAllProvidersHealth()
    };
  }
}

export class StreamHandler {
  constructor(options = {}) {
    this._bufferSize = options.bufferSize || 100;
    this._onChunk = options.onChunk || null;
    this._onComplete = options.onComplete || null;
    this._onError = options.onError || null;
  }

  async *parseStream(response, parser) {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let chunkCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          if (buffer.trim()) {
            yield this._parseLine(buffer, parser);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              continue;
            }
            
            chunkCount++;
            
            try {
              const parsed = JSON.parse(data);
              const result = parser.parse(parsed, 'stream');
              fullContent += result.content;
              
              if (this._onChunk) {
                this._onChunk({
                  content: result.content,
                  partial: true,
                  chunkNumber: chunkCount,
                  accumulated: fullContent
                });
              }
              
              yield result;
            } catch (e) {
            }
          }
        }
      }

      if (this._onComplete) {
        this._onComplete({
          fullContent,
          chunkCount
        });
      }

      yield {
        success: true,
        type: 'text',
        content: fullContent,
        partial: false,
        chunkCount
      };

    } finally {
      reader.releaseLock();
    }
  }

  _parseLine(line, parser) {
    try {
      const data = JSON.parse(line);
      return parser.parse(data, 'stream');
    } catch (e) {
      return {
        success: false,
        type: 'parse_error',
        content: line,
        partial: true
      };
    }
  }

  createStreamParser(provider) {
    return async (response) => {
      const chunks = [];
      
      for await (const chunk of this.parseStream(response, new ResponseParser())) {
        chunks.push(chunk);
        if (!chunk.partial) {
          break;
        }
      }
      
      return chunks[chunks.length - 1] || {
        success: false,
        type: 'no_content',
        content: ''
      };
    };
  }
}

export class SafetyWrapper {
  constructor(options = {}) {
    this._defaultTimeout = options.defaultTimeout || 30000;
    this._maxTimeout = options.maxTimeout || 300000;
    this._enableFallback = options.enableFallback !== false;
    this._errorHandlers = new Map();
    this._errorLog = [];
    this._maxErrorLogSize = options.maxErrorLogSize || 1000;
    this._circuitBreaker = new CircuitBreakerMonitor(options.circuitBreaker);
  }

  wrap(fn, options = {}) {
    const {
      timeout = this._defaultTimeout,
      fallback = null,
      onError = null,
      name = fn.name || 'anonymous'
    } = options;

    return async (...args) => {
      const startTime = Date.now();
      const wrappedName = `safety:${name}`;

      if (this._circuitBreaker.isOpen(wrappedName)) {
        if (this._enableFallback && fallback) {
          return this._executeFallback(fallback, args, 'circuit_open');
        }
        return this._errorResult(new Error('Circuit breaker open'), wrappedName, startTime);
      }

      const timeoutId = setTimeout(() => {
        this._circuitBreaker.recordTimeout(wrappedName);
      }, timeout);

      try {
        const result = await Promise.race([
          fn(...args),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
          )
        ]);

        clearTimeout(timeoutId);
        this._circuitBreaker.recordSuccess(wrappedName);
        
        if (onError) this._errorHandlers.set(name, onError);
        
        return result;
      } catch (error) {
        clearTimeout(timeoutId);
        
        this._circuitBreaker.recordFailure(wrappedName);
        this._logError(wrappedName, error, startTime);

        if (this._enableFallback && fallback) {
          return this._executeFallback(fallback, args, error.message);
        }

        return this._errorResult(error, wrappedName, startTime);
      }
    };
  }

  wrapSync(fn, options = {}) {
    const {
      fallback = null,
      onError = null,
      name = fn.name || 'anonymous'
    } = options;

    return (...args) => {
      const startTime = Date.now();
      const wrappedName = `safety:${name}`;

      try {
        if (this._circuitBreaker.isOpen(wrappedName)) {
          if (this._enableFallback && fallback) {
            return this._executeFallback(fallback, args, 'circuit_open');
          }
          return this._errorResult(new Error('Circuit breaker open'), wrappedName, startTime);
        }

        const result = fn(...args);
        this._circuitBreaker.recordSuccess(wrappedName);
        return result;
      } catch (error) {
        this._circuitBreaker.recordFailure(wrappedName);
        this._logError(wrappedName, error, startTime);

        if (this._enableFallback && fallback) {
          return this._executeFallback(fallback, args, error.message);
        }

        return this._errorResult(error, wrappedName, startTime);
      }
    };
  }

  wrapGenerator(fn, options = {}) {
    const {
      timeout = this._defaultTimeout,
      fallback = null,
      onError = null,
      name = fn.name || 'anonymous'
    } = options;

    return async function* (...args) {
      const startTime = Date.now();
      const wrappedName = `safety:gen:${name}`;

      if (this._circuitBreaker.isOpen(wrappedName)) {
        if (this._enableFallback && fallback) {
          yield* fallback(...args);
          return;
        }
        yield this._errorResult(new Error('Circuit breaker open'), wrappedName, startTime);
        return;
      }

      try {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
        });

        const generator = fn(...args);
        let iterationNumber = 0;
        const maxIterations = options.maxIterations || 10000;

        while (iterationNumber < maxIterations) {
          const result = await Promise.race([
            generator.next(),
            timeoutPromise
          ]);

          clearTimeout(timeoutId);

          if (result.done) {
            this._circuitBreaker.recordSuccess(wrappedName);
            return;
          }

          yield result.value;
          iterationNumber++;

          timeoutId = setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
        }

        this._circuitBreaker.recordFailure(wrappedName);
        yield this._errorResult(new Error('Max iterations exceeded'), wrappedName, startTime);
      } catch (error) {
        this._circuitBreaker.recordFailure(wrappedName);
        this._logError(wrappedName, error, startTime);

        if (this._enableFallback && fallback) {
          yield* fallback(...args);
          return;
        }

        yield this._errorResult(error, wrappedName, startTime);
      }
    }.bind(this);
  }

  _executeFallback(fallback, args, reason) {
    try {
      if (typeof fallback === 'function') {
        return fallback(...args);
      }
      return fallback;
    } catch (e) {
      return this._errorResult(e, 'fallback', Date.now());
    }
  }

  _errorResult(error, name, startTime) {
    return {
      __safety_error: true,
      success: false,
      error: error.message,
      errorName: error.name,
      errorStack: error.stack,
      operation: name,
      duration: Date.now() - startTime,
      timestamp: Date.now()
    };
  }

  _logError(name, error, startTime) {
    const entry = {
      name,
      error: error.message,
      errorName: error.name,
      stack: error.stack,
      duration: Date.now() - startTime,
      timestamp: Date.now()
    };

    this._errorLog.push(entry);

    if (this._errorLog.length > this._maxErrorLogSize) {
      this._errorLog.shift();
    }
  }

  getErrorLog(limit = 100) {
    return this._errorLog.slice(-limit);
  }

  clearErrorLog() {
    this._errorLog = [];
  }

  getCircuitBreakerStatus(name = null) {
    if (name) {
      return this._circuitBreaker.getStatus(name);
    }
    return this._circuitBreaker.getAllStatuses();
  }

  resetCircuitBreaker(name = null) {
    if (name) {
      this._circuitBreaker.reset(name);
    } else {
      this._circuitBreaker.resetAll();
    }
  }

  createTimeout(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
    });
  }

  raceWithTimeout(promise, ms) {
    return Promise.race([
      promise,
      this.createTimeout(ms)
    ]);
  }

  withTimeout(fn, ms = null) {
    return this.wrap(fn, { timeout: ms || this._defaultTimeout });
  }
}

class CircuitBreakerMonitor {
  constructor(options = {}) {
    this._failureThreshold = options.failureThreshold || 5;
    this._successThreshold = options.successThreshold || 2;
    this._openTimeout = options.openTimeout || 30000;
    
    this._states = new Map();
  }

  isOpen(name) {
    const state = this._states.get(name);
    if (!state) return false;

    if (state.status === 'open') {
      if (Date.now() - state.openedAt > this._openTimeout) {
        state.status = 'half_open';
        return false;
      }
      return true;
    }

    return false;
  }

  recordSuccess(name) {
    const state = this._states.get(name);
    if (!state) {
      this._states.set(name, { failures: 0, successes: 1, status: 'closed', openedAt: null });
      return;
    }

    state.successes++;
    state.failures = 0;

    if (state.status === 'half_open' && state.successes >= this._successThreshold) {
      state.status = 'closed';
      state.successes = 0;
    }
  }

  recordFailure(name) {
    const state = this._states.get(name);
    if (!state) {
      this._states.set(name, { failures: 1, successes: 0, status: 'closed', openedAt: null });
      return;
    }

    state.failures++;

    if (state.failures >= this._failureThreshold) {
      state.status = 'open';
      state.openedAt = Date.now();
    }
  }

  recordTimeout(name) {
    this.recordFailure(name);
  }

  reset(name) {
    this._states.delete(name);
  }

  resetAll() {
    this._states.clear();
  }

  getStatus(name) {
    return this._states.get(name) || { status: 'unknown' };
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
    
    console.log(`[Limiter] Decreased: concurrent=${this._currentConcurrent}, interval=${this._currentInterval}ms`);
  }

  _increase() {
    if (this._currentConcurrent < this._maxConcurrent) {
      this._currentConcurrent = Math.min(this._maxConcurrent, Math.floor(this._currentConcurrent * 1.2));
    }
    
    if (this._currentInterval > this._minInterval) {
      this._currentInterval = Math.max(this._minInterval, Math.floor(this._currentInterval * 0.8));
    }
    
    console.log(`[Limiter] Increased: concurrent=${this._currentConcurrent}, interval=${this._currentInterval}ms`);
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
        console.log('[ICBreaker] Recovered - CLOSED');
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
      console.log('[ICBreaker] Probe failed - OPEN');
      return;
    }
    
    const effectiveFailures = this._failureCount + this._slowCount;
    
    if (effectiveFailures >= this._failureThreshold || this._consecutive5xx >= 3) {
      this._state = 'OPEN';
      this._openedAt = Date.now();
      console.log(`[ICBreaker] Opened after ${effectiveFailures} effective failures (5xx: ${this._consecutive5xx})`);
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
        console.log('[ICBreaker] Half-Open - probing...');
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
        console.log('[CircuitBreaker] Recovered - CLOSED');
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
      console.log('[CircuitBreaker] Probe failed - OPEN');
      return;
    }
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
      console.log(`[CircuitBreaker] Opened after ${this.failureCount} failures`);
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
        console.log('[CircuitBreaker] Half-Open - probing...');
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

export class AgentSession {
  constructor(agentId, config = {}) {
    const currentProvider = persistentConfig.getPreference('currentProvider');
    this.agentId = agentId;
    this.config = {
      name: config.name || `agent-${agentId.substring(0, 8)}`,
      provider: config.provider || currentProvider || DEFAULT_PROVIDER,
      model: config.model || persistentConfig.getPreference('currentModel') || null,
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
      timestamp: Date.now()
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
      return response;
    } catch (error) {
      this.state = AGENT_STATES.ERROR;
      this.error = error.message;
      throw error;
    }
  }

  async queryModel(messages) {
    const request = { model: this.config.model, messageCount: messages.length };
    let providerName = this._router.selectProvider(request);
    let apiKey = persistentConfig.getApiKey(providerName);
    let model = this.config.model;

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
        response = await fetch(`${providerConfig.baseUrl}${providerConfig.chatEndpoint}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: model,
            messages: filteredMessages,
            temperature: 0.7,
            max_tokens: 2000
          }),
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
    this.stopWatchdog();
    
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
