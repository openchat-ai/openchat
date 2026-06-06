// Experiment 7: chatId 路径隔离 (纯函数)
//
// I/O (compose 契约): { key: 'oc/chat/{chatId}/{file}' } → { outputs: { chatId, replyPrefix } }

import { create } from './lib/report.mjs';

export const META = { id: 'isolation' };

const NAME = 'Session 隔离 — 多终端 chatId 隔离';

export async function run({ inputs = {} } = {}) {
  const { key } = inputs;
  if (typeof key !== 'string') throw new Error('key (string) required');
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  return { outputs: { chatId, replyPrefix: `oc/chat/${chatId}/` } };
}

async function test() {
  const { ok, ng, report } = create();

  // 路径解析
  const paths = [
    { key: 'oc/chat/device-zhangsan/123.msg', expect: 'device-zhangsan' },
    { key: 'oc/chat/device-lisi/456.enc',     expect: 'device-lisi' },
    { key: 'oc/chat/a/b/c/123.msg',           expect: 'a' },
  ];
  for (const { key, expect } of paths) {
    const { outputs } = await run({ inputs: { key } });
    if (outputs.chatId === expect) ok(`run({key:"${key}"}) → ${outputs.chatId}`);
    else ng(`run({key:"${key}"}) → ${outputs.chatId} (期望 ${expect})`);
  }

  // 回复隔离
  const testCases = [
    { source: 'oc/chat/device-zhangsan/111.msg', replyPrefix: 'oc/chat/device-zhangsan/' },
    { source: 'oc/chat/device-lisi/222.msg',     replyPrefix: 'oc/chat/device-lisi/' },
  ];
  for (const tc of testCases) {
    const { outputs } = await run({ inputs: { key: tc.source } });
    if (outputs.replyPrefix === tc.replyPrefix) ok(`回复隔离: ${tc.source} → ${outputs.replyPrefix}`);
    else ng(`回复路径错误: ${outputs.replyPrefix} (期望 ${tc.replyPrefix})`);
  }

  report(NAME);
}

export { test };
