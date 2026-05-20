/**
 * P2P Peer Discovery
 * 节点发现服务
 */

const crypto = require('crypto');

class PeerDiscovery {
  constructor(options = {}) {
    this.swarm = options.swarm || null;
    this.peerId = options.peerId || crypto.randomBytes(16).toString('hex');
    this.knownPeers = new Map();
    this.discoveryInterval = options.discoveryInterval || 30000;
    this.discoveryTimer = null;
    this.listeners = [];
  }

  /**
   * 设置 Swarm 实例
   */
  setSwarm(swarm) {
    this.swarm = swarm;
  }

  /**
   * 开始发现
   */
  start() {
    if (!this.swarm) {
      console.warn('[PeerDiscovery] No swarm configured');
      return;
    }

    this.discover();
    this.discoveryTimer = setInterval(() => this.discover(), this.discoveryInterval);
    console.log('[PeerDiscovery] Started');
  }

  /**
   * 停止发现
   */
  stop() {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    console.log('[PeerDiscovery] Stopped');
  }

  /**
   * 执行发现
   */
  discover() {
    if (!this.swarm) return;

    try {
      const status = this.swarm.getStatus();

      // 添加发现的 peers
      if (status.connectedPeers > 0) {
        this.notifyListeners({
          type: 'peer-discovered',
          count: status.connectedPeers,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[PeerDiscovery] Error:', error.message);
    }
  }

  /**
   * 添加已知 peer
   */
  addPeer(peerId, address, metadata = {}) {
    const peer = {
      id: peerId,
      address,
      metadata,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      status: 'discovered'
    };

    this.knownPeers.set(peerId, peer);
    return peer;
  }

  /**
   * 更新 peer 状态
   */
  updatePeer(peerId, status) {
    const peer = this.knownPeers.get(peerId);
    if (peer) {
      peer.status = status;
      peer.lastSeen = Date.now();
      this.knownPeers.set(peerId, peer);
    }
  }

  /**
   * 移除 peer
   */
  removePeer(peerId) {
    this.knownPeers.delete(peerId);
  }

  /**
   * 获取所有已知 peers
   */
  getPeers(status = null) {
    if (status) {
      return Array.from(this.knownPeers.values()).filter(p => p.status === status);
    }
    return Array.from(this.knownPeers.values());
  }

  /**
   * 获取活跃 peers
   */
  getActivePeers() {
    return this.getPeers('connected');
  }

  /**
   * 注册监听器
   */
  on(event, callback) {
    this.listeners.push({ event, callback });
  }

  /**
   * 通知监听器
   */
  notifyListeners(data) {
    for (const listener of this.listeners) {
      if (listener.event === data.event || listener.event === '*') {
        try {
          listener.callback(data);
        } catch (error) {
          console.error('[PeerDiscovery] Listener error:', error.message);
        }
      }
    }
  }

  /**
   * 获取发现统计
   */
  getStats() {
    return {
      knownPeers: this.knownPeers.size,
      activePeers: this.getActivePeers().length,
      discoveryInterval: this.discoveryInterval
    };
  }
}

module.exports = PeerDiscovery;