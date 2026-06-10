// Experiment 44: doc-gen — 报告/问卷/ROI/方案书生成
// Manifest id: doc-gen
// I/O: { op: 'render', kind, data, meta? } → { content, ext, bytes }

import { create } from '../lib/report.mjs';

export const META = {
  id: 'doc-gen',
  name: 'Doc-Gen — 报告/问卷/ROI/方案书生成',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: "render" },
    { name: 'kind', type: 'string', required: true, description: "report | questionnaire | roi | proposal" },
    { name: 'data', type: 'object', required: true },
    { name: 'meta', type: 'object', required: false },
  ],
  outputs: [
    { name: 'content', type: 'string' },
    { name: 'ext', type: 'string' },
    { name: 'bytes', type: 'number' },
  ],
  deps: [],
  tags: ['lingbao', 'doc', 'report'],
};

// === invariants ===
// - 4 kind 各自固定 ext
// - 输出 UTF-8 字符串, bytes = Buffer.byteLength
// - 空 data 也输出有效模板
export async function run({ inputs = {} } = {}) {
  const { op = 'render', kind, data = {}, meta } = inputs;
  if (op !== 'render') throw new Error(`doc-gen.run: unknown op "${op}"`);
  const lib = await import('./lib/doc-gen.mjs');
  return { outputs: lib.renderWithBytes(kind, data, meta) };
}

const NAME = 'Doc-Gen — 报告生成';

async function test() {
  const { ok, ng, report } = create();
  let lib;
  try {
    lib = await import('./lib/doc-gen.mjs');
    ok('doc-gen.mjs 可加载');
  } catch (e) {
    ng('lib 加载失败', e);
    return report(NAME);
  }

  // 1. report 渲染
  try {
    const r = lib.renderWithBytes('report', { bom: [{ part: 'ESP32', model: 'S3', qty: 1, price: 30 }] });
    if (r.ext === 'md' && r.content.includes('# 灵保 MVP') && r.content.includes('ESP32')) ok(`report ${r.bytes}B`);
    else ng(`report 错: ext=${r.ext}, hasESP32=${r.content.includes('ESP32')}`);
  } catch (e) {
    ng('report 失败', e);
  }

  // 2. questionnaire
  try {
    const r = lib.renderWithBytes('questionnaire', { items: ['问题 A?', '问题 B?'] });
    if (r.ext === 'csv' && r.content.includes('问题 A?') && r.content.includes('序号,问题')) ok(`questionnaire ${r.bytes}B`);
    else ng(`questionnaire 错`);
  } catch (e) {
    ng('questionnaire 失败', e);
  }

  // 3. roi
  try {
    const r = lib.renderWithBytes('roi', { rows: [{ key: 'k1', value: 100 }] });
    if (r.ext === 'csv' && r.content.includes('项目,数值') && r.content.includes('k1')) ok(`roi ${r.bytes}B`);
    else ng('roi 错');
  } catch (e) {
    ng('roi 失败', e);
  }

  // 4. proposal
  try {
    const r = lib.renderWithBytes('proposal', { projectName: '测试项目' });
    if (r.ext === 'md' && r.content.includes('测试项目') && r.content.includes('设备清单')) ok(`proposal ${r.bytes}B`);
    else ng('proposal 错');
  } catch (e) {
    ng('proposal 失败', e);
  }

  // 5. 空 data 输出模板
  try {
    const r = lib.renderWithBytes('report', {});
    if (r.bytes > 100) ok(`空 data 也输出 ${r.bytes}B 模板`);
    else ng(`空模板过短: ${r.bytes}`);
  } catch (e) {
    ng('空 data 失败', e);
  }

  // 6. CSV 转义
  try {
    const r = lib.renderWithBytes('roi', { rows: [{ key: '带,逗号', value: '有"引号' }] });
    if (r.content.includes('"带,逗号"') && r.content.includes('"有""引号"')) ok('CSV 转义正确');
    else ng('CSV 转义错');
  } catch (e) {
    ng('CSV 转义失败', e);
  }

  // 7. bytes 等于实际字节数
  try {
    const r = lib.renderWithBytes('report', { title: '测试' });
    const actual = Buffer.byteLength(r.content, 'utf8');
    if (r.bytes === actual) ok(`bytes 准确: ${r.bytes}`);
    else ng(`bytes 错: ${r.bytes} vs ${actual}`);
  } catch (e) {
    ng('bytes 校验失败', e);
  }

  // 8. 边界: 未知 kind
  try {
    lib.renderWithBytes('unknown', {});
    ng('未知 kind 应抛');
  } catch (e) {
    ok(`未知 kind 拦截: ${e.message.substring(0, 40)}`);
  }

  // 9. run() 契约
  try {
    const r = await run({ inputs: { op: 'render', kind: 'report', data: { title: 'T' } } });
    if (r.outputs.ext === 'md' && r.outputs.bytes > 0) ok('run(render) 契约 OK');
    else ng('run 输出错');
  } catch (e) {
    ng('run 失败', e);
  }

  report(NAME);
}

export { test };
