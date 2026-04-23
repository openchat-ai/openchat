/**
 * API Server Integration
 * 将 REST API 集成到主程序
 */

import APIServer from '../api/server.js';
import P2PSwarm from '../p2p/swarm.js';
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
    this.p2pSwarm = null;

    // 核心组件
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
   * 初始化所有组件
   */
  async initialize(config = {}) {
    console.log('[API System] Initializing...');

    // 1. 启动 REST API 服务器
    this.apiServer = new APIServer({
      port: config.apiPort || 3001  // 使用不同端口避免冲突
    });
    await this.apiServer.start();

    // 2. 启动 P2P Swarm（可选）
    if (config.enableP2P !== false) {
      this.p2pSwarm = new P2PSwarm({
        topic: config.p2pTopic || Buffer.from('openchat-v1')
      });
      // 延迟启动，等待网络就绪
      setTimeout(() => {
        this.p2pSwarm.start().catch(err => {
          console.error('[API System] P2P start failed:', err.message);
        });
      }, 5000);
    }

    // 3. 初始化版本管理
    await this.versionManager.createSnapshot('1.0.0', {
      config: config,
      performance: { responseTime: 100, memoryMB: 256 }
    });

    // 4. 启动定期清理
    if (config.autoCleanup !== false) {
      setInterval(() => {
        this.cleanupManager.cleanup(['cache', 'logs']).catch(console.error);
      }, 24 * 60 * 60 * 1000); // 每天
    }

    this.initialized = true;
    console.log('[API System] Initialized successfully');

    return {
      apiPort: config.apiPort || 3001,
      p2pEnabled: !!this.p2pSwarm
    };
  }

  /**
   * 获取系统状态
   */
  getStatus() {
    return {
      initialized: this.initialized,
      api: this.apiServer ? 'running' : 'stopped',
      p2p: this.p2pSwarm ? this.p2pSwarm.getStatus() : 'disabled',
      version: this.versionManager?.getCurrentVersion(),
      cache: this.cacheManager?.getStats(),
      resources: {
        compression: this.compressionManager?.getStatus(),
        cleanup: this.cleanupManager?.getRecommendations()
      }
    };
  }

  /**
   * 创建 Agent
   */
  createAgent(role, options) {
    return this.agentFactory.create(role, options);
  }

  /**
   * 聚合反馈
   */
  aggregateFeedback(feedbackList, options) {
    return this.feedbackAggregator.aggregate(feedbackList, options);
  }

  /**
   * 停止所有服务
   */
  async shutdown() {
    console.log('[API System] Shutting down...');

    if (this.p2pSwarm) {
      await this.p2pSwarm.stop();
    }

    if (this.apiServer) {
      await this.apiServer.stop();
    }

    this.cacheManager?.destroy();
    this.initialized = false;

    console.log('[API System] Shutdown complete');
  }
}

// 导出单例
const apiSystem = new OpenChatAPISystem();

export default apiSystem;
export { OpenChatAPISystem };