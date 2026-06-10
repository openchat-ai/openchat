import { validateToolCall, rescueToolCall } from './lib/rescue-utils.mjs';

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

export async function run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('tool-rescue.run: op required');

  switch (op) {
    case 'validate':
      return { outputs: validateToolCall(args.toolName, args.args, args.toolSchema) };
    case 'rescue':
      return { outputs: rescueToolCall(args.toolName, args.args, args.toolSchema) };
    case 'validate_and_execute': {
      if (!args.executor) throw new Error('executor function required');
      const check = rescueToolCall(args.toolName, args.args, args.toolSchema);
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

import { create } from './lib/report.mjs';

const { ok, ng, report } = create();
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

  const r1 = validateToolCall('read_file', { path: 'test.txt' }, [schema]);
  ok(r1.valid, 'validate: valid call passes');

  const r2 = rescueToolCall('read_file', { path: 42 }, [schema]);
  ok(r2.valid && r2.fixed && r2.fixedArgs.path === '42', 'rescue: number→string coerced');

  const r3 = rescueToolCall('read_file', {}, [schema]);
  ok(!r3.valid && r3.errors.length > 0, 'rescue: missing required param detected');

  const r4 = rescueToolCall('read_file', { path: 'x', unknown: 'y' }, [schema]);
  ok(r4.valid && !r4.fixedArgs.unknown, 'rescue: unknown param removed');

  report(NAME);
}

export { test };
