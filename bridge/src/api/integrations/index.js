import logger from '../../core/monitoring/logger.js';
/**
 * API Integrations
 * 连接 API 路由与核心模块
 * 使用动态导入兼容 ESM 和 CommonJS 模块
 */

// 全局实例缓存
let coordinatorInstance = null;
let versionManagerInstance = null;
let hotUpdateManagerInstance = null;

/**
 * 获取多代理协调器实例
 */
export async function getMultiAgentCoordinator() {
  if (!coordinatorInstance) {
    const { MultiAgentCoordinator } = await import('../../core/multi-agent-coordinator.js');
    coordinatorInstance = new MultiAgentCoordinator();
  }
  return coordinatorInstance;
}

/**
 * 获取版本管理器实例
 */
export async function getVersionManager() {
  if (!versionManagerInstance) {
    const { default: VersionManager } = await import('../../updates/version-manager.js');
    versionManagerInstance = new VersionManager({
      versionDir: './data/versions',
      maxVersions: 20
    });
  }
  return versionManagerInstance;
}

/**
 * 获取热更新管理器实例
 */
export async function getHotUpdateManager() {
  if (!hotUpdateManagerInstance) {
    const { default: HotUpdateManager } = await import('../../updates/hot-update-manager.js');
    hotUpdateManagerInstance = new HotUpdateManager({
      updateDir: './data/updates',
      watchdogIntervalMs: 5000,
      deepWatchdogIntervalMs: 30000
    });
  }
  return hotUpdateManagerInstance;
}

/**
 * 初始化所有集成
 */
export async function initializeIntegrations() {
  logger.info('[API] Initializing integrations...');

  try {
    await getMultiAgentCoordinator();
    logger.info('[API] ✓ MultiAgentCoordinator initialized');
  } catch (e) {
    logger.info('[API] ✗ MultiAgentCoordinator failed:', e.message);
  }

  try {
    await getVersionManager();
    logger.info('[API] ✓ VersionManager initialized');
  } catch (e) {
    logger.info('[API] ✗ VersionManager failed:', e.message);
  }

  try {
    await getHotUpdateManager();
    logger.info('[API] ✓ HotUpdateManager initialized');
  } catch (e) {
    logger.info('[API] ✗ HotUpdateManager failed:', e.message);
  }

  logger.info('[API] Integrations initialized');
}

export default {
  getMultiAgentCoordinator,
  getVersionManager,
  getHotUpdateManager,
  initializeIntegrations
};
