/**
 * 结构化输出验证器
 * 验证 LLM 输出是否符合预期 JSON Schema
 */
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

  // NOTE: These methods reference cache methods (this.has, this.set, etc.)
  // but StructuredOutputValidator is not a cache. These are stubs to prevent
  // crashes if called, since they are never invoked from outside.
  predictAndWarm(requests, fetchFn, options = {}) {
    return { warmed: [], failed: [], total: requests.length };
  }

  _analyzeRequestPatterns(requests) {
    const frequency = new Map();
    for (const req of requests) {
      const key = this._hashRequest ? this._hashRequest(req) : String(req);
      frequency.set(key, (frequency.get(key) || 0) + 1);
    }
    return Array.from(frequency.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);
  }

  warmWithTTL(targetTtl = 0.8) {
    return { entries: 0, entriesDetail: [] };
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
    return { optimized: false, reason: 'StructuredOutputValidator is not a cache' };
  }

  getHitRateTrend(windowMs = 300000) {
    return { hitRate: 0, hits: 0, misses: 0, windowMs, estimate: 0 };
  }
}

export default StructuredOutputValidator;

