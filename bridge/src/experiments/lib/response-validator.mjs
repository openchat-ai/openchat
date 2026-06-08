// ResponseValidator — 响应级工具调用批量校验
// 校验 LLM 响应中的所有 tool_calls 是否符合 schema
// === invariants ===
// - 不修改 content，只校验 tool_calls 数组
// - 未知 tool name 算 fatal 错误，不自动跳过
// - 返回 errors 数组，不 throw

export function validateResponse(response, schemas) {
  const errors = [];
  if (!response || !response.toolCalls || !Array.isArray(response.toolCalls)) {
    return { valid: true, errors: [], toolCalls: [] };
  }

  const validCalls = [];
  for (const tc of response.toolCalls) {
    const name = tc.function?.name || tc.name;
    const rawArgs = tc.function?.arguments || tc.arguments || '{}';
    const schema = _findSchema(schemas, name);

    if (!schema) {
      errors.push({ tool: name, error: `未注册的工具 "${name}"，可用工具: ${schemas.map(s => s.function?.name || s.name).join(', ')}` });
      continue;
    }

    let args;
    try {
      args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
    } catch {
      errors.push({ tool: name, error: `参数不是合法 JSON: ${String(rawArgs).slice(0, 80)}` });
      continue;
    }

    const paramErrors = _validateArgs(args, schema);
    if (paramErrors.length > 0) {
      errors.push({ tool: name, error: `参数校验失败: ${paramErrors.join('; ')}`, args });
    }

    validCalls.push({ name, args, id: tc.id });
  }

  return { valid: errors.length === 0, errors, toolCalls: validCalls };
}

function _findSchema(schemas, name) {
  for (const s of schemas || []) {
    const fn = s.function || s;
    if (fn.name === name) return fn;
  }
  return null;
}

function _validateArgs(args, schema) {
  const errors = [];
  const params = schema.parameters || {};
  const props = params.properties || {};
  const required = params.required || [];

  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      errors.push(`缺少必要参数 "${key}"`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const prop = props[key];
    if (!prop && key !== '$schema') {
      errors.push(`未知参数 "${key}"`);
      continue;
    }
    if (prop?.type && typeof value !== prop.type && prop.type !== 'object' && prop.type !== 'array') {
      errors.push(`参数 "${key}" 应为 ${prop.type}，实际为 ${typeof value}`);
    }
  }

  return errors;
}
