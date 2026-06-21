// mqtt-push: 进程内 EventEmitter 模拟, 无外部 broker
// 用 crypto.randomBytes 生成 deliveryId

import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

// === invariants ===
// - deliveryId = 8 字符 hex, 单进程内唯一
// - 内存队列每 channel 上限 100, FIFO
// - publish 同步返回, handler 异步不影响
// - channel 区分大小写
const MAX_HISTORY = 100;

function newDeliveryId() {
  return randomBytes(4).toString('hex');
}

function createBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(1000);
  const history = new Map(); // channel -> Array<{deliveryId, ts, payload}>
  const stats = { totalDelivered: 0, publishCount: 0 };

  function publish(channel, payload) {
    if (!channel || typeof channel !== 'string') throw new RangeError('channel must be non-empty string');
    if (!payload || typeof payload !== 'object') throw new RangeError('payload must be object');
    const msg = { deliveryId: newDeliveryId(), ts: Date.now(), channel, payload };
    const list = history.get(channel) || [];
    list.push(msg);
    if (list.length > MAX_HISTORY) list.shift();
    history.set(channel, list);
    stats.totalDelivered++;
    stats.publishCount++;
    const subscriberCount = emitter.listenerCount(channel);
    setImmediate(() => emitter.emit(channel, msg));
    return { deliveryId: msg.deliveryId, ts: msg.ts, subscribers: subscriberCount };
  }

  function subscribe(channel, handler) {
    if (typeof handler !== 'function') throw new RangeError('handler must be function');
    const wrapped = (msg) => {
      try { handler(msg); } catch { /* 吞 handler 异常, 不影响其他订阅者 */ }
    };
    emitter.on(channel, wrapped);
    return {
      unsub: () => emitter.off(channel, wrapped),
      channel,
    };
  }

  function getHistory(channel, limit) {
    const list = history.get(channel) || [];
    const arr = limit ? list.slice(-limit) : list.slice();
    return arr.reverse(); // 最新在前
  }

  function getStats() {
    return {
      channels: history.size,
      totalDelivered: stats.totalDelivered,
      publishCount: stats.publishCount,
      subscribers: emitter.eventNames().reduce((sum, c) => sum + emitter.listenerCount(c), 0),
    };
  }

  return { publish, subscribe, history: getHistory, stats: getStats };
}

export { createBus };
export default { createBus };
