/**
 * TopicRegistry — distributed topic-based peer discovery
 * 分布式 topic 注册中心：每个节点共同维护注册表
 *
 * 不是单机 Map，而是每个节点本地存一份，
 * 通过 gossip 广播注册/注销事件，所有节点最终一致。
 *
 * 没有单点故障，没有中心服务器。
 */

import { EventEmitter } from 'events';

class TopicRegistry extends EventEmitter {
  constructor(options = {}) {
    super();
    this.ttl = options.ttl || 120_000;
    this._topics = new Map(); // topic → Map<peerId, info>
    this._p2p = null; // 外部注入的 p2p 发送函数
    this._timer = setInterval(() => this._cleanup(), 30_000);
    this._timer.unref();
  }

  /** 注入 P2P 发送能力 */
  setP2PSend(sendFn) {
    this._p2p = sendFn;
  }

  /** 注册本节点到 topic，并广播给所有已知节点 */
  announce(topic, peerId, info = {}) {
    const now = Date.now();
    if (!this._topics.has(topic)) this._topics.set(topic, new Map());
    this._topics.get(topic).set(peerId, { info, lastSeen: now, source: peerId });

    // 广播给其他节点：让它们也存我这个注册
    if (this._p2p) {
      this._p2p({
        type: 'topic_announce',
        topic, peerId, info, timestamp: now,
      });
    }
    return { ok: true };
  }

  /** 查询某个 topic 的节点列表（本地 + 即从其他节点拉） */
  async getPeers(topic, excludePeerId = null) {
    const local = this._getLocalPeers(topic, excludePeerId);

    // 如果有 P2P 能力，从其他节点同步一次
    if (this._p2p) {
      try {
        const remote = await this._p2p({
          type: 'topic_query',
          topic, excludePeerId, timestamp: Date.now(),
          expectResponse: true,
        });
        // 合并远程结果（去重）
        if (Array.isArray(remote)) {
          for (const r of remote) {
            if (r.peerId === excludePeerId) continue;
            if (!local.find(l => l.peerId === r.peerId)) local.push(r);
          }
        }
      } catch {}
    }
    return local;
  }

  /** 处理收到的 topic 广播 */
  handleMessage(msg) {
    if (!msg || !msg.topic || !msg.peerId) return;

    const now = Date.now();
    if (!this._topics.has(msg.topic)) this._topics.set(msg.topic, new Map());
    const peers = this._topics.get(msg.topic);
    const existing = peers.get(msg.peerId);

    // LWW：保留较新的
    if (!existing || (msg.timestamp || 0) > (existing.lastSeen || 0)) {
      peers.set(msg.peerId, {
        info: msg.info || {},
        lastSeen: msg.timestamp || now,
        source: msg.source || msg.peerId,
      });
    }

    // 如果是查询请求，回复本地数据
    if (msg.type === 'topic_query' && this._p2p && msg.expectResponse) {
      const local = this._getLocalPeers(msg.topic, msg.excludePeerId);
      return local; // 调用方通过 promise 拿到这个返回值
    }
  }

  /** 离开 topic */
  leave(topic, peerId) {
    const peers = this._topics.get(topic);
    if (peers) peers.delete(peerId);
    if (this._p2p) {
      this._p2p({ type: 'topic_leave', topic, peerId, timestamp: Date.now() });
    }
    return { ok: true };
  }

  _getLocalPeers(topic, excludePeerId) {
    const peers = this._topics.get(topic);
    if (!peers) return [];
    const now = Date.now();
    const result = [];
    for (const [peerId, data] of peers) {
      if (peerId === excludePeerId) continue;
      if (now - data.lastSeen < this.ttl) {
        result.push({ peerId, ...data.info, lastSeen: data.lastSeen });
      }
    }
    return result;
  }

  _cleanup() {
    const now = Date.now();
    for (const [topic, peers] of this._topics) {
      for (const [peerId, data] of peers) {
        if (now - data.lastSeen > this.ttl) peers.delete(peerId);
      }
      if (peers.size === 0) this._topics.delete(topic);
    }
  }
}

export default TopicRegistry;
export { TopicRegistry };
