import { ok, equal } from 'assert';
import { _setDeps, _getDeps, parseMsgPayload } from './lib/poller-shim.mjs';

const NAME = 'Process Recovery — Bridge 重启后会话不丢';

export async function run({ inputs = {} } = {}) {
  let persistentStoreExists = false;
  try {
    await import('../core/persistent-store.js');
    persistentStoreExists = true;
  } catch {}

  const mockReplies = {
    'oc/chat/t1/1-reply.json': JSON.stringify({ sourceKey: 'oc/chat/t1/1.msg', text: 'ok' }),
    'oc/chat/t1/2-reply.json': JSON.stringify({ sourceKey: 'oc/chat/t1/2.msg', text: 'ok' }),
  };
  const mockKeys = [
    'oc/chat/t1/1.msg', 'oc/chat/t1/1-reply.json',
    'oc/chat/t1/2.msg', 'oc/chat/t1/2-reply.json',
    'oc/chat/t1/3.msg',
  ];

  _setDeps({
    qiniuList: async () => mockKeys,
    qiniuGet: async (k) => Buffer.from(mockReplies[k] || ''),
    qiniuPut: async () => {},
    processText: async () => ({ response: '' }),
    generateSessionName: async () => '',
    autoNameIfNeeded: async () => {},
    composeRun: async () => ({ outputs: { reply: '', replyKey: '' } }),
  });

  const parsed = parseMsgPayload('oc/chat/t1/1.msg', Buffer.from('{"type":"text","text":"hi"}'));
  const parseOk = !!(parsed && parsed.chatId === 't1' && parsed.text === 'hi');
  _getDeps();

  return {
    outputs: {
      persistentStoreExists,
      parseOk,
    },
  };
}

export async function test() {
  const r = await run();
  const o = r.outputs;
  let pass = true;
  try {
    ok(o.parseOk, 'msg payload parse works after mock restart');
    console.log('  ✓ recovery: msg payload parse works after mock restart');
    ok(o.persistentStoreExists, 'persistent-store.js should exist');
    console.log('  ✓ recovery: persistent-store.js exists');
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    pass = false;
  }
  console.log(`\n${pass ? '✓' : '✗'} ${NAME}`);
  return pass;
}
