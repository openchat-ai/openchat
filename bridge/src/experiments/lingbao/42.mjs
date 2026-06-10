// Experiment 42: mqtt-push — 告警推送模拟 (in-process, 无 broker)
// Manifest id: mqtt-push
// I/O: { op: 'publish'|'subscribe'|'history'|'stats', channel, payload?, handler? }

import { create } from '../lib/report.mjs';

export const META = {
  id: 'mqtt-push',
  name: 'MQTT-Push — 告警推送模拟 (in-process)',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: "publish | subscribe | history | stats" },
    { name: 'channel', type: 'string', required: false },
    { name: 'payload', type: 'object', required: false },
    { name: 'limit', type: 'number', required: false, default: 10 },
  ],
  outputs: [
    { name: 'deliveryId', type: 'string' },
    { name: 'ts', type: 'number' },
    { name: 'subscribers', type: 'number' },
    { name: 'history', type: 'array' },
    { name: 'stats', type: 'object' },
  ],
  deps: [],
  tags: ['lingbao', 'push', 'mqtt'],
};

// === invariants ===
// - 进程内单例 bus, 所有 op 共享
// - 内存队列每 channel 上限 100, FIFO
// - publish 同步返回 deliveryId + ts + subscribers 数
// - handler 抛异常被吞, 不影响其他订阅者
let _bus = null;
async function _getBus() {
  if (!_bus) {
    const { createBus } = await import('./lib/mqtt-push.mjs');
    _bus = createBus();
  }
  return _bus;
}

export async function run({ inputs = {} } = {}) {
  const { op, channel, payload, limit = 10 } = inputs;
  if (!op) throw new Error('mqtt-push.run: op required');
  const bus = await _getBus();

  switch (op) {
    case 'publish': {
      if (!channel) throw new Error('publish requires channel');
      return { outputs: bus.publish(channel, payload || {}) };
    }
    case 'subscribe': {
      // handler 通过预注册 map, run() 不接受函数参数
      throw new Error('subscribe 必须在 test() 或调用方直接用 bus.subscribe()');
    }
    case 'history': {
      if (!channel) throw new Error('history requires channel');
      return { outputs: { history: bus.history(channel, limit) } };
    }
    case 'stats': {
      return { outputs: { stats: bus.stats() } };
    }
    default:
      throw new Error(`mqtt-push.run: unknown op "${op}"`);
  }
}

// 暴露 bus 给 test 和外部高级用法
export async function getBus() { return _getBus(); }

const NAME = 'MQTT-Push — 告警推送';

async function test() {
  const { ok, ng, report } = create();
  const bus = await _getBus();

  // 1. publish 基本
  try {
    const r = bus.publish('alert/leak', { level: 50, location: 'A1' });
    if (r.deliveryId && r.deliveryId.length === 8) ok(`publish deliveryId=${r.deliveryId}`);
    else ng(`deliveryId 错: ${r.deliveryId}`);
    if (r.ts > 0) ok(`ts=${r.ts}`);
    else ng('ts 错');
  } catch (e) {
    ng('publish 失败', e);
  }

  // 2. publish 边界: 空 channel
  try {
    bus.publish('', { x: 1 });
    ng('空 channel 应抛');
  } catch (e) {
    ok(`空 channel 拦截: ${e.message.substring(0, 40)}`);
  }

  // 3. publish 边界: 非对象 payload
  try {
    bus.publish('test', 'string');
    ng('非对象 payload 应抛');
  } catch (e) {
    ok(`非对象 payload 拦截`);
  }

  // 4. subscribe + 收到消息
  try {
    let received = null;
    const sub = bus.subscribe('alert/test-sub', (msg) => { received = msg; });
    bus.publish('alert/test-sub', { foo: 'bar' });
    // handler 是 setImmediate 异步, 等 50ms
    await new Promise(r => setTimeout(r, 50));
    if (received && received.payload.foo === 'bar') ok(`subscribe 收到: ${received.deliveryId}`);
    else ng(`未收到: ${JSON.stringify(received)}`);
    sub.unsub();
  } catch (e) {
    ng('subscribe 失败', e);
  }

  // 5. 多个订阅者
  try {
    let a = 0, b = 0;
    const s1 = bus.subscribe('alert/multi', () => a++);
    const s2 = bus.subscribe('alert/multi', () => b++);
    bus.publish('alert/multi', { n: 1 });
    await new Promise(r => setTimeout(r, 50));
    if (a === 1 && b === 1) ok('多订阅者都收到');
    else ng(`a=${a} b=${b}`);
    s1.unsub(); s2.unsub();
  } catch (e) {
    ng('多订阅者失败', e);
  }

  // 6. handler 异常不影响其他订阅者
  try {
    let b = 0;
    const s1 = bus.subscribe('alert/throw', () => { throw new Error('boom'); });
    const s2 = bus.subscribe('alert/throw', () => b++);
    bus.publish('alert/throw', {});
    await new Promise(r => setTimeout(r, 50));
    if (b === 1) ok('handler 异常被吞, 其他订阅者正常');
    else ng(`b=${b}`);
    s1.unsub(); s2.unsub();
  } catch (e) {
    ng('handler 异常测试失败', e);
  }

  // 7. history
  try {
    for (let i = 0; i < 3; i++) bus.publish('alert/hist', { i });
    const h = bus.history('alert/hist', 5);
    if (h.length === 3) ok(`history 返回 ${h.length} 条`);
    else ng(`history 长度: ${h.length}`);
    if (h[0].payload.i === 2) ok('history 最新在前');
    else ng('history 顺序错');
  } catch (e) {
    ng('history 失败', e);
  }

  // 8. FIFO 上限 100
  try {
    const ch = 'alert/fifo';
    for (let i = 0; i < 110; i++) bus.publish(ch, { i });
    const h = bus.history(ch, 200);
    if (h.length === 100) ok(`FIFO 上限 100 生效, 实际 ${h.length}`);
    else ng(`FIFO 失效: ${h.length}`);
  } catch (e) {
    ng('FIFO 测试失败', e);
  }

  // 9. stats
  try {
    const s = bus.stats();
    if (typeof s.channels === 'number' && s.totalDelivered > 0) ok(`stats: channels=${s.channels}, totalDelivered=${s.totalDelivered}`);
    else ng(`stats 错: ${JSON.stringify(s)}`);
  } catch (e) {
    ng('stats 失败', e);
  }

  // 10. run() 契约
  try {
    const r = await run({ inputs: { op: 'publish', channel: 'alert/run-test', payload: { ok: true } } });
    if (r.outputs.deliveryId && r.outputs.deliveryId.length === 8) ok('run(publish) 契约 OK');
    else ng('run(publish) 输出错');
  } catch (e) {
    ng('run 失败', e);
  }

  report(NAME);
}

export { test };
