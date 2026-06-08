import { run } from '../../src/experiments/40-guardrails-pipeline.mjs';

const tools = [
  { function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { function: { name: 'glob', parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } } },
  { function: { name: 'grep', parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } } },
  { function: { name: 'edit_file', parameters: { type: 'object', properties: { path: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'search', 'replace'] } } },
  { function: { name: 'execute_command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
];

const scenarios = [
  { id: 'error-recovery', text: '读取 /nonexistent/file.txt 的内容', tools, mockSeq: [] },
  { id: 'ambiguous-goal', text: '优化这个项目的构建配置（Node.js + webpack）', tools, mockSeq: [] },
];

for (const sc of scenarios) {
  console.log(`\n=== ${sc.id} ===`);
  const t0 = Date.now();
  const r = await run({ inputs: { op: 'compare', live: true, scenario: sc, repeats: 1 } });
  const o = r.outputs;
  const d = Object.values(o.scenarios)[0].delta;
  console.log(`  token=${d.token}  轮次=${d.rounds}  错误=${d.errors}  完成率=${d.completionRate}`);
  console.log(`  ${(Date.now()-t0)/1000}s`);
}
console.log(`\n裁决: ${r.outputs.verdict}  (${r.outputs.votes})`);
