import { EventEmitter } from 'events';

class TopicRegistry extends EventEmitter {
  constructor(options = {}) {
    super();
    this.ttl = options.ttl || 120_000;
    this._topics = new Map();
    this._p2p = null;
    this._timer = setInterval(() => this._cleanup(), 30_000);
    this._timer.unref();
  }

  setP2PSend(fn) { this._p2p = fn; }

  announce(topic, peerId, info = {}) {
    if (!this._topics.has(topic)) this._topics.set(topic, new Map());
    this._topics.get(topic).set(peerId, { info, lastSeen: Date.now(), source: peerId });
    if (this._p2p) this._p2p({ type: 'topic_announce', topic, peerId, info, timestamp: Date.now() });
    return { ok: true };
  }

  async getPeers(topic, excludePeerId = null) {
    const local = this._getLocalPeers(topic, excludePeerId);
    if (this._p2p) {
      try {
        const remote = await this._p2p({ type: 'topic_query', topic, excludePeerId, timestamp: Date.now(), expectResponse: true });
        if (Array.isArray(remote)) {
          for (const r of remote) {
            if (r.peerId === excludePeerId) continue;
            if (!local.find(l => l.peerId === r.peerId)) local.push(r);
          }
        }
      } catch (e) {
        console.warn('[TopicRegistry] remote query failed:', e.message);
      }
    }
    return local;
  }

  handleMessage(msg) {
    if (!msg || !msg.topic || !msg.peerId) return;
    if (!this._topics.has(msg.topic)) this._topics.set(msg.topic, new Map());
    const peers = this._topics.get(msg.topic);
    const existing = peers.get(msg.peerId);
    if (!existing || (msg.timestamp || 0) > (existing.lastSeen || 0)) {
      peers.set(msg.peerId, { info: msg.info || {}, lastSeen: msg.timestamp || Date.now(), source: msg.source || msg.peerId });
    }
    if (msg.type === 'topic_query' && this._p2p) {
      return this._getLocalPeers(msg.topic, msg.excludePeerId);
    }
    if (msg.type === 'topic_leave') {
      const peers = this._topics.get(msg.topic);
      if (peers) peers.delete(msg.peerId);
    }
  }

  leave(topic, peerId) {
    const peers = this._topics.get(topic);
    if (peers) peers.delete(peerId);
    if (this._p2p) this._p2p({ type: 'topic_leave', topic, peerId, timestamp: Date.now() });
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
