// Experiment 15: poll-one — 复合实验: 处理单条 .msg 消息
//
// 这是 chat-poller.mjs 内部 _generateAndUpload 逻辑的"实验化"版本
// 用 qiniu + isolation + agent 三个基础实验拼出"读 → 解析 → 调 LLM → 写回"
//
// I/O: { msgKey: 'oc/chat/{chatId}/{ts}.msg' }
//   → { reply, replyKey, chatId, error? }

import { create } from './lib/report.mjs';
import { run as composeRun } from './compose.mjs';

export const META = { id: 'poll-one' };

// compose 契约入口
//   两种调用方式:
//     A) { msgKey }                    — 完整流程: get + parse + isolation + agent + put reply
//     B) { msgKey, text, chatId }      — 跳过 get+parse+isolation（调用方已解析，如 chat-poller）
export async function run({ inputs = {} } = {}) {
  const { msgKey, text: inputText, chatId: inputChatId } = inputs;
  if (!msgKey) throw new Error('poll-one.run: msgKey required');
  if (!msgKey.endsWith('.msg')) {
    return { outputs: { error: 'not-msg', msgKey, reply: '', replyKey: '', chatId: '' } };
  }

  // 1. 拿 text + chatId
  let text, chatId;
  if (inputText && inputChatId) {
    text = inputText;
    chatId = inputChatId;
  } else {
    // 1a. 读 .msg
    let got, parsed;
    try {
      got = await composeRun('qiniu', { op: 'get', key: msgKey });
      parsed = JSON.parse(got.outputs.result.toString('utf8'));
    } catch (e) {
      return { outputs: { error: `read-msg: ${e.message}`, msgKey, reply: '', replyKey: '', chatId: '' } };
    }
    if (parsed.type !== 'text' || !parsed.text) {
      return { outputs: { error: 'bad-format', msgKey, type: parsed.type, reply: '', replyKey: '', chatId: '' } };
    }
    text = parsed.text;
    // 1b. 解析 chatId
    try {
      const iso = await composeRun('isolation', { key: msgKey });
      chatId = iso.outputs.chatId;
    } catch (e) {
      return { outputs: { error: `isolation: ${e.message}`, msgKey, reply: '', replyKey: '', chatId: '' } };
    }
  }

  // 2. 调 LLM (容错: 限速时不阻断)
  let reply = '';
  let agentError = null;
  try {
    const r = await composeRun('agent', { text, chatId });
    reply = r?.outputs?.response || '';
  } catch (e) {
    agentError = e.message;
  }

  // 3. 写回 reply.json
  const replyKey = msgKey.replace(/\.msg$/, '-reply.json');
  const replyText = reply || (agentError ? `[agent error] ${agentError}` : '(empty)');
  const payload = { text: replyText, sourceKey: msgKey, ts: Date.now(), ...(agentError && { error: agentError }) };
  try {
    await composeRun('qiniu', { op: 'put', key: replyKey, data: Buffer.from(JSON.stringify(payload), 'utf8') });
  } catch (e) {
    return { outputs: { error: `put-reply: ${e.message}`, reply: replyText, replyKey, chatId, msgKey } };
  }

  return { outputs: { reply: replyText, replyKey, chatId, error: agentError, msgKey } };
}

const NAME = 'Poll-One — 复合实验 (qiniu + isolation + agent)';

export async function test() {
  const { ok, ng, skip, report } = create();

  // API 表面
  if (typeof run === 'function') ok('run() 存在');
  else ng('run 缺失');
  if (META.id === 'poll-one') ok('META.id 正确');
  else ng(`META.id 错: ${META.id}`);

  // 输入校验
  try {
    await run({ inputs: {} });
    ng('缺 msgKey 应抛');
  } catch (e) {
    ok(`缺 msgKey 抛: ${e.message.substring(0, 40)}`);
  }

  // 非 .msg 文件
  const r0 = await run({ inputs: { msgKey: 'oc/chat/x/1.enc' } });
  if (r0.outputs.error === 'not-msg') ok('非 .msg → error=not-msg');
  else ng(`非 .msg 错: ${r0.outputs.error}`);

  // Qiniu 能力探测
  const q = await import('../../scripts/qiniu-s3.mjs');
  let hasQiniu = false;
  try { await q.qiniuList(''); hasQiniu = true; } catch { hasQiniu = false; }

  if (hasQiniu) {
    const chatId = 'poll-one-test';
    const ts = Date.now();
    const msgKey = `oc/chat/${chatId}/${ts}.msg`;
    const replyKey = `${msgKey.replace(/\.msg$/, '-reply.json')}`;

    // 上传测试 .msg
    await q.qiniuPut(msgKey, Buffer.from(JSON.stringify({ type: 'text', text: '一句话介绍你自己' })));
    ok(`上传 ${msgKey}`);

    // run pollOne
    const r = await run({ inputs: { msgKey } });
    if (r.outputs.replyKey === replyKey) ok(`replyKey: ${replyKey}`);
    else ng(`replyKey 错: ${r.outputs.replyKey}`);
    if (r.outputs.chatId === chatId) ok(`chatId: ${chatId}`);
    else ng(`chatId 错: ${r.outputs.chatId}`);
    if (r.outputs.reply) ok(`reply: "${r.outputs.reply?.substring(0, 40)}..."`);
    else ok('reply 为空 (agent 限速)');

    // 验证 reply 上传 + sourceKey
    const got = await q.qiniuGet(replyKey);
    const verify = JSON.parse(got.toString('utf8'));
    if (verify.sourceKey === msgKey) ok(`verify.sourceKey 匹配 ✓`);
    else ng(`sourceKey 错: ${verify.sourceKey}`);

    // 验证坏 JSON
    const badKey = `oc/chat/${chatId}/${ts}-bad.msg`;
    await q.qiniuPut(badKey, Buffer.from('not json'));
    const rBad = await run({ inputs: { msgKey: badKey } });
    if (rBad.outputs.error?.startsWith('read-msg')) ok('坏 JSON → read-msg error');
    else ng(`坏 JSON 错: ${rBad.outputs.error}`);

    // 清理
    await q.qiniuDelete(msgKey);
    await q.qiniuDelete(badKey);
    await q.qiniuDelete(replyKey);
    ok('cleanup ok');
  } else {
    skip('Qiniu 不可达，跳过 e2e');
  }

  report(NAME);
}
