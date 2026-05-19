/**
 * TopicRegistry — lightweight topic-based peer discovery
 * 轻量级 topic 注册中心：节点按 topic 注册，同 topic 节点可互发现
 *
 * 替代 hyperswarm DHT 的 topic 发现能力。
 * 可独立部署为一台发现服务器，也可内嵌在每个 Bridge 中。
 *
 * API:
 *   POST /topic/announce  → 注册本节点到某个 topic
 *   GET  /topic/peers     → 查询某个 topic 的在线节点
 *   POST /topic/renew     → 刷新心跳（防过期）
 *   POST /topic/leave     → 离开 topic
 */
class TopicRegistry {
  constructor(options = {}) {
    this.ttl = options.ttl || 120_000; // 2 分钟无心跳自动过期
    this.cleanupInterval = options.cleanupInterval || 30_000;
    this._topics = new Map(); // topic → Map<peerId, { info, lastSeen }>
    this._timer = setInterval(() => this._cleanup(), this.cleanupInterval);
    this._timer.unref();
  }

  /** 注册本节点到 topic */
  announce(topic, peerId, info = {}) {
    if (!this._topics.has(topic)) this._topics.set(topic, new Map());
    const topicPeers = this._topics.get(topic);
    topicPeers.set(peerId, { info, lastSeen: Date.now() });
    return { ok: true, peersOnTopic: topicPeers.size };
  }

  /** 查询某个 topic 的在线节点列表 */
  getPeers(topic, excludePeerId = null) {
    const topicPeers = this._topics.get(topic);
    if (!topicPeers) return [];
    const now = Date.now();
    const result = [];
    for (const [peerId, data] of topicPeers) {
      if (peerId === excludePeerId) continue;
      if (now - data.lastSeen < this.ttl) {
        result.push({ peerId, ...data.info, lastSeen: data.lastSeen });
      }
    }
    return result;
  }

  /** 刷新心跳 */
  renew(topic, peerId) {
    const topicPeers = this._topics.get(topic);
    if (!topicPeers || !topicPeers.has(peerId)) return { ok: false, reason: 'not_found' };
    topicPeers.get(peerId).lastSeen = Date.now();
    return { ok: true };
  }

  /** 离开 topic */
  leave(topic, peerId) {
    const topicPeers = this._topics.get(topic);
    if (topicPeers) topicPeers.delete(peerId);
    return { ok: true };
  }

  /** 清理过期节点 */
  _cleanup() {
    const now = Date.now();
    for (const [topic, peers] of this._topics) {
      for (const [peerId, data] of peers) {
        if (now - data.lastSeen > this.ttl) peers.delete(peerId);
      }
      if (peers.size === 0) this._topics.delete(topic);
    }
  }

  getStats() {
    const stats = {};
    for (const [topic, peers] of this._topics) {
      stats[topic] = peers.size;
    }
    return stats;
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }
}

export default TopicRegistry;
export { TopicRegistry };
