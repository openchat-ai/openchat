// Experiment: step-workflow — 工作流定义 + 必要步骤强制执行
// Manifest id: step-workflow
// 定义由 experiment run() 步骤组成的工作流，支持 required 标记
// 类似 Forge 的 Workflow + WorkflowRunner，但基于已有 experiment 系统

export const META = {
  id: 'step-workflow',
  name: 'Step Workflow — 工作流定义 + 必要步骤强制执行',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'define | run | status | list' },
    { name: 'workflow', type: 'object', required: false, description: 'define/run: { name, steps: [{ id, experiment, op, inputs, required?, retry? }] }' },
    { name: 'workflowName', type: 'string', required: false, description: 'run/status: 已定义的工作流名' },
    { name: 'composeRun', type: 'function', required: false, description: 'async (expId, inputs) => outputs' },
    { name: 'shared', type: 'object', required: false, description: '步骤间共享数据 (run)' },
  ],
  outputs: [
    { name: 'workflow', type: 'object' },
    { name: 'results', type: 'array' },
    { name: 'status', type: 'string' },
    { name: 'failedStep', type: 'string' },
  ],
  deps: [],
  tags: ['guardrails', 'workflow', 'orchestration'],
};

const workflows = new Map();

function _reset() { workflows.clear(); }

function _validateStep(step) {
  if (!step.id) throw new Error('step.id required');
  if (!step.experiment) throw new Error(`step ${step.id}: experiment required`);
  if (!step.op && !step.inputs) throw new Error(`step ${step.id}: op or inputs required`);
  return step;
}

export async function run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('step-workflow.run: op required');

  switch (op) {
    case 'define': {
      if (!args.workflow) throw new Error('workflow object required');
      if (!args.workflow.name || !args.workflow.steps) throw new Error('workflow.name and workflow.steps required');
      args.workflow.steps.forEach(_validateStep);
      workflows.set(args.workflow.name, { ...args.workflow, createdAt: Date.now() });
      return { outputs: { workflow: args.workflow } };
    }

    case 'list': {
      return { outputs: { workflows: Array.from(workflows.keys()).map(name => ({ name, steps: workflows.get(name).steps.length })) } };
    }

    case 'run': {
      const wf = workflows.get(args.workflowName);
      if (!wf) throw new Error(`workflow "${args.workflowName}" not defined`);
      if (!args.composeRun) throw new Error('composeRun function required');

      const results = [];
      const shared = { ...(args.shared || {}) };

      for (const step of wf.steps) {
        const stepInputs = typeof step.inputs === 'function' ? step.inputs(shared) : (step.inputs || { op: step.op });
        const maxRetries = step.retry || 1;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const result = await args.composeRun(step.experiment, stepInputs);
            if (result && result.outputs) shared[step.id] = result.outputs;
            results.push({ stepId: step.id, success: true, attempt, output: result?.outputs || result });
            lastError = null;
            break;
          } catch (e) {
            lastError = e.message;
            if (attempt < maxRetries) continue;
            results.push({ stepId: step.id, success: false, attempt, error: e.message });
          }
        }

        if (lastError && step.required !== false) {
          return { outputs: { status: 'blocked', failedStep: step.id, results, error: `必要步骤 ${step.id} 失败: ${lastError}` } };
        }
      }

      const failed = results.filter(r => !r.success);
      return { outputs: { status: failed.length === 0 ? 'completed' : 'completed_with_errors', results, errorCount: failed.length } };
    }

    case 'status':
      return { outputs: { workflows: Array.from(workflows.entries()).map(([name, wf]) => ({ name, steps: wf.steps.length, createdAt: wf.createdAt })) } };

    default:
      throw new Error(`step-workflow.run: unknown op "${op}"`);
  }
}

import { create } from './lib/report.mjs';

const { ok, ng, skip, report } = create();
const NAME = 'Step Workflow';

async function test() {
  _reset();

  const wf = {
    name: 'test-wf',
    steps: [
      { id: 's1', experiment: 'config', op: '', inputs: { op: 'get' }, required: true },
      { id: 's2', experiment: 'coding', op: 'read_file', inputs: { op: 'read_file', path: 'package.json' }, required: false },
    ],
  };

  const def = await run({ inputs: { op: 'define', workflow: wf } });
  if (def.outputs.workflow.name === 'test-wf') ok('workflow defined');
  else ng('define failed');

  const list = await run({ inputs: { op: 'list' } });
  if (list.outputs.workflows.length > 0) ok('workflow listed');
  else ng('list failed');

  // 模拟 composeRun
  const mockRun = async (expId, inputs) => {
    if (expId === 'config') return { outputs: { provider: 'minimax', config: {} } };
    if (expId === 'coding') return { outputs: { result: 'mock content' } };
    throw new Error(`unknown experiment: ${expId}`);
  };

  const exec = await run({ inputs: { op: 'run', workflowName: 'test-wf', composeRun: mockRun } });
  if (exec.outputs.status === 'completed') ok('workflow executed');
  else ng(`execution failed: ${JSON.stringify(exec.outputs)}`);

  // 必要步骤失败测试
  const failWf = {
    name: 'fail-wf',
    steps: [
      { id: 'fail', experiment: 'nope', op: '', inputs: {}, required: true },
    ],
  };
  await run({ inputs: { op: 'define', workflow: failWf } });
  const failExec = await run({ inputs: { op: 'run', workflowName: 'fail-wf', composeRun: mockRun } });
  if (failExec.outputs.status === 'blocked') ok('workflow blocked on required step failure');
  else ng(`blocked test failed: ${JSON.stringify(failExec.outputs)}`);

  report(NAME);
}

export { test };
