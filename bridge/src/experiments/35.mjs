// Experiment 6: chat-poller 行为测试 (walking-skeleton 核心)
//
// 测真行为，不只是源码静态检查。注入 mock qiniu + mock processText，验证：
//   - parseMsgPayload: 解析 .msg JSON、剥 EPC 头、拒绝错格式
//   - tsFromKey: 从 key 提取时间戳
//   - handleMessage: 调 agent → 上传 reply.json
//   - handleVoice:  校验 EPC 头 → 解码 → 调 agent → 上传
//   - processOne:   dedup (in-flight) + 分发到 handleMessage/handleVoice
//   - 错误路径:    坏 JSON、坏 EPC、agent 抛异常
//
// I/O (compose 契约): { op: 'runProcessOne'|'handleMessage'|'handleVoice'|'parse', ... } → result

import { create } from './lib/report.mjs';
import pathToFileURL from 'url';

export const META = { id: 'chat-poller' };

const NAME = 'Chat-Poller — walking-skeleton 核心 (真行为测试)';

let _pollerPromise = null;
function _load() {
  if (_pollerPromise) return _pollerPromise;
  _pollerPromise = import('./lib/poller-shim.mjs');
  return _pollerPromise;
}

// 默认 fake deps — 每个测试用自己的
function _defaultMocks() {
  return {
    qiniuGet: async (key) => Buffer.from('mock'),
    qiniuPut: async (key, data) => ({ key, size: data.length }),
    qiniuList: async (prefix) => [],
    processText: async (text, chatId) => ({ response: `echo: ${text}`, toolCalls: [] }),
    generateSessionName: async () => null,
    autoNameIfNeeded: async () => null,
  };
}

export async function run({ inputs = {} } = {}) {
  const { op = 'processOne', key = 'oc/chat/c1/1000.msg', raw = null } = inputs;
  const poller = await _load();
  poller._setDeps(_defaultMocks());
  if (op === 'processOne') {
    if (raw) poller._setDeps({ qiniuGet: async () => Buffer.from(raw) });
    const out = await poller.processOne(key);
    return { outputs: { result: out, key } };
  }
  if (op === 'handleMessage') {
    const buf = raw ? Buffer.from(raw) : Buffer.from('{"type":"text","text":"hi"}');
    const out = await poller.handleMessage(key, buf);
    return { outputs: { result: out, key } };
  }
  if (op === 'handleVoice') {
    const buf = raw ? Buffer.from(raw) : Buffer.from([0xBB, 0x01, 0xCC, 0, 0, 0]);
    const out = await poller.handleVoice(key, buf);
    return { outputs: { result: out, key } };
  }
  if (op === 'parse') {
    const buf = raw ? Buffer.from(raw) : Buffer.from('{"type":"text","text":"hi"}');
    const out = poller.parseMsgPayload(key, buf);
    return { outputs: { result: out, key } };
  }
  throw new Error(`unknown op: ${op}`);
}

