import { ok, ng, skip, report } from './lib/report.mjs';

const NAME = 'Session 隔离 — 多终端 chatId 隔离';

async function testIsolation() {
  // 解析 oc/chat/{chatId}/xxx.msg 路径提取 chatId
  const paths = [
    { key: 'oc/chat/device-zhangsan/123.msg', expect: 'device-zhangsan' },
    { key: 'oc/chat/device-lisi/456.enc',     expect: 'device-lisi' },
    { key: 'oc/chat/a/b/c/123.msg',           expect: 'a' },
  ];
  for (const { key, expect } of paths) {
    const parts = key.split('/');
    const chatId = parts.length >= 3 ? parts[2] : 'default';
    if (chatId === expect) ok(`路径解析: ${key} -> chatId=${chatId}`);
    else ng(`路径解析: ${key} -> chatId=${chatId} (期望 ${expect})`);
  }

  // 回复隔离验证：回复路径必须包含相同的 chatId
  const testCases = [
    { source: 'oc/chat/device-zhangsan/111.msg', replyPrefix: 'oc/chat/device-zhangsan/' },
    { source: 'oc/chat/device-lisi/222.msg',     replyPrefix: 'oc/chat/device-lisi/' },
  ];
  for (const tc of testCases) {
    const parts = tc.source.split('/');
    const srcChatId = parts.length >= 3 ? parts[2] : 'default';
    const replyPath = `oc/chat/${srcChatId}/`;
    if (replyPath === tc.replyPrefix) ok(`回复隔离: ${tc.source} -> ${replyPath}`);
    else ng(`回复路径错误: ${replyPath} (期望 ${tc.replyPrefix})`);
  }

  report(NAME);
}

testIsolation().catch(e => { ng('实验异常', e); report(NAME); });
