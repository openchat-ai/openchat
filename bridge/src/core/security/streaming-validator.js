/**
 * 流式验证器
 * 在流式传输过程中验证 JSON 结构
 */
import { StructuredOutputValidator } from './structured-output-validator.js';

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
    this._validator = new StructuredOutputValidator({ strictMode: true });
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
  }

  feed(chunk) {
    if (this._aborted || this._complete) return;

    this._buffer += chunk;
    this._tokenCount++;

    this._validateBuffer();

    if (this._onProgress) {
      this._onProgress({
        tokenCount: this._tokenCount,
        bufferSize: this._buffer.length,
        errors: this._errors.length,
        warnings: this._warnings.length
      });
    }

    if (this._earlyStop && this._errors.length >= this._maxErrors) {
      this._aborted = true;
      if (this._onError) {
        this._onError({
          message: 'Max errors reached, validation aborted',
          errorCount: this._errors.length
        });
      }
    }
  }

  _validateBuffer() {
    for (let i = 0; i < this._buffer.length; i++) {
      const char = this._buffer[i];

      if (this._escape) {
        this._escape = false;
        continue;
      }

      if (char === '\\' && this._inString) {
        this._escape = true;
        continue;
      }

      if (char === '"') {
        this._inString = !this._inString;
        continue;
      }

      if (this._inString) continue;

      if (char === '{' || char === '[') {
        this._depth++;
      } else if (char === '}' || char === ']') {
        this._depth--;
        if (this._depth < 0) {
          this._errors.push({
            path: this._currentPath,
            message: 'Unmatched closing bracket',
            position: i
          });
          this._depth = 0;
        }
      }
    }

    if (this._schema && this._buffer.length > 100 && this._depth === 0) {
      try {
        const parsed = JSON.parse(this._buffer);
        const result = this._validator.validate(parsed, this._schema);
        if (!result.valid) {
          this._errors.push(...result.errors);
        }
        this._warnings.push(...(result.warnings || []));
      } catch (e) {
        // Buffer not complete yet
      }
    }
  }

  finalize() {
    this._complete = true;

    if (this._depth !== 0) {
      this._errors.push({
        path: 'root',
        message: 'Incomplete JSON structure',
        depth: this._depth
      });
    }

    if (this._buffer.length > 0) {
      try {
        const parsed = JSON.parse(this._buffer);
        if (this._schema) {
          const result = this._validator.validate(parsed, this._schema);
          return {
            valid: result.valid && this._errors.length === 0,
            data: parsed,
            errors: [...this._errors, ...(result.errors || [])],
            warnings: this._warnings,
            tokenCount: this._tokenCount
          };
        }
        return {
          valid: this._errors.length === 0,
          data: parsed,
          errors: this._errors,
          warnings: this._warnings,
          tokenCount: this._tokenCount
        };
      } catch (e) {
        this._errors.push({
          path: 'root',
          message: `JSON parse error: ${e.message}`
        });
        return {
          valid: false,
          data: null,
          errors: this._errors,
          warnings: this._warnings,
          tokenCount: this._tokenCount
        };
      }
    }

    return {
      valid: this._errors.length === 0,
      data: null,
      errors: this._errors,
      warnings: this._warnings,
      tokenCount: this._tokenCount
    };
  }

  abort() {
    this._aborted = true;
    return {
      valid: false,
      aborted: true,
      errors: this._errors,
      warnings: this._warnings,
      tokenCount: this._tokenCount
    };
  }

  getProgress() {
    return {
      tokenCount: this._tokenCount,
      bufferSize: this._buffer.length,
      depth: this._depth,
      errorCount: this._errors.length,
      warningCount: this._warnings.length,
      complete: this._complete,
      aborted: this._aborted
    };
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
        details: []
      };
    }

    const explanations = [];

    for (const error of validationResult.errors || []) {
      const explanation = this._explainError(error, schema, context);
      explanations.push(explanation);
    }

    return {
      valid: false,
      message: `Validation failed with ${explanations.length} error(s)`,
      details: explanations,
      summary: this._generateSummary(explanations)
    };
  }

  _explainError(error, schema, context) {
    const baseExplanation = {
      path: error.path || 'unknown',
      message: error.message || 'Unknown error',
      expected: error.expected || null,
      received: error.received || null
    };

    const typeSpecific = this._getTypeSpecificExplanation(error, schema);
    const suggestions = this._generateSuggestions(error, schema, context);

    return {
      ...baseExplanation,
      type: typeSpecific.type,
      severity: typeSpecific.severity,
      description: typeSpecific.description,
      suggestions,
      code: this._includeCode ? this._generateExampleCode(error, schema) : undefined,
      example: this._includeExamples ? this._generateExampleFix(error, schema) : undefined
    };
  }

  _getTypeSpecificExplanation(error, schema) {
    const errorType = error.message?.toLowerCase() || '';

    if (errorType.includes('type')) {
      return {
        type: 'TYPE_MISMATCH',
        severity: 'error',
        description: `Expected type '${error.expected}' but received '${error.received}'`
      };
    }

    if (errorType.includes('required')) {
      return {
        type: 'MISSING_REQUIRED',
        severity: 'error',
        description: `Required field '${error.path}' is missing`
      };
    }

    if (errorType.includes('enum')) {
      return {
        type: 'ENUM_VIOLATION',
        severity: 'error',
        description: `Value must be one of the allowed values: ${error.expected?.join(', ')}`
      };
    }

    if (errorType.includes('pattern')) {
      return {
        type: 'PATTERN_MISMATCH',
        severity: 'warning',
        description: `Value does not match the required pattern: ${error.expected}`
      };
    }

    if (errorType.includes('minimum') || errorType.includes('maximum')) {
      return {
        type: 'RANGE_VIOLATION',
        severity: 'error',
        description: `Value ${error.received} is outside the allowed range`
      };
    }

    if (errorType.includes('minlength') || errorType.includes('maxlength')) {
      return {
        type: 'LENGTH_VIOLATION',
        severity: 'warning',
        description: `String length is outside the allowed range`
      };
    }

    return {
      type: 'UNKNOWN',
      severity: 'error',
      description: error.message || 'Unknown validation error'
    };
  }

  _generateSuggestions(error, schema, context) {
    const suggestions = [];

    if (error.expected) {
      suggestions.push(`Ensure the value is of type '${error.expected}'`);
    }

    if (error.message?.includes('required')) {
      suggestions.push(`Add the missing field '${error.path}' to your data`);
    }

    if (error.message?.includes('enum')) {
      suggestions.push(`Use one of the allowed values: ${error.expected?.join(', ')}`);
    }

    const pathParts = error.path?.split('.') || [];
    if (pathParts.length > 1) {
      suggestions.push(`Check the nested structure at '${pathParts.slice(0, -1).join('.')}'`);
    }

    return suggestions;
  }

  _generateExampleCode(error, schema) {
    const path = error.path || 'field';
    const expectedType = error.expected || 'string';

    const examples = {
      string: `"${path}": "example value"`,
      number: `"${path}": 42`,
      integer: `"${path}": 42`,
      boolean: `"${path}": true`,
      array: `"${path}": []`,
      object: `"${path}": {}`
    };

    return examples[expectedType] || `"${path}": null`;
  }

  _generateExampleFix(error, schema) {
    if (!error.path) return null;

    const parts = error.path.split('.');
    const example = {};

    let current = example;
    for (let i = 0; i < parts.length - 1; i++) {
      current[parts[i]] = {};
      current = current[parts[i]];
    }

    const lastKey = parts[parts.length - 1];
    switch (error.expected) {
      case 'string':
        current[lastKey] = 'example';
        break;
      case 'number':
      case 'integer':
        current[lastKey] = 42;
        break;
      case 'boolean':
        current[lastKey] = true;
        break;
      case 'array':
        current[lastKey] = [];
        break;
      case 'object':
        current[lastKey] = {};
        break;
      default:
        current[lastKey] = null;
    }

    return example;
  }

  _generateSummary(explanations) {
    const byType = {};
    for (const exp of explanations) {
      const type = exp.type || 'UNKNOWN';
      byType[type] = (byType[type] || 0) + 1;
    }

    const summary = Object.entries(byType)
      .map(([type, count]) => `${count} ${type.toLowerCase().replace(/_/g, ' ')} error(s)`)
      .join(', ');

    const estimatedFixTime = this._estimateFixTime(explanations);
    return {
      errorTypes: byType,
      description: summary,
      estimatedFixTime
    };
  }

  _estimateFixTime(explanations) {
    const count = explanations.length;
    const avgFixTime = 2; // minutes per error

    const minutes = count * avgFixTime;

    if (minutes < 1) return 'less than 1 minute';
    if (minutes < 5) return '~1 minute';
    if (minutes < 15) return '~5 minutes';
    if (minutes < 30) return '~10-15 minutes';
    return `~${Math.ceil(minutes / 5) * 5} minutes`;
  }
}

export default StreamingValidator;
