// Experiment 13: Relay / MessageBus 基础设施
//
// - bucket-relay.js: 跨区域 Qiniu bucket 中继（多 bucket 选最近读写）
// - signal-relay.js: 单 bucket 信号中继（peer endpoint 交换）
// - message-bus.js:  Agent 间消息总线（pub/sub + sendTo/broadcast/reply/delegate）

import { create } from './lib/report.mjs';

export const META = { id: 'relay' };

export async function run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('relay.run: op required');

  if (op === 'subscribe' || op === 'publish' || op === 'send_to' || op === 'reply' || op === 'broadcast' || op === 'delegate') {
    const { messageBus } = await import('./lib/message-bus.js');
    switch (op) {
      case 'subscribe': {
        const unsub = messageBus.subscribe(args.topic, args.handler);
        return { outputs: { unsub } };
      }
      case 'publish': messageBus.publish(args.topic, args.data); return { outputs: { ok: true } };
      case 'send_to': messageBus.sendTo(args.from, args.to, args.content, args.ref); return { outputs: { ok: true } };
      case 'reply': messageBus.reply(args.targetMsg, args.content); return { outputs: { ok: true } };
      case 'broadcast': messageBus.broadcast(args.from, args.content); return { outputs: { ok: true } };
      case 'delegate': messageBus.delegate(args.from, args.to, args.content); return { outputs: { ok: true } };
    }
  }

  switch (op) {
    case 'best_write': {
      const { BucketRelay } = await import('./lib/bucket-relay.js');
      return { outputs: { result: (await _makeBucketRelay(args)).getBestWriteBucket() } };
    }
    case 'best_read': {
      const { BucketRelay } = await import('./lib/bucket-relay.js');
      return { outputs: { result: (await _makeBucketRelay(args)).getBestReadBucket() } };
    }
    default:
      throw new Error(`relay.run: unknown op "${op}"`);
  }
}

async function _makeBucketRelay(args) {
  const { BucketRelay } = await import('./lib/bucket-relay.js');
  const r = new BucketRelay(args.writer || { writeTo: async () => {} }, args.peerId || 'test');
  if (args.buckets) r._buckets = args.buckets;
  if (args.writeLatency) for (const [k, v] of Object.entries(args.writeLatency)) r._writeLatency.set(k, v);
  if (args.readLatency) for (const [k, v] of Object.entries(args.readLatency)) r._readLatency.set(k, v);
  return r;
}

const { ok, ng, skip, report } = create();
const NAME = 'Relay — bucket-relay / signal-relay / message-bus';

