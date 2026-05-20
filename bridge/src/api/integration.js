import logger from '../core/logger.js';
/**
 * API Server Integration
 * 鐏?REST API 闂嗗棙鍨氶崚棰佸瘜缁嬪绨?
 */

import APIServer from '../api/server.js';
import P2PNet from '../p2p/p2p-net.js';
import AgentRoleFactory from '../agents/agent-role-factory.js';
import FeedbackAggregator from '../agents/feedback-aggregator.js';
import HotUpdateManager from '../updates/hot-update-manager.js';
import VersionManager from '../updates/version-manager.js';
import CompressionManager from '../optimization/compression.js';
import CacheManager from '../optimization/cache.js';
import CleanupManager from '../optimization/cleanup.js';

class OpenChatAPISystem {
  constructor(options = {}) {
    this.apiServer = null;
    this.P2PNet = null;

    // 閺嶇绺剧紒鍕
    this.agentFactory = AgentRoleFactory;
    this.feedbackAggregator = new FeedbackAggregator();
    this.hotUpdateManager = new HotUpdateManager(options.hotUpdate);
    this.versionManager = new VersionManager(options.version);
    this.compressionManager = new CompressionManager(options.compression);
    this.cacheManager = new CacheManager(options.cache);
    this.cleanupManager = new CleanupManager(options.cleanup);

    this.initialized = false;
  }

  /**
   * 閸掓繂顫愰崠鏍ㄥ閺堝绮嶆禒?
   */
  async initialize(config = {}) {
    logger.info('[API System] Initializing...');

    // 1. 閸氼垰濮?REST API 閺堝秴濮熼崳?
    this.apiServer = new APIServer({
      port: config.apiPort || 3001  // 娴ｈ法鏁ゆ稉宥呮倱缁旑垰褰涢柆鍨帳閸愯尙鐛?
    });
    await this.apiServer.start();

    // 2. 閸氼垰濮?P2P Swarm閿涘牆褰查柅澶涚礆
    if (config.enableP2P !== false) {
      this.P2PNet = new P2PNet({
        topic: config.p2pTopic || Buffer.from('openchat-v1')
      });
      // 瀵ゆ儼绻滈崥顖氬З閿涘瞼鐡戝鍛秹缂佹粌姘ㄧ紒?
      setTimeout(() => {
        this.P2PNet.start().catch(err => {
          logger.error('[API System] P2P start failed:', err.message);
        });
      }, 5000);
    }

    // 3. 閸掓繂顫愰崠鏍閺堫剛顓搁悶?
    await this.versionManager.createSnapshot('1.0.0', {
      config: config,
      performance: { responseTime: 100, memoryMB: 256 }
    });

    // 4. 閸氼垰濮╃€规碍婀″〒鍛倞
    if (config.autoCleanup !== false) {
      setInterval(() => {
        this.cleanupManager.cleanup(['cache', 'logs']).catch(console.error);
      }, 24 * 60 * 60 * 1000); // 濮ｅ繐銇?
    }

    this.initialized = true;
    logger.info('[API System] Initialized successfully');

    return {
      apiPort: config.apiPort || 3001,
      p2pEnabled: !!this.P2PNet
    };
  }

  /**
   * 閼惧嘲褰囩化鑽ょ埠閻樿埖鈧?
   */
  getStatus() {
    return {
      initialized: this.initialized,
      api: this.apiServer ? 'running' : 'stopped',
      p2p: this.P2PNet ? this.P2PNet.getStatus() : 'disabled',
      version: this.versionManager?.getCurrentVersion(),
      cache: this.cacheManager?.getStats(),
      resources: {
        compression: this.compressionManager?.getStatus(),
        cleanup: this.cleanupManager?.getRecommendations()
      }
    };
  }

  /**
   * 閸掓稑缂?Agent
   */
  createAgent(role, options) {
    return this.agentFactory.create(role, options);
  }

  /**
   * 閼辨艾鎮庨崣宥夘洯
   */
  aggregateFeedback(feedbackList, options) {
    return this.feedbackAggregator.aggregate(feedbackList, options);
  }

  /**
   * 閸嬫粍顒涢幍鈧張澶嬫箛閸?
   */
  async shutdown() {
    logger.info('[API System] Shutting down...');

    if (this.P2PNet) {
      await this.P2PNet.stop();
    }

    if (this.apiServer) {
      await this.apiServer.stop();
    }

    this.cacheManager?.destroy();
    this.initialized = false;

    logger.info('[API System] Shutdown complete');
  }
}

// 鐎电厧鍤崡鏇氱伐
const apiSystem = new OpenChatAPISystem();

export default apiSystem;
export { OpenChatAPISystem };
