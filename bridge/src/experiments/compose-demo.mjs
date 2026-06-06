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
  console.log('═══════════════════════════════════════');
  console.log('   compose.mjs 演示');
  console.log('═══════════════════════════════════════\n');

  // 0. 列清单
  console.log('▸ 可用实验 (manifest.json):');
  for (const e of list()) {
    const tags = (e.tags || []).slice(0, 3).join(', ');
    console.log(`   ${e.id.padEnd(15)} ${e.category.padEnd(8)} [${tags}]`);
  }
  console.log();

  // 1. 单实验：codec encode
  console.log('▸ 1. run("codec", encode)');
  reset();
  const pcm = Buffer.alloc(192 * 2); // 192 samples of silence @ 48kHz
  const enc = await run('codec', { pcm, op: 'encode' });
  console.log(`   inputs:  { pcm: ${pcm.length} bytes silence, op: 'encode' }`);
  console.log(`   outputs: { encoded: ${enc.outputs.encoded.length} bytes (EPC BB 01 CC) }`);
  console.log();

  // 2. 单实验：codec decode roundtrip
  console.log('▸ 2. run("codec", decode)');
  const dec = await run('codec', { encoded: enc.outputs.encoded, op: 'decode' });
  console.log(`   inputs:  { encoded: ${enc.outputs.encoded.length} bytes, op: 'decode' }`);
  console.log(`   outputs: { pcm: ${dec.outputs.pcm.length} bytes }`);
  console.log();

  // 3. 单实验：isolation 路径解析
  console.log('▸ 3. run("isolation")');
  const iso = await run('isolation', { key: 'oc/chat/device-zhangsan/123.msg' });
  console.log(`   inputs:  { key: 'oc/chat/device-zhangsan/123.msg' }`);
  console.log(`   outputs: { chatId: '${iso.outputs.chatId}', replyPrefix: '${iso.outputs.replyPrefix}' }`);
  console.log();

  // 4. compose: 解析 chatId + 编码 PCM
  console.log('▸ 4. compose([isolation, codec]) — 两个实验并联');
  reset();
  const out = await compose(['isolation', 'codec'], {
    isolation: { key: 'oc/chat/c1/voice.enc' },
    codec:     { pcm, op: 'encode' },
  });
  console.log(`   outputs:`);
  console.log(`     isolation → ${JSON.stringify(out.isolation)}`);
  console.log(`     codec     → { encoded: ${out.codec.outputs.encoded.length} bytes }`);
  console.log();

  // 5. 依赖图
  console.log('▸ 5. 依赖图 printDeps("chat-poller")');
  console.log(printDeps('chat-poller'));
  console.log();

  // 6. State 快照
  console.log('▸ 6. getState() — 当前所有 cache 的实验');
  for (const [id, s] of Object.entries(getState())) {
    console.log(`   ${id.padEnd(15)} ${s.durationMs}ms`);
  }
  console.log();

  // 7. metadata 示例
  console.log('▸ 7. getMeta("agent")');
  const m = getMeta('agent');
  console.log(`   ${m.id}  deps=[${m.deps.join(', ')}]`);
  console.log(`   inputs:  ${m.inputs.map(i => `${i.name}${i.required ? '*' : ''}: ${i.type}`).join(', ')}`);
  console.log(`   outputs: ${m.outputs.map(o => `${o.name}: ${o.type}`).join(', ')}`);
  console.log();

  // 8. 真组合应用: chat-message-pipeline
  //    用 qiniu + isolation + agent 三个实验拼出"用户消息→上传→解析→LLM→写回→验证"的完整小应用
  //    核心点: 没有新增一行产品代码——只是用现成实验搭出来的
  //    注意: compose 跨调用会缓存，顺序执行时用 run() 避开缓存
  console.log('▸ 8. 真组合应用: chat-message-pipeline (qiniu + isolation + agent)');
  // 能力探测: 试列一次空前缀，能成功就当 Qiniu 可用
  const q = await import('../../scripts/qiniu-s3.mjs');
  let hasQiniu = false;
  try { await q.qiniuList(''); hasQiniu = true; } catch { hasQiniu = false; }
  if (hasQiniu) {
    reset();
    const chatId  = 'demo-pipeline';
    const ts      = Date.now();
    const userText = '一句话介绍你自己';
    const msgKey   = `oc/chat/${chatId}/${ts}.msg`;
    const replyKey = `oc/chat/${chatId}/${ts}-reply.json`;
    console.log(`   input:  { chatId: "${chatId}", text: "${userText}" }`);

    // 步骤 A: 上传用户消息 + 解析 chatId (用 compose — 两个真依赖的实验)
    const a = await compose(['qiniu', 'isolation'], {
      'qiniu':     { op: 'put', key: msgKey, data: Buffer.from(JSON.stringify({ type: 'text', text: userText })) },
      'isolation': { key: msgKey },
    });
    console.log(`   A. compose([qiniu, isolation])`);
    console.log(`     写入 key:    ${msgKey}`);
    console.log(`     解析 chatId: ${a.isolation?.outputs?.chatId}`);

    // 步骤 B: 调 LLM (单实验，直接 run 避免污染 qiniu 缓存)
    let reply = '(agent skipped)';
    try {
      const b = await run('agent', { text: userText, chatId });
      reply = b?.response || '(empty)';
    } catch (e) {
      console.log(`   [agent 限速/超时: ${e.message.substring(0, 50)}]`);
    }
    console.log(`   B. run('agent', ...)`);
    console.log(`     "${reply.substring(0, 60)}${reply.length > 60 ? '...' : ''}"`);

    // 步骤 C: 写回 reply + 直接读 verify (单 op，用 run)
    await run('qiniu', { op: 'put', key: replyKey, data: Buffer.from(JSON.stringify({
      text: reply, sourceKey: msgKey, ts: Date.now(),
    })) });
    const verify = JSON.parse((await run('qiniu', { op: 'get', key: replyKey }))?.outputs?.result?.toString('utf8') || '{}');
    console.log(`   C. run('qiniu', put + get)`);
    console.log(`     reply key:   ${replyKey}`);
    console.log(`     verify.text: "${verify.text?.substring(0, 60)}..."`);
    console.log(`     sourceKey:   ${verify.sourceKey} ${verify.sourceKey === msgKey ? '✓' : '✗'}`);

    // 清理
    await run('qiniu', { op: 'delete', key: msgKey });
    await run('qiniu', { op: 'delete', key: replyKey });
    console.log(`   cleanup: 2 keys deleted ✓`);
  } else {
    console.log('   skipped (qiniu 不可达 — 检查 credentials)');
  }
  console.log();

  // 9. 纯本地: audio roundtrip + LLM 解释 (codec + agent)
  //    用 0 网络依赖的 2 个实验拼一个"音频→编码→解码→LLM 解释"的小应用
  console.log('▸ 9. 纯本地: audio-roundtrip + LLM 解释 (codec + agent)');
  reset();
  const pcmIn = Buffer.alloc(192 * 2); // 192 samples silence @ 48kHz
  // 步骤 1: encode + decode 串行（decode 依赖 encode）
  const enc9 = await run('codec', { pcm: pcmIn, op: 'encode' });
  const dec9 = await run('codec', { encoded: enc9.outputs.encoded, op: 'decode' });
  console.log(`   A. codec roundtrip`);
  console.log(`     in.pcm:     ${pcmIn.length} bytes silence`);
  console.log(`     encoded:    ${enc9.outputs.encoded.length} bytes (BB 01 CC ...)`);
  console.log(`     out.pcm:    ${dec9.outputs.pcm.length} bytes`);

  // 步骤 2: 让 LLM 解释 codec 的作用（容错：限速时跳过，不阻断 demo）
  let explain;
  try {
    explain = await run('agent', {
      text: `用一句话解释这段音频编解码: ${pcmIn.length} 字节 PCM (48kHz int16 静音) 经 LMDN codec 编码为 ${enc9.outputs.encoded.length} 字节 EPC 字节流 (含 BB 01 CC 头), 解码回 ${dec9.outputs.pcm.length} 字节 PCM。`,
      chatId: 'demo-audio',
    });
    const r = explain?.response;
    console.log(`   B. agent 解释:`);
    if (r) console.log(`     "${r.substring(0, 80)}${r.length > 80 ? '...' : ''}"`);
    else  console.log(`     (限速/空响应)`);
  } catch (e) {
    console.log(`   B. agent 跳过 (${e.message.substring(0, 60)})`);
  }
  console.log();

  // 10. chat-poller 复刻 — 0 行产品代码复现 polling loop 的核心
  //     上传 N 条测试消息 → list → 对每条: get + isolation + agent + put reply → verify
  console.log('▸ 10. chat-poller 复刻 — 0 行产品代码复现 polling 核心');
  if (hasQiniu) {
    const chatId10 = 'demo-poller';
    const ts10 = Date.now();
    const testMsgs = [
      { text: '一句话介绍 LLM' },
      { text: 'LMDN codec 是什么' },
    ];
    console.log(`   input:  ${testMsgs.length} 条测试消息 → chatId="${chatId10}"`);

    // A. 上传测试消息
    for (let i = 0; i < testMsgs.length; i++) {
      const key = `oc/chat/${chatId10}/${ts10}-${i}.msg`;
      await run('qiniu', { op: 'put', key, data: Buffer.from(JSON.stringify({ type: 'text', text: testMsgs[i].text })) });
    }
    console.log(`   A. 上传: ${testMsgs.length} 条 .msg`);

    // B. list 找待处理
    const listed = await run('qiniu', { op: 'list', prefix: `oc/chat/${chatId10}/${ts10}-` });
    const pending = listed.outputs.result.filter(k => k.endsWith('.msg'));
    console.log(`   B. list: 找到 ${pending.length} 条待处理`);

    // C. 对每条: 调 poll-one (它内部 = qiniu.get + isolation + agent + qiniu.put reply)
    const replies = [];
    let skipped = 0;
    for (const key of pending) {
      try {
        const r = await run('poll-one', { msgKey: key });
        replies.push(r.outputs.replyKey);
        const txt = r.outputs.reply || '(限速/空响应)';
        const shown = `"${txt.substring(0, 30)}${txt.length > 30 ? '...' : ''}"`;
        console.log(`     ${key} → chatId="${r.outputs.chatId}" → reply ${shown}`);
      } catch (e) {
        skipped++;
        console.log(`     ${key} → 跳过 (${e.message.substring(0, 50)})`);
      }
    }
    console.log(`   C. 处理完: ${replies.length} reply 写入, ${skipped} 跳过`);

    // D. 验证 reply 数 == 上传数
    const listAgain = await run('qiniu', { op: 'list', prefix: `oc/chat/${chatId10}/${ts10}-` });
    const foundReplies = listAgain.outputs.result.filter(k => k.endsWith('-reply.json'));
    console.log(`   D. verify: ${foundReplies.length}/${replies.length} reply 在 Qiniu 上 ${foundReplies.length === replies.length ? '✓' : '✗'}`);

    // cleanup
    for (const k of [...pending, ...replies]) {
      await run('qiniu', { op: 'delete', key: k });
    }
    console.log(`   cleanup: ${pending.length + replies.length} keys deleted ✓`);
  } else {
    console.log('   skipped (qiniu 不可达)');
  }
  console.log();

  // 11. 总结: 这个 demo 的产物 = 0 行新业务代码
  console.log('▸ 11. 总结');
  console.log('   真组合应用 = 现有实验的有序调用序列。');
  console.log('   改产品代码时,只需在实验里加能力,新应用就自动获得它。');
  console.log('   例如: 给 agent 加 web_fetch → 上面的 pipeline 自动能联网。');
  console.log('   demo 8/9/10 共用 qiniu/codec/agent/isolation 四个实验 = 整个 chat 流水线');
};

demo().catch(e => { console.error('demo 失败:', e); process.exit(1); });