async function test() {
  // === bucket-relay ===
  try {
    const { BucketRelay } = await import('./lib/bucket-relay.js');
    ok('bucket-relay.js 可加载');
    const r = new BucketRelay({ writeTo: async () => {}, readFrom: async () => Buffer.alloc(0) }, 'test-peer');
    if (typeof r.init === 'function') ok('BucketRelay.init 存在');
    if (typeof r.probeAll === 'function') ok('BucketRelay.probeAll 存在');
    if (typeof r.getBestWriteBucket === 'function') ok('BucketRelay.getBestWriteBucket 存在');
    if (typeof r.getBestReadBucket === 'function') ok('BucketRelay.getBestReadBucket 存在');
    if (typeof r.writeAudio === 'function') ok('BucketRelay.writeAudio 存在');
    if (typeof r.readAudio === 'function') ok('BucketRelay.readAudio 存在');

    // 选最近 bucket：构造 3 个 bucket 不同的写延迟
    r._buckets = [
      { name: 'b1', region: 'r1' },
      { name: 'b2', region: 'r2' },
      { name: 'b3', region: 'r3' },
    ];
    r._writeLatency.set('b1', 100);
    r._writeLatency.set('b2', 50);
    r._writeLatency.set('b3', 200);
    const w = r.getBestWriteBucket();
    if (w && w.name === 'b2') ok('getBestWriteBucket → 最低延迟 b2');
    else ng(`getBestWriteBucket 错: ${w?.name}`);

    r._readLatency.set('b1', 30);
    r._readLatency.set('b2', 80);
    r._readLatency.set('b3', 60);
    const rd = r.getBestReadBucket();
    if (rd && rd.name === 'b1') ok('getBestReadBucket → 最低延迟 b1');
    else ng(`getBestReadBucket 错: ${rd?.name}`);

    // 跨 region sync 配置 (文档化)
    if (typeof r._enableCrossRegionSync === 'function') ok('_enableCrossRegionSync 存在');
  } catch (e) {
    ng('bucket-relay 验证失败', e);
  }

  // === signal-relay ===
  try {
    const { SignalRelay } = await import('./lib/signal-relay.js');
    ok('signal-relay.js 可加载');
    const sr = new SignalRelay({ writeTo: async () => {}, readFrom: async () => null }, 'peer-x');
    if (typeof sr.init === 'function') ok('SignalRelay.init 存在');
    if (typeof sr.write === 'function') ok('SignalRelay.write 存在');
    if (typeof sr.read === 'function') ok('SignalRelay.read 存在');

    // 无 bucket 时 write/read 应安全 no-op
    sr.bucket = null;
    const w = await sr.write('key', Buffer.from('x'));
    if (w === undefined) ok('write 无 bucket → 安全 no-op');
    else ng(`write 无 bucket 返回: ${w}`);
    const rd = await sr.read('key');
    if (rd === null) ok('read 无 bucket → 返回 null');
    else ng(`read 无 bucket 返回: ${rd}`);

    // 有 bucket 时调用 qs
    let written = null, readKey = null;
    sr.bucket = { name: 'b', region: 'r' };
    sr.qs = { writeTo: async (b, k, d) => { written = { b, k, d }; }, readFrom: async (b, k) => { readKey = { b, k }; return Buffer.from('hi'); } };
    await sr.write('k1', Buffer.from([1, 2, 3]));
    if (written && written.k === 'k1' && written.d.length === 3) ok('write 转发到 qs.writeTo');
    const r2 = await sr.read('k2');
    if (readKey && readKey.k === 'k2' && r2.toString() === 'hi') ok('read 转发到 qs.readFrom');
  } catch (e) {
    ng('signal-relay 验证失败', e);
  }

  // === message-bus ===
  try {
    const mb = await import('./lib/message-bus.js');
    ok('message-bus.js 可加载');

    if (mb.messageBus) ok('messageBus 单例存在');
    if (mb.default) ok('default 导出存在');
    if (mb.MessageBus) ok('MessageBus 类存在');

    const types = mb.MESSAGE_TYPES || {};
    const required = ['REQUEST', 'RESPONSE', 'BROADCAST', 'DELEGATE', 'RESULT', 'HEARTBEAT', 'TERMINATE'];
    for (const k of required) {
      if (types[k]) ok(`MESSAGE_TYPES.${k} = ${types[k]}`);
      else ng(`MESSAGE_TYPES.${k} 缺失`);
    }

    // pub/sub
    const bus = new mb.MessageBus();
    let received = null;
    const unsub = bus.subscribe('test:topic', msg => { received = msg; });
    bus.publish('test:topic', { hello: 'world' });
    if (received && received.hello === 'world') ok('subscribe + publish 工作');
    else ng(`pub/sub 失败: ${JSON.stringify(received)}`);
    unsub();
    received = null;
    bus.publish('test:topic', { hello: 'again' });
    if (received === null) ok('unsubscribe 后不再收到');
    else ng('unsubscribe 失效');

    // sendTo / reply
    let recvTo = null;
    bus.subscribe('agent:bob', m => { recvTo = m; });
    bus.sendTo('alice', 'bob', 'hi bob');
    if (recvTo && recvTo.from === 'alice' && recvTo.to === 'bob' && recvTo.content === 'hi bob') ok('sendTo alice→bob');
    else ng(`sendTo 失败: ${JSON.stringify(recvTo)}`);

    let recvReply = null;
    bus.subscribe('agent:alice', m => { recvReply = m; });
    bus.reply(recvTo, 'hi alice back');
    if (recvReply && recvReply.from === 'bob' && recvReply.to === 'alice' && recvReply.content === 'hi alice back' && recvReply.replyTo === recvTo.id) ok('reply 含 replyTo');
    else ng(`reply 失败: ${JSON.stringify(recvReply)}`);

    // broadcast
    let recvBc = null;
    bus.subscribe('agent:broadcast:carol', m => { recvBc = m; });
    bus.broadcast('carol', 'hello everyone');
    if (recvBc && recvBc.from === 'carol' && recvBc.to === '*') ok('broadcast');
    else ng(`broadcast 失败: ${JSON.stringify(recvBc)}`);

    // delegate
    let recvDel = null;
    bus.subscribe('agent:dave', m => { recvDel = m; });
    bus.delegate('eve', 'dave', { task: 'compute' });
    if (recvDel && recvDel.type === mb.MESSAGE_TYPES.DELEGATE && recvDel.content.task === 'compute') ok('delegate');
    else ng(`delegate 失败: ${JSON.stringify(recvDel)}`);
  } catch (e) {
    ng('message-bus 验证失败', e);
  }

  report(NAME);
}

export { test };
