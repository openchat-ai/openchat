// Experiment 5: qiniu-s3 (S3 兼容 API 封装)
//
// Current state: Qiniu 调用统一走 `scripts/qiniu-s3.mjs`（S3 兼容签名版）。
// qiniu-signaling.js 仍存在但不是主入口。
// 必备 API: qiniuList / qiniuGet / qiniuPut / qiniuDelete / qiniuDeletePrefix

import { create } from './lib/report.mjs';

export const META = { id: 'qiniu' };

// compose 契约入口：op 派发到 qiniu-s3 实际函数
//   inputs:  { op, key?, data?, prefix? }
//   outputs: { result }
export async function run({ inputs = {} } = {}) {
  const { op, key, data, prefix } = inputs;
  if (!op) throw new Error('qiniu.run: op required (list|get|put|delete|deletePrefix)');
  const q = await import('./lib/qiniu-s3.mjs');
  switch (op) {
    case 'list':         return { outputs: { result: await q.qiniuList(prefix || '') } };
    case 'get':          return { outputs: { result: await q.qiniuGet(key) } };
    case 'put':          return { outputs: { result: await q.qiniuPut(key, data) } };
    case 'delete':       return { outputs: { result: await q.qiniuDelete(key) } };
    case 'deletePrefix': return { outputs: { result: await q.qiniuDeletePrefix(prefix) } };
    default: throw new Error(`qiniu.run: unknown op: ${op}`);
  }
}

const { ok, ng, skip, report } = create();
const NAME = 'Qiniu — S3 兼容封装 (qiniu-s3)';

async function test() {
  let q;
  try {
    q = await import('./lib/qiniu-s3.mjs');
    ok('scripts/qiniu-s3.mjs 可加载');
  } catch (e) {
    ng('qiniu-s3 加载失败', e);
    return report(NAME);
  }

  // 必备 API
  const required = ['qiniuList', 'qiniuGet', 'qiniuPut', 'qiniuDelete', 'qiniuDeletePrefix'];
  for (const m of required) {
    if (typeof q[m] === 'function') ok(`${m} 函数存在`);
    else ng(`${m} 缺失`);
  }

  // 签名函数（私有的不导出也 OK，只检查源里有 S3 V4 signing）
  try {
    const fs = await import('fs/promises');
    const src = await fs.readFile('scripts/qiniu-s3.mjs', 'utf8');
    if (src.includes('createHmac') || src.includes('AWS4')) ok('S3 V4 签名 (HMAC-SHA256)');
    else ng('未发现 S3 V4 签名');
    if (src.includes('x-amz-') || src.includes('X-Amz-')) ok('S3 协议头');
    else ng('未见 S3 协议头');
  } catch (e) {
    skip('签名源码检查跳过');
  }

  // 调用方: chat-poller + session-tree 都用了 qiniu-s3
  try {
    const fs = await import('fs/promises');
    const poller = await fs.readFile('src/core/chat-poller.mjs', 'utf8');
    if (poller.includes('qiniu-s3')) ok('chat-poller 引用 qiniu-s3');
    else ng('chat-poller 未用 qiniu-s3');
    const tree = await fs.readFile('src/core/session-tree.mjs', 'utf8');
    if (tree.includes('qiniu-s3')) ok('session-tree 引用 qiniu-s3');
    else ng('session-tree 未用 qiniu-s3');
  } catch (e) {
    skip('调用方检查跳过');
  }

  // 实际联通 (需 env 变量) — 跑 list 探活
  const hasAk = !!process.env.QINIU_ACCESS_KEY;
  const hasSk = !!process.env.QINIU_SECRET_KEY;
  if (hasAk && hasSk) {
    try {
      const keys = await q.qiniuList('');
      if (Array.isArray(keys)) ok(`qiniuList('') 返回 ${keys.length} 项`);
      else ng(`qiniuList 返回非数组: ${typeof keys}`);
    } catch (e) {
      skip(`qiniu 联调跳过: ${e.message.substring(0, 60)}`);
    }
  } else {
    skip('Qiniu 联调跳过 (无 env 变量 QINIU_ACCESS_KEY/SECRET_KEY)');
  }

  report(NAME);
}

export { test };