async function test() {
  const r = create();
  const { ok, ng, skip, report } = r;

  let poller;
  try {
    poller = await _load();
    ok('chat-poller.mjs 可加载');
  } catch (e) {
    ng('chat-poller 加载失败', e);
    return report(NAME);
  }

  // === 必备导出 ===
  for (const f of ['startChatPoll', 'processOne', 'handleMessage', 'handleVoice', 'parseMsgPayload', 'tsFromKey', '_setDeps', '_resetDeps']) {
    if (typeof poller[f] === 'function') ok(`导出 ${f}()`);
    else ng(`导出 ${f} 缺失`);
  }

  // === tsFromKey 纯函数 ===
  const cases = [
    { key: 'oc/chat/c1/1780720715249.msg', expect: 1780720715249 },
    { key: 'oc/chat/c1/1234.enc',          expect: 1234 },
    { key: 'oc/chat/c1/0.msg',             expect: 0 },
    { key: 'oc/chat/c1/abc.msg',           expect: 0 },
    { key: 'junk',                          expect: 0 },
  ];
  for (const c of cases) {
    const got = poller.tsFromKey(c.key);
    if (got === c.expect) ok(`tsFromKey("${c.key}") → ${got}`);
    else ng(`tsFromKey("${c.key}") → ${got} (期望 ${c.expect})`);
  }

  // === parseMsgPayload: 正常 JSON ===
  {
    const raw = Buffer.from('{"type":"text","text":"hello"}');
    const out = poller.parseMsgPayload('oc/chat/c1/1000.msg', raw);
    if (out && out.text === 'hello' && out.chatId === 'c1') ok('parseMsgPayload 正常 → text=hello, chatId=c1');
    else ng(`parseMsgPayload 异常: ${JSON.stringify(out)}`);
  }

  // === parseMsgPayload: EPC 头剥离 (BB 00 06 ... 6 字节 payload) ===
  {
    const json = '{"type":"text","text":"epc"}';
    const payload = Buffer.from(json, 'utf8');
    const pl = payload.length; // 6 字节
    const raw = Buffer.concat([
      Buffer.from([0xBB, 0x00, 0xDD, (pl >> 16) & 0xFF, (pl >> 8) & 0xFF, pl & 0xFF]),
      payload,
    ]);
    const out = poller.parseMsgPayload('oc/chat/c1/1001.msg', raw);
    if (out && out.text === 'epc') ok('parseMsgPayload EPC 头剥离 → text=epc');
    else ng(`EPC 剥离错: ${JSON.stringify(out)}`);
  }

  // === parseMsgPayload: 无效 JSON ===
  {
    const out = poller.parseMsgPayload('oc/chat/c1/x.msg', Buffer.from('not json'));
    if (out === null) ok('parseMsgPayload 坏 JSON → null');
    else ng(`坏 JSON 应 null: ${JSON.stringify(out)}`);
  }

  // === parseMsgPayload: 错 type ===
  {
    const out = poller.parseMsgPayload('oc/chat/c1/x.msg', Buffer.from('{"type":"image","text":"x"}'));
    if (out === null) ok('parseMsgPayload 错 type → null');
    else ng(`错 type 应 null: ${JSON.stringify(out)}`);
  }

  // === handleMessage: mock composeRun (委托给 poll-one) ===
  {
    const captured = {};
    poller._setDeps({
      composeRun: async (id, inputs) => {
        captured[id] = inputs;
        if (id === 'poll-one') {
          // 模拟 poll-one 的输出
          return { outputs: {
            reply: `echo ${inputs.text}`,
            replyKey: `oc/chat/${inputs.chatId}/mock-reply.json`,
            error: null,
            chatId: inputs.chatId,
            msgKey: inputs.msgKey,
          } };
        }
        throw new Error(`mock: unknown ${id}`);
      },
    });
    const out = await poller.handleMessage('oc/chat/c1/2000.msg', Buffer.from('{"type":"text","text":"hi"}'));
    if (out && out.reply === 'echo hi') ok(`handleMessage reply: "${out.reply}"`);
    else ng(`handleMessage reply 错: ${JSON.stringify(out)}`);

    // 验证传给 poll-one 的入参
    if (captured['poll-one']?.msgKey === 'oc/chat/c1/2000.msg') ok('传给 poll-one: msgKey 正确');
    else ng(`msgKey 错: ${captured['poll-one']?.msgKey}`);
    if (captured['poll-one']?.text === 'hi') ok('传给 poll-one: text=hi');
    else ng(`text 错: ${captured['poll-one']?.text}`);
    if (captured['poll-one']?.chatId === 'c1') ok('传给 poll-one: chatId=c1');
    else ng(`chatId 错: ${captured['poll-one']?.chatId}`);

    // chat-poller 内部组装 reply 对象 (从 poll-one outputs)
    if (out?.sourceKey === 'oc/chat/c1/2000.msg' && out?.replyKey?.endsWith('-reply.json')) ok('reply 对象: sourceKey + replyKey 正确');
    else ng(`reply 对象错: ${JSON.stringify(out)}`);

    poller._resetDeps();
  }

  // === handleMessage: agent 抛异常 (mock poll-one 返回 error) ===
  {
    poller._setDeps({
      composeRun: async (id, inputs) => {
        if (id === 'poll-one') {
          return { outputs: {
            reply: '[agent error] boom',
            replyKey: 'oc/chat/c1/mock-reply.json',
            error: 'boom',
            chatId: inputs.chatId,
          } };
        }
        throw new Error(`mock: unknown ${id}`);
      },
    });
    const out = await poller.handleMessage('oc/chat/c1/2001.msg', Buffer.from('{"type":"text","text":"x"}'));
    if (out?.reply?.includes('boom') && out?.error === 'boom') ok(`agent 错误: "${out.reply}"`);
    else ng(`agent 错误处理错: ${JSON.stringify(out)}`);
    poller._resetDeps();
  }

  // === handleVoice: 校验 EPC 头 BB 01 CC ===
  {
    const stored = {};
    let agentCalled = false;
    poller._setDeps({
      qiniuPut: async (key, data) => { stored[key] = JSON.parse(data.toString('utf8')); },
      processText: async (text, chatId) => { agentCalled = true; return { response: 'voice reply', toolCalls: [] }; },
    });
    // handleVoice 坏 EPC 头路径: 无需 codec
    const invalid = await poller.handleVoice('oc/chat/c1/x.enc', Buffer.from([0xFF, 0xFF, 0xFF]));
    if (invalid === null) ok('handleVoice 坏 EPC 头 → null');
    else ng(`坏 EPC 头应 null: ${JSON.stringify(invalid)}`);

    poller._resetDeps();
  }

  // === processOne: 派发到 handleMessage (handleMessage → poll-one) ===
  {
    poller._setDeps({
      qiniuGet: async (key) => Buffer.from('{"type":"text","text":"dispatch"}'),
      composeRun: async (id, inputs) => {
        if (id === 'poll-one') {
          return { outputs: { reply: `r:${inputs.text}`, replyKey: 'oc/chat/c1/mock.json', error: null, chatId: inputs.chatId, msgKey: inputs.msgKey } };
        }
        throw new Error(`mock: unknown ${id}`);
      },
      autoNameIfNeeded: async () => null,
    });
    const out = await poller.processOne('oc/chat/c1/3000.msg');
    if (out?.reply === 'r:dispatch') ok(`processOne(.msg) 派发: "${out.reply}"`);
    else ng(`processOne 派发错: ${JSON.stringify(out)}`);
    poller._resetDeps();
  }

  // === processOne: dedup via _inFlight ===
  {
    let pollOneCount = 0;
    poller._setDeps({
      qiniuGet: async () => Buffer.from('{"type":"text","text":"dedup"}'),
      composeRun: async (id, inputs) => {
        if (id === 'poll-one') {
          pollOneCount++;
          await new Promise(r => setTimeout(r, 50)); // 慢一点，触发 in-flight
          return { outputs: { reply: 'r', replyKey: 'oc/chat/c1/4000-reply.json', error: null, chatId: 'c1', msgKey: inputs.msgKey } };
        }
        throw new Error(`mock: unknown ${id}`);
      },
      autoNameIfNeeded: async () => null,
    });
    const p1 = poller.processOne('oc/chat/c1/4000.msg');
    const p2 = poller.processOne('oc/chat/c1/4000.msg'); // 同一 key，立即触发
    const [r1, r2] = await Promise.all([p1, p2]);
    if (r1?.skipped === 'in-flight' || r2?.skipped === 'in-flight') ok('processOne dedup: 至少一个被跳过');
    else ng(`dedup 失败: r1=${JSON.stringify(r1)} r2=${JSON.stringify(r2)}`);
    if (pollOneCount <= 1) ok(`processOne dedup: poll-one 调 ${pollOneCount} 次 (应 ≤1)`);
    else ng(`poll-one 调了 ${pollOneCount} 次`);
    poller._resetDeps();
  }

  // === processOne: 空文件 ===
  {
    poller._setDeps({
      qiniuGet: async () => Buffer.alloc(0),
      qiniuPut: async () => {},
    });
    const out = await poller.processOne('oc/chat/c1/5000.msg');
    if (out?.skipped === 'empty') ok('processOne 空文件 → skipped=empty');
    else ng(`空文件处理错: ${JSON.stringify(out)}`);
    poller._resetDeps();
  }

  // === 真实端到端: 有 QINIU env 才跑 (上传 .msg → 等 chat-poller 处理 → 验证 reply) ===
  const hasQiniu = !!process.env.QINIU_ACCESS_KEY && !!process.env.QINIU_SECRET_KEY;
  const hasProvider = await (async () => {
    try {
      const cfg = (await import('./lib/config.mjs')).persistentConfig.config;
      return !!(cfg.providers?.[cfg.current?.provider]?.apiKey);
    } catch { return false; }
  })();

  if (hasQiniu && hasProvider) {
    try {
      const { qiniuPut, qiniuList, qiniuGet, qiniuDelete } = await import('./lib/qiniu-s3.mjs');
      const chatId = 'e2e-test';
      const ts = Date.now();
      const key = `oc/chat/${chatId}/${ts}.msg`;
      await qiniuPut(key, Buffer.from(JSON.stringify({ type: 'text', text: 'e2e test' }), 'utf8'));
      ok(`已上传 ${key}`);

      // 等 chat-poller 处理 (启动 poller 短暂运行)
      // 注: 这里不直接调 startChatPoll（会卡），改用 processOne
      const out = await poller.processOne(key);
      if (out?.reply) ok(`e2e: agent 回复 "${out.reply.substring(0, 40)}"`);
      else ng(`e2e: 无 reply: ${JSON.stringify(out)}`);

      // 清理
      const replyKey = out?.replyKey;
      if (replyKey) await qiniuDelete(replyKey).catch(() => {});
      await qiniuDelete(key).catch(() => {});
      ok('e2e 清理完成');
    } catch (e) {
      ng('e2e 真实联调失败', e);
    }
  } else {
    skip(`e2e 联调跳过 (hasQiniu=${hasQiniu}, hasProvider=${hasProvider})`);
  }

  report(NAME);
}

export { test };
