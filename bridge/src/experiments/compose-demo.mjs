// compose-demo.mjs — 演示 compose.mjs 把多个实验拼成「新软件」
//
// 展示三种组合：
//   1. 单实验: run('codec', { pcm, op: 'encode' })
//   2. 管道: compose([isolation, codec])    — 解析 key → 解码
//   3. 完整链路: compose([config, agent])   — 读 config → 调 LLM
//
// 跑：node src/experiments/compose-demo.mjs

import { run, compose, list, getMeta, getState, printDeps, reset } from './compose.mjs';

const demo = async () => {
  console.debug('═══════════════════════════════════════');
  console.debug('   compose.mjs 演示');
  console.debug('═══════════════════════════════════════\n');

  // 0. 列清单
  console.debug('▸ 可用实验 (manifest.json):');
  for (const e of list()) {
    const tags = (e.tags || []).slice(0, 3).join(', ');
    console.debug(`   ${e.id.padEnd(15)} ${e.category.padEnd(8)} [${tags}]`);
  }
  console.debug();

  // 1. 单实验：codec encode
  console.debug('▸ 1. run("codec", encode)');
  reset();
  const pcm = Buffer.alloc(192 * 2); // 192 samples of silence @ 48kHz
  const enc = await run('codec', { pcm, op: 'encode' });
  console.debug(`   inputs:  { pcm: ${pcm.length} bytes silence, op: 'encode' }`);
  console.debug(`   outputs: { encoded: ${enc.outputs.encoded.length} bytes (EPC BB 01 CC) }`);
  console.debug();

  // 2. 单实验：codec decode roundtrip
  console.debug('▸ 2. run("codec", decode)');
  const dec = await run('codec', { encoded: enc.outputs.encoded, op: 'decode' });
  console.debug(`   inputs:  { encoded: ${enc.outputs.encoded.length} bytes, op: 'decode' }`);
  console.debug(`   outputs: { pcm: ${dec.outputs.pcm.length} bytes }`);
  console.debug();

  // 3. 单实验：isolation 路径解析
  console.debug('▸ 3. run("isolation")');
  const iso = await run('isolation', { key: 'oc/chat/device-zhangsan/123.msg' });
  console.debug(`   inputs:  { key: 'oc/chat/device-zhangsan/123.msg' }`);
  console.debug(`   outputs: { chatId: '${iso.outputs.chatId}', replyPrefix: '${iso.outputs.replyPrefix}' }`);
  console.debug();

  // 4. compose: 解析 chatId + 编码 PCM
  console.debug('▸ 4. compose([isolation, codec]) — 两个实验并联');
  reset();
  const out = await compose(['isolation', 'codec'], {
    isolation: { key: 'oc/chat/c1/voice.enc' },
    codec:     { pcm, op: 'encode' },
  });
  console.debug(`   outputs:`);
  console.debug(`     isolation → ${JSON.stringify(out.isolation)}`);
  console.debug(`     codec     → { encoded: ${out.codec.outputs.encoded.length} bytes }`);
  console.debug();

  // 5. 依赖图
  console.debug('▸ 5. 依赖图 printDeps("chat-poller")');
  console.debug(printDeps('chat-poller'));
  console.debug();

  // 6. State 快照
  console.debug('▸ 6. getState() — 当前所有 cache 的实验');
  for (const [id, s] of Object.entries(getState())) {
    console.debug(`   ${id.padEnd(15)} ${s.durationMs}ms`);
  }
  console.debug();

  // 7. metadata 示例
  console.debug('▸ 7. getMeta("agent")');
  const m = getMeta('agent');
  console.debug(`   ${m.id}  deps=[${m.deps.join(', ')}]`);
  console.debug(`   inputs:  ${m.inputs.map(i => `${i.name}${i.required ? '*' : ''}: ${i.type}`).join(', ')}`);
  console.debug(`   outputs: ${m.outputs.map(o => `${o.name}: ${o.type}`).join(', ')}`);
  console.debug();

  // 8. 真组合应用: chat-message-pipeline
  //    用 qiniu + isolation + agent 三个实验拼出"用户消息→上传→解析→LLM→写回→验证"的完整小应用
  //    核心点: 没有新增一行产品代码——只是用现成实验搭出来的
  //    注意: compose 跨调用会缓存，顺序执行时用 run() 避开缓存
  console.debug('▸ 8. 真组合应用: chat-message-pipeline (qiniu + isolation + agent)');
  // 能力探测: 试列一次空前缀，能成功就当 Qiniu 可用
  const q = await import('./lib/qiniu-s3.mjs');
  let hasQiniu = false;
  try { await q.qiniuList(''); hasQiniu = true; } catch { hasQiniu = false; }
  if (hasQiniu) {
    reset();
    const chatId  = 'demo-pipeline';
    const ts      = Date.now();
    const demos = ['推荐一本技术书', '写个递归函数', '解释什么是闭包', '今儿天气怎么样'];
const userText = demos[Date.now() % demos.length];
    const msgKey   = `oc/chat/${chatId}/${ts}.msg`;
    const replyKey = `oc/chat/${chatId}/${ts}-reply.json`;
    console.debug(`   input:  { chatId: "${chatId}", text: "${userText}" }`);

    // 步骤 A: 上传用户消息 + 解析 chatId (用 compose — 两个真依赖的实验)
    const a = await compose(['qiniu', 'isolation'], {
      'qiniu':     { op: 'put', key: msgKey, data: Buffer.from(JSON.stringify({ type: 'text', text: userText })) },
      'isolation': { key: msgKey },
    });
    console.debug(`   A. compose([qiniu, isolation])`);
    console.debug(`     写入 key:    ${msgKey}`);
    console.debug(`     解析 chatId: ${a.isolation?.outputs?.chatId}`);

    // 步骤 B: 调 LLM (单实验，直接 run 避免污染 qiniu 缓存)
    let reply = '(agent skipped)';
    try {
      const b = await run('agent', { text: userText, chatId });
      reply = b?.response || '(empty)';
    } catch (e) {
      console.debug(`   [agent 限速/超时: ${e.message.substring(0, 50)}]`);
    }
    console.debug(`   B. run('agent', ...)`);
    console.debug(`     "${reply.substring(0, 60)}${reply.length > 60 ? '...' : ''}"`);

    // 步骤 C: 写回 reply + 直接读 verify (单 op，用 run)
    await run('qiniu', { op: 'put', key: replyKey, data: Buffer.from(JSON.stringify({
      text: reply, sourceKey: msgKey, ts: Date.now(),
    })) });
    const verify = JSON.parse((await run('qiniu', { op: 'get', key: replyKey }))?.outputs?.result?.toString('utf8') || '{}');
    console.debug(`   C. run('qiniu', put + get)`);
    console.debug(`     reply key:   ${replyKey}`);
    console.debug(`     verify.text: "${verify.text?.substring(0, 60)}..."`);
    console.debug(`     sourceKey:   ${verify.sourceKey} ${verify.sourceKey === msgKey ? '✓' : '✗'}`);

    // 清理
    await run('qiniu', { op: 'delete', key: msgKey });
    await run('qiniu', { op: 'delete', key: replyKey });
    console.debug(`   cleanup: 2 keys deleted ✓`);
  } else {
    console.debug('   skipped (qiniu 不可达 — 检查 credentials)');
  }
  console.debug();

  // 9. 纯本地: audio roundtrip + LLM 解释 (codec + agent)
  //    用 0 网络依赖的 2 个实验拼一个"音频→编码→解码→LLM 解释"的小应用
  console.debug('▸ 9. 纯本地: audio-roundtrip + LLM 解释 (codec + agent)');
  reset();
  const pcmIn = Buffer.alloc(192 * 2); // 192 samples silence @ 48kHz
  // 步骤 1: encode + decode 串行（decode 依赖 encode）
  const enc9 = await run('codec', { pcm: pcmIn, op: 'encode' });
  const dec9 = await run('codec', { encoded: enc9.outputs.encoded, op: 'decode' });
  console.debug(`   A. codec roundtrip`);
  console.debug(`     in.pcm:     ${pcmIn.length} bytes silence`);
  console.debug(`     encoded:    ${enc9.outputs.encoded.length} bytes (BB 01 CC ...)`);
  console.debug(`     out.pcm:    ${dec9.outputs.pcm.length} bytes`);

  // 步骤 2: 让 LLM 解释 codec 的作用（容错：限速时跳过，不阻断 demo）
  let explain;
  try {
    explain = await run('agent', {
      text: `用一句话解释这段音频编解码: ${pcmIn.length} 字节 PCM (48kHz int16 静音) 经 LMDN codec 编码为 ${enc9.outputs.encoded.length} 字节 EPC 字节流 (含 BB 01 CC 头), 解码回 ${dec9.outputs.pcm.length} 字节 PCM。`,
      chatId: 'demo-audio',
    });
    const r = explain?.response;
    console.debug(`   B. agent 解释:`);
    if (r) console.debug(`     "${r.substring(0, 80)}${r.length > 80 ? '...' : ''}"`);
    else  console.debug(`     (限速/空响应)`);
  } catch (e) {
    console.debug(`   B. agent 跳过 (${e.message.substring(0, 60)})`);
  }
  console.debug();

  // 10. chat-poller 复刻 — 0 行产品代码复现 polling loop 的核心
  //     上传 N 条测试消息 → list → 对每条: get + isolation + agent + put reply → verify
  console.debug('▸ 10. chat-poller 复刻 — 0 行产品代码复现 polling 核心');
  if (hasQiniu) {
    const chatId10 = 'demo-poller';
    const ts10 = Date.now();
    const testMsgs = [
      { text: '一句话介绍 LLM' },
      { text: 'LMDN codec 是什么' },
    ];
    console.debug(`   input:  ${testMsgs.length} 条测试消息 → chatId="${chatId10}"`);

    // A. 上传测试消息
    for (let i = 0; i < testMsgs.length; i++) {
      const key = `oc/chat/${chatId10}/${ts10}-${i}.msg`;
      await run('qiniu', { op: 'put', key, data: Buffer.from(JSON.stringify({ type: 'text', text: testMsgs[i].text })) });
    }
    console.debug(`   A. 上传: ${testMsgs.length} 条 .msg`);

    // B. list 找待处理
    const listed = await run('qiniu', { op: 'list', prefix: `oc/chat/${chatId10}/${ts10}-` });
    const pending = listed.outputs.result.filter(k => k.endsWith('.msg'));
    console.debug(`   B. list: 找到 ${pending.length} 条待处理`);

    // C. 对每条: 调 poll-one (它内部 = qiniu.get + isolation + agent + qiniu.put reply)
    const replies = [];
    let skipped = 0;
    for (const key of pending) {
      try {
        const r = await run('poll-one', { msgKey: key });
        replies.push(r.outputs.replyKey);
        const txt = r.outputs.reply || '(限速/空响应)';
        const shown = `"${txt.substring(0, 30)}${txt.length > 30 ? '...' : ''}"`;
        console.debug(`     ${key} → chatId="${r.outputs.chatId}" → reply ${shown}`);
      } catch (e) {
        skipped++;
        console.debug(`     ${key} → 跳过 (${e.message.substring(0, 50)})`);
      }
    }
    console.debug(`   C. 处理完: ${replies.length} reply 写入, ${skipped} 跳过`);

    // D. 验证 reply 数 == 上传数
    const listAgain = await run('qiniu', { op: 'list', prefix: `oc/chat/${chatId10}/${ts10}-` });
    const foundReplies = listAgain.outputs.result.filter(k => k.endsWith('-reply.json'));
    console.debug(`   D. verify: ${foundReplies.length}/${replies.length} reply 在 Qiniu 上 ${foundReplies.length === replies.length ? '✓' : '✗'}`);

    // cleanup
    for (const k of [...pending, ...replies]) {
      await run('qiniu', { op: 'delete', key: k });
    }
    console.debug(`   cleanup: ${pending.length + replies.length} keys deleted ✓`);
  } else {
    console.debug('   skipped (qiniu 不可达)');
  }
  console.debug();

  // 11. 总结: 这个 demo 的产物 = 0 行新业务代码
  console.debug('▸ 11. 总结');
  console.debug('   真组合应用 = 现有实验的有序调用序列。');
  console.debug('   改产品代码时,只需在实验里加能力,新应用就自动获得它。');
  console.debug('   例如: 给 agent 加 web_fetch → 上面的 pipeline 自动能联网。');
  console.debug('   demo 8/9/10 共用 qiniu/codec/agent/isolation 四个实验 = 整个 chat 流水线');
};

demo().catch(e => { console.error('demo 失败:', e); process.exit(1); });
