// Experiment: tool-rescue — LLM Tool Call 参数自动修复
// Manifest id: tool-rescue
// 当 LLM 返回的工具调用参数类型/格式不对时，自动校验+修复+引导重试

export const META = {
  id: 'tool-rescue',
  name: 'Tool Call Rescue — 参数校验+自动修复+引导',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'validate | rescue | validate_and_execute' },
    { name: 'toolName', type: 'string', required: false },
    { name: 'args', type: 'object', required: false, description: 'LLM 返回的原始参数' },
    { name: 'toolSchema', type: 'object', required: false, description: 'OpenAI function-calling schema { function: { name, parameters } }' },
    { name: 'executor', type: 'function', required: false, description: 'async (name, args) => result （仅 validate_and_execute）' },
  ],
  outputs: [
    { name: 'valid', type: 'boolean' },
    { name: 'fixed', type: 'boolean' },
    { name: 'fixedArgs', type: 'object' },
    { name: 'errors', type: 'array' },
    { name: 'guidance', type: 'string' },
  ],
  deps: [],
  tags: ['guardrails', 'tool-call', 'validation', 'rescue'],
};

// 类型宽松匹配表
const COERCE_MAP = {
  string: { number: v => String(v), boolean: v => String(v) },
  number: { string: v => { const n = Number(v); return isNaN(n) ? null : n; }, boolean: v => v ? 1 : 0 },
  boolean: { string: v => v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : null, number: v => v !== 0 },
};

function coerce(value, targetType) {
  const actualType = typeof value;
  if (actualType === targetType) return { ok: true, value };
  const coercion = COERCE_MAP[targetType]?.[actualType];
  if (!coercion) return { ok: false, error: `expected ${targetType}, got ${actualType} (${JSON.stringify(value)})` };
  const coerced = coercion(value);
  if (coerced === null) return { ok: false, error: `cannot coerce ${actualType} to ${targetType}: ${JSON.stringify(value)}` };
  return { ok: true, value: coerced };
}

export async function run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('tool-rescue.run: op required');

  switch (op) {
    case 'validate':
      return { outputs: _validate(args.toolName, args.args, args.toolSchema) };

    case 'rescue':
      return { outputs: _rescue(args.toolName, args.args, args.toolSchema) };

    case 'validate_and_execute': {
      if (!args.executor) throw new Error('executor function required');
      const check = _rescue(args.toolName, args.args, args.toolSchema);
      if (!check.valid) return { outputs: { ...check, executed: false } };
      try {
        const result = await args.executor(args.toolName, check.fixedArgs);
        return { outputs: { ...check, executed: true, result } };
      } catch (e) {
        return { outputs: { ...check, executed: true, error: e.message, guidance: `工具 ${args.toolName} 执行失败: ${e.message}` } };
      }
    }

    default:
      throw new Error(`tool-rescue.run: unknown op "${op}"`);
  }
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

function _validate(toolName, args, toolSchema) {
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
    if (!prop) {
      errors.push(`未知参数 "${key}"`);
      continue;
    }
    if (prop.type && prop.type !== 'object' && prop.type !== 'array') {
      const check = coerce(value, prop.type);
      if (!check.ok) errors.push(`参数 "${key}": ${check.error}`);
    }
  }

  return { valid: errors.length === 0, fixed: false, fixedArgs: args, errors, guidance: errors.length > 0 ? `工具调用参数有 ${errors.length} 个问题：${errors.join('；')}` : '' };
}

function _rescue(toolName, rawArgs, toolSchema) {
  const schema = _getSchema(toolSchema, toolName);
  if (!schema) return { valid: false, fixed: false, fixedArgs: rawArgs, errors: [`tool ${toolName} not found`], guidance: `未找到工具 ${toolName} 的定义` };

  const params = schema.parameters || {};
  const props = params.properties || {};
  const required = params.required || [];
  const errors = [];
  const fixedArgs = { ...rawArgs };
  let fixed = false;

  // 补必要参数（尝试给默认值）
  for (const key of required) {
    if (fixedArgs[key] === undefined || fixedArgs[key] === null) {
      const prop = props[key];
      if (prop && prop.type === 'string' && prop.default !== undefined) {
        fixedArgs[key] = prop.default;
        fixed = true;
      } else if (prop && prop.type === 'number' && prop.default !== undefined) {
        fixedArgs[key] = prop.default;
        fixed = true;
      } else {
        errors.push(`缺少必要参数 "${key}"，无法自动修复`);
      }
    }
  }

  // 类型修复
  for (const [key, value] of Object.entries(fixedArgs)) {
    const prop = props[key];
    if (!prop) continue;
    if (prop.type && prop.type !== 'object' && prop.type !== 'array') {
      const check = coerce(value, prop.type);
      if (check.ok && check.value !== value) {
        fixedArgs[key] = check.value;
        fixed = true;
      } else if (!check.ok) {
        errors.push(`参数 "${key}" 类型错误: ${check.error}`);
      }
    }
  }

  // 删多余参数
  for (const key of Object.keys(fixedArgs)) {
    if (!props[key]) {
      delete fixedArgs[key];
      fixed = true;
    }
  }

  const valid = errors.length === 0;
  const guidance = valid
    ? (fixed ? `参数 ${toolName} 已自动修复类型/填充默认值，重试即可` : '')
    : `工具 ${toolName} 调用有 ${errors.length} 个无法自动修复的问题：${errors.join('；')}。请修正后重试`;

  return { valid, fixed, fixedArgs, errors, guidance };
}

import { create } from './lib/report.mjs';

const { ok, ng, skip, report } = create();
const NAME = 'Tool Call Rescue';

async function test() {
  const schema = {
    function: {
      name: 'read_file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  };

  // 正常调用
  const r1 = _validate('read_file', { path: 'test.txt' }, [schema]);
  if (r1.valid) ok('validate: valid call passes');
  else ng(`validate valid call failed: ${JSON.stringify(r1)}`);

  // 类型错误
  const r2 = _rescue('read_file', { path: 42 }, [schema]);
  if (r2.valid && r2.fixed && r2.fixedArgs.path === '42') ok('rescue: number→string coerced');
  else ng(`rescue type coerce failed: ${JSON.stringify(r2)}`);

  // 缺必要参数
  const r3 = _rescue('read_file', {}, [schema]);
  if (!r3.valid && r3.errors.length > 0) ok('rescue: missing required param detected');
  else ng(`rescue missing param failed: ${JSON.stringify(r3)}`);

  // 未知参数清理
  const r4 = _rescue('read_file', { path: 'x', unknown: 'y' }, [schema]);
  if (r4.valid && !r4.fixedArgs.unknown) ok('rescue: unknown param removed');
  else ng(`rescue unknown param failed: ${JSON.stringify(r4)}`);

  report(NAME);
}

export { test };
