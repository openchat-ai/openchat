// Experiment: retry-guidance — 工具调用失败的结构化引导重试
// Manifest id: retry-guidance
// 当工具调用失败时，生成结构化引导信息给 LLM，提高重试成功率

export const META = {
  id: 'retry-guidance',
  name: 'Retry Guidance — 工具调用失败的结构化引导',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'guidance | execute_with_retry' },
    { name: 'toolName', type: 'string', required: false },
    { name: 'args', type: 'object', required: false },
    { name: 'error', type: 'string', required: false, description: '原始错误信息' },
    { name: 'attempts', type: 'number', required: false, default: 1 },
    { name: 'maxRetries', type: 'number', required: false, default: 3 },
    { name: 'executor', type: 'function', required: false, description: 'async (name, args) => result' },
    { name: 'toolSchema', type: 'object', required: false, description: '用于参数校验' },
  ],
  outputs: [
    { name: 'guidance', type: 'string' },
    { name: 'success', type: 'boolean' },
    { name: 'result', type: 'any' },
    { name: 'attempts', type: 'number' },
  ],
  deps: ['tool-rescue'],
  tags: ['guardrails', 'retry', 'guidance'],
};

// 错误分类 → 引导模板
const GUIDANCE_TEMPLATES = [
  { pattern: /timeout/i, template: '工具 {tool} 调用超时。这可能是因为网络延迟或服务负载高。请重试，或简化查询减少处理时间。' },
  { pattern: /rate\s*limit|too\s*many|429/i, template: 'API 频率限制触发。请等待几秒后重试，或减少并发请求数。' },
  { pattern: /auth|unauthorized|401|403|api.?key/i, template: '认证失败。请检查 API 密钥配置是否正确（~/.openchat/config.json 中的 apiKey）。' },
  { pattern: /not\s*found|404|enoent/i, template: '资源未找到。请检查路径/标识符是否正确。文件/目录可能已被移动或删除。' },
  { pattern: /traversal|denied|blocked/i, template: '操作被安全策略阻止。路径穿越/私网地址操作不被允许，请在允许的范围内操作。' },
  { pattern: /invalid|bad\s*request|400/i, template: '请求参数无效。请检查参数格式和类型是否正确。参考工具定义中的参数描述。' },
  { pattern: /server\s*error|5\d{2}|internal/i, template: '服务端错误。这不是你的问题，重试可能成功。' },
];

export async function run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('retry-guidance.run: op required');

  switch (op) {
    case 'guidance':
      return { outputs: { guidance: _buildGuidance(args.toolName, args.error, args.attempts || 1) } };

    case 'execute_with_retry': {
      if (!args.executor) throw new Error('executor function required');
      const { run: rescueRun } = await import('./tool-rescue.mjs');
      const maxRetries = args.maxRetries || 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // 1. Rescue: 先校验+修复参数
        let callArgs = args.args;
        if (args.toolSchema) {
          const rescued = await rescueRun({ inputs: { op: 'rescue', toolName: args.toolName, args: callArgs, toolSchema: args.toolSchema } });
          if (!rescued.outputs.valid) {
            return { outputs: { success: false, result: null, attempts: attempt, guidance: rescued.outputs.guidance } };
          }
          if (rescued.outputs.fixed) callArgs = rescued.outputs.fixedArgs;
        }

        // 2. 执行
        try {
          const result = await args.executor(args.toolName, callArgs);
          return { outputs: { success: true, result, attempts: attempt, guidance: '' } };
        } catch (e) {
          if (attempt >= maxRetries) {
            const msg = _buildGuidance(args.toolName, e.message, attempt);
            return { outputs: { success: false, result: null, attempts: attempt, guidance: msg } };
          }
        }
      }
    }

    default:
      throw new Error(`retry-guidance.run: unknown op "${op}"`);
  }
}

function _buildGuidance(toolName, error, attempt) {
  if (!error) return '';

  for (const t of GUIDANCE_TEMPLATES) {
    if (t.pattern.test(error)) {
      const msg = t.template.replace(/\{tool\}/g, toolName);
      return attempt > 1 ? `${msg} (第 ${attempt} 次重试)` : msg;
    }
  }

  return `工具 ${toolName} 调用失败: ${error.slice(0, 200)}。请检查输入后重试${attempt > 1 ? ` (第 ${attempt} 次)` : ''}。`;
}

import { create } from './lib/report.mjs';

const { ok, ng, skip, report } = create();
const NAME = 'Retry Guidance';

async function test() {
  // guidance 分类
  const g1 = _buildGuidance('web_fetch', 'timeout after 10s', 1);
  if (g1.includes('超时')) ok('guidance: timeout classified');
  else ng(`guidance timeout failed: ${g1}`);

  const g2 = _buildGuidance('read_file', 'ENOENT: file not found', 2);
  if (g2.includes('未找到')) ok('guidance: not found classified');
  else ng(`guidance not found failed: ${g2}`);

  const g3 = _buildGuidance('edit_file', 'Path traversal denied', 1);
  if (g3.includes('安全策略')) ok('guidance: traversal blocked');
  else ng(`guidance traversal failed: ${g3}`);

  // 未知错误 fallback
  const g4 = _buildGuidance('some_tool', 'something weird happened', 1);
  if (g4.includes('失败')) ok('guidance: fallback for unknown error');
  else ng(`guidance fallback failed: ${g4}`);

  report(NAME);
}

export { test };
