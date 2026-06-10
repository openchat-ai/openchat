const COERCE_MAP = {
  string: { number: v => String(v), boolean: v => String(v) },
  number: { string: v => { const n = Number(v); return isNaN(n) ? null : n; }, boolean: v => v ? 1 : 0 },
  boolean: { string: v => v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : null, number: v => v !== 0 },
};

export function coerce(value, targetType) {
  const actualType = typeof value;
  if (actualType === targetType) return { ok: true, value };
  const coercion = COERCE_MAP[targetType]?.[actualType];
  if (!coercion) return { ok: false, error: `expected ${targetType}, got ${actualType} (${JSON.stringify(value)})` };
  const coerced = coercion(value);
  if (coerced === null) return { ok: false, error: `cannot coerce ${actualType} to ${targetType}: ${JSON.stringify(value)}` };
  return { ok: true, value: coerced };
}

function _getSchema(schemas, name) {
  if (!schemas) return null;
  const arr = Array.isArray(schemas) ? schemas : [schemas];
  for (const s of arr) {
    const fn = s.function || s;
    if (fn.name === name) return fn;
  }
  return null;
}

export function validateToolCall(toolName, args, toolSchema) {
  const schema = _getSchema(toolSchema, toolName);
  if (!schema) return { valid: false, fixed: false, fixedArgs: args, errors: [`tool ${toolName} not found in schema`], guidance: `未找到工具 ${toolName} 的定义，请检查工具名是否正确` };

  const params = schema.parameters || {};
  const props = params.properties || {};
  const required = params.required || [];
  const errors = [];

  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      errors.push(`缺少必要参数 "${key}"`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const prop = props[key];
    if (!prop) { errors.push(`未知参数 "${key}"`); continue; }
    if (prop.type && prop.type !== 'object' && prop.type !== 'array') {
      const check = coerce(value, prop.type);
      if (!check.ok) errors.push(`参数 "${key}": ${check.error}`);
    }
  }
  return { valid: errors.length === 0, fixed: false, fixedArgs: args, errors, guidance: errors.length > 0 ? `工具调用参数有 ${errors.length} 个问题：${errors.join('；')}` : '' };
}

export function rescueToolCall(toolName, rawArgs, toolSchema) {
  const schema = _getSchema(toolSchema, toolName);
  if (!schema) return { valid: false, fixed: false, fixedArgs: rawArgs, errors: [`tool ${toolName} not found`], guidance: `未找到工具 ${toolName} 的定义` };

  const params = schema.parameters || {};
  const props = params.properties || {};
  const required = params.required || [];
  const errors = [];
  const fixedArgs = { ...rawArgs };
  let fixed = false;

  for (const key of required) {
    if (fixedArgs[key] === undefined || fixedArgs[key] === null) {
      const prop = props[key];
      if (prop && prop.type === 'string' && prop.default !== undefined) { fixedArgs[key] = prop.default; fixed = true; }
      else if (prop && prop.type === 'number' && prop.default !== undefined) { fixedArgs[key] = prop.default; fixed = true; }
      else { errors.push(`缺少必要参数 "${key}"，无法自动修复`); }
    }
  }
  for (const [key, value] of Object.entries(fixedArgs)) {
    const prop = props[key];
    if (!prop) continue;
    if (prop.type && prop.type !== 'object' && prop.type !== 'array') {
      const check = coerce(value, prop.type);
      if (!check.ok) { errors.push(`参数 "${key}": ${check.error}`); }
      else if (check.value !== value) { fixedArgs[key] = check.value; fixed = true; }
    }
  }
  return { valid: errors.length === 0, fixed, fixedArgs, errors, guidance: errors.length > 0 ? `工具调用参数有 ${errors.length} 个问题：${errors.join('；')}` : '' };
}
