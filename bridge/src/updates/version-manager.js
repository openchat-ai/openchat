/**
 * Version Manager
 * 版本快照管理 - 保存版本历史，支持回滚
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class VersionManager {
  constructor(options = {}) {
    this.versionDir = options.versionDir || './data/versions';
    this.maxVersions = options.maxVersions || 20;
    this.currentVersion = options.currentVersion || '1.0.0';

    this.versions = new Map();
    this.ensureDirectory();
    this.loadVersionHistory();

    console.log(`[VersionManager] Initialized, current: ${this.currentVersion}, history: ${this.versions.size} versions`);
  }

  /**
   * 确保版本目录存在
   */
  ensureDirectory() {
    if (!fs.existsSync(this.versionDir)) {
      fs.mkdirSync(this.versionDir, { recursive: true });
    }
  }

  /**
   * 加载版本历史
   */
  loadVersionHistory() {
    try {
      const files = fs.readdirSync(this.versionDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.versionDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        this.versions.set(data.version, data);
      }

      console.log(`[VersionManager] Loaded ${this.versions.size} versions`);
    } catch (error) {
      console.error(`[VersionManager] Load error: ${error.message}`);
    }
  }

  /**
   * 创建新版本快照
   */
  async createSnapshot(version, metadata = {}) {
    const snapshot = {
      version,
      snapshotId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),

      // 代码快照（简化：存储哈希）
      codeHash: crypto.createHash('sha256').update('code').digest('hex'),

      // 配置快照
      configSnapshot: metadata.config || {},

      // 数据库快照（占位）
      dbSnapshot: null,

      // 性能基线
      performanceBaseline: metadata.performance || {
        responseTime: 100,
        memoryMB: 256,
        cpuPercent: 30
      },

      // 测试结果
      testResults: metadata.tests || {
        passed: 0,
        failed: 0,
        total: 0
      },

      // 部署信息
      deployedAt: null,
      status: 'snapshot'
    };

    // 保存
    const filePath = path.join(this.versionDir, `${version}.json`);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

    this.versions.set(version, snapshot);

    // 清理旧版本
    await this.cleanupOldVersions();

    console.log(`[VersionManager] Created snapshot for version ${version}`);
    return snapshot;
  }

  /**
   * 标记版本为已部署
   */
  async markDeployed(version) {
    const snapshot = this.versions.get(version);
    if (!snapshot) {
      throw new Error(`Version ${version} not found`);
    }

    snapshot.deployedAt = new Date().toISOString();
    snapshot.status = 'active';
    this.currentVersion = version;

    // 保存
    const filePath = path.join(this.versionDir, `${version}.json`);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

    console.log(`[VersionManager] Marked version ${version} as deployed`);
    return snapshot;
  }

  /**
   * 获取版本历史
   */
  getHistory(limit = 20) {
    const all = Array.from(this.versions.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return all.slice(0, limit);
  }

  /**
   * 获取特定版本
   */
  getVersion(version) {
    return this.versions.get(version) || null;
  }

  /**
   * 获取当前版本
   */
  getCurrentVersion() {
    return this.currentVersion;
  }

  /**
   * 回滚到指定版本
   */
  async rollbackTo(targetVersion) {
    const snapshot = this.versions.get(targetVersion);
    if (!snapshot) {
      throw new Error(`Version ${targetVersion} not found`);
    }

    // 检查快照是否完整
    if (!snapshot.codeHash) {
      throw new Error(`Version ${targetVersion} snapshot is incomplete`);
    }

    // 更新当前版本状态
    const currentSnapshot = this.versions.get(this.currentVersion);
    if (currentSnapshot) {
      currentSnapshot.status = 'rolled_back';
      currentSnapshot.rolledBackAt = new Date().toISOString();
    }

    // 标记目标版本
    snapshot.status = 'active';
    snapshot.rolledBackFrom = this.currentVersion;
    snapshot.rolledBackAt = new Date().toISOString();

    this.currentVersion = targetVersion;

    // 保存
    const filePath = path.join(this.versionDir, `${targetVersion}.json`);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

    console.log(`[VersionManager] Rolled back to version ${targetVersion}`);

    return {
      success: true,
      previousVersion: snapshot.rolledBackFrom,
      currentVersion: targetVersion
    };
  }

  /**
   * 清理旧版本
   */
  async cleanupOldVersions() {
    if (this.versions.size <= this.maxVersions) {
      return;
    }

    // 获取所有非活跃版本，按时间排序
    const oldVersions = Array.from(this.versions.values())
      .filter(v => v.status !== 'active')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 删除多余的
    const toDelete = oldVersions.slice(this.maxVersions - 1);
    for (const v of toDelete) {
      const filePath = path.join(this.versionDir, `${v.version}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.versions.delete(v.version);
        console.log(`[VersionManager] Cleaned up old version: ${v.version}`);
      }
    }
  }

  /**
   * 获取版本统计
   */
  getStats() {
    const all = Array.from(this.versions.values());

    return {
      total: all.length,
      active: all.filter(v => v.status === 'active').length,
      snapshot: all.filter(v => v.status === 'snapshot').length,
      rolledBack: all.filter(v => v.status === 'rolled_back').length,
      current: this.currentVersion
    };
  }
}

module.exports = VersionManager;