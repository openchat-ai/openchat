import logger from '../core/monitoring/logger.js';
/**
 * PeerRegistry — 多核心 Peer 注册调度器
 *
 * 职责：
 *  - cores[] 按顺序尝试 discoverPeers()（第一个成功的返回）
 *  - publishPeer() 写入所有 backend
 *  - unpublishPeer() 所有 backend 下架
 */
class PeerRegistry {
  /**
   * @param {Array<{discover: Function, publish: Function, unpublish: Function}>} backends
   * @param {string} peerId  本节点标识
   */
  constructor(backends, peerId) {
    this.backends = backends;
    this.peerId = peerId;
  }

  /**
   * 从各 backend 依次发现在线节点，返回合并后的去重列表。
   * 第一个有结果的 backend 即返回，不再 fallback。
   */
  async discoverPeers() {
    for (const backend of this.backends) {
      try {
        const peers = await backend.discover();
        if (Array.isArray(peers) && peers.length > 0) {
          return peers;
        }
      } catch (e) {
        // 单个 backend 失败，继续 fallback
      }
    }
    return [];
  }

  /**
   * 向所有 backend 注册本节点
   */
  async publishPeer(info) {
    const results = await Promise.allSettled(
      this.backends.map(b => b.publish(this.peerId, info))
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        logger.info(`[PeerRegistry] publish failed: ${r.reason?.message || r.reason}`);
      }
    }
  }

  /**
   * 从所有 backend 注销本节点
   */
  async unpublishPeer() {
    const results = await Promise.allSettled(
      this.backends.map(b => b.unpublish(this.peerId))
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        logger.info(`[PeerRegistry] unpublish failed: ${r.reason?.message || r.reason}`);
      }
    }
  }
}

export default PeerRegistry;
export { PeerRegistry };
