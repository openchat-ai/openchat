// scorer.mjs — E39 评分
//
// 评分维度 (8 个):
//   1. sourceExtracted: 抽到了 ```js 代码块
//   2. functionShapeOk: 声明了 async function mqttSubscribe
//   3. renderConnectCalled: 源码里出现 renderConnect(...)
//   4. renderConnectArgsOk: 调 renderConnect 时 json 跟 expected 匹配
//   5. renderSubscribeCalled: 源码里出现 renderSubscribe(...)
//   6. renderSubscribeArgsOk: 调 renderSubscribe 时 json 跟 expected 匹配
//   7. sandboxRan: 沙盒跑通, 没崩
//   8. packetsSentCorrect: mock socket 收到的字节是 CONNECT + SUBSCRIBE (且跟 expected 完全等)
//
// 期望用于:
//   - dryRun: 用一个手写的 'good' 源码 + 'bad' 源码验证 scorer 函数
//   - live: LLM 真实输出 → scorer 评分

import { extractSource, findToolCalls, checkFunctionShape, jsonMatches } from './extractor.mjs';
import { runSandboxV2 } from './sandbox.mjs';
import { render } from './renderer.mjs';

// 用于跟 LLM 输出比 (LLM 不写 type, executor 填)
const COMPARE_CONNECT_ARGS = {
  protoName: 'MQTT',
  protoLevel: 4,
  connectFlags: { cleanSession: true },
  keepAlive: 60,
  clientId: '<from arg>',
};
const COMPARE_SUBSCRIBE_ARGS = {
  packetId: 1,
  subscriptions: [{ topic: '<from arg>', qos: 1 }],
};

// 用于 renderer 实际渲染 (需要 type)
const RENDER_CONNECT_ARGS = {
  type: 'CONNECT',
  protoName: 'MQTT',
  protoLevel: 4,
  connectFlags: { cleanSession: true },
  keepAlive: 60,
  clientId: 'test-123',
};
const RENDER_SUBSCRIBE_ARGS = {
  type: 'SUBSCRIBE',
  packetId: 1,
  subscriptions: [{ topic: 'sensor/+', qos: 1 }],
};

function deepEqualBuffers(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function score(text) {
  const src = extractSource(text);
  const shape = checkFunctionShape(src);
  const calls = findToolCalls(src);

  const rcMatch = calls.renderConnect
    ? jsonMatches(calls.renderConnect, COMPARE_CONNECT_ARGS)
    : { match: false, reason: 'renderConnect not called' };
  const rsMatch = calls.renderSubscribe
    ? jsonMatches(calls.renderSubscribe, COMPARE_SUBSCRIBE_ARGS)
    : { match: false, reason: 'renderSubscribe not called' };

  // 沙盒跑
  return runSandboxV2(src).then((sb) => {
    // 分析沙盒跑出来的 packets
    let connectSent = null, subscribeSent = null;
    for (const p of sb.packets || []) {
      if (p.type === 0x10 && !connectSent) connectSent = p.bytes;
      else if (p.type === 0x82 && !subscribeSent) subscribeSent = p.bytes;
    }
    // 跟 expected 比
    const expectedConnect = Array.from(render(RENDER_CONNECT_ARGS));
    const expectedSubscribe = Array.from(render(RENDER_SUBSCRIBE_ARGS));
    const connectBytesOk = connectSent && deepEqualBuffers(connectSent, expectedConnect);
    const subscribeBytesOk = subscribeSent && deepEqualBuffers(subscribeSent, expectedSubscribe);

    return {
      sourceExtracted: !!src,
      functionShapeOk: shape.declared && shape.async && shape.namedMqttSubscribe,
      renderConnectCalled: !!calls.renderConnect && !calls.renderConnect._parseError,
      renderConnectArgsOk: rcMatch.match,
      renderSubscribeCalled: !!calls.renderSubscribe && !calls.renderSubscribe._parseError,
      renderSubscribeArgsOk: rsMatch.match,
      sandboxRan: !sb.error,
      packetsSentCorrect: connectBytesOk && subscribeBytesOk,
      // 调试信息
      _debug: {
        source: src || null,
        renderConnectCall: calls.renderConnect,
        renderSubscribeCall: calls.renderSubscribe,
        rcReason: rcMatch.reason,
        rsReason: rsMatch.reason,
        sandboxError: sb.error,
        packetsCount: sb.packets?.length || 0,
        allWrittenLength: sb.allWrittenLength,
      },
    };
  });
}

export function aggregateScores(scores) {
  if (scores.length === 0) return null;
  const dims = [
    'sourceExtracted', 'functionShapeOk',
    'renderConnectCalled', 'renderConnectArgsOk',
    'renderSubscribeCalled', 'renderSubscribeArgsOk',
    'sandboxRan', 'packetsSentCorrect',
  ];
  const acc = {};
  for (const d of dims) acc[d] = 0;
  for (const s of scores) {
    for (const d of dims) acc[d] += s[d] ? 1 : 0;
  }
  const n = scores.length;
  const out = { n };
  for (const d of dims) out[d] = acc[d] / n;
  return out;
}
