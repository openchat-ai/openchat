import logger from '../core/monitoring/logger.js';
/**
 * Cleanup Manager
 * 智能清理 - 日志、缓存、旧版本
 */

const fs = require('fs');
const path = require('path');

class CleanupManager {
  constructor(options = {}) {
    this.dataDir = options.dataDir || './data';
    this.maxLogSize = options.maxLogSize || 100 * 1024 * 1024; // 100MB
    this.maxCacheAge = options.maxCacheAge || 7 * 24 * 60 * 60 * 1000; // 7 天
    this.maxOldVersions = options.maxOldVersions || 5;

    logger.info('[Cleanup] Manager initialized');
  }

  /**
   * 执行清理
   */
  async cleanup(targets = []) {
    const results = {
      startedAt: new Date().toISOString(),
      targets: {},
      totalFreedMB: 0
    };

    // 支持的目标
    const availableTargets = ['cache', 'logs', 'temp', 'oldVersions', 'all'];

    if (targets.includes('all')) {
      targets = availableTargets.filter(t => t !== 'all');
    }

    for (const target of targets) {
      if (!availableTargets.includes(target)) {
        results.targets[target] = { status: 'skipped', reason: 'unknown target' };
        continue;
      }

      try {
        let freedMB = 0;

        switch (target) {
          case 'cache':
            freedMB = await this.cleanupCache();
            break;
          case 'logs':
            freedMB = await this.cleanupLogs();
            break;
          case 'temp':
            freedMB = await this.cleanupTemp();
            break;
          case 'oldVersions':
            freedMB = await this.cleanupOldVersions();
            break;
        }

        results.targets[target] = { status: 'completed', freedMB };
        results.totalFreedMB += freedMB;

      } catch (error) {
        results.targets[target] = { status: 'error', error: error.message };
      }
    }

    results.completedAt = new Date().toISOString();
    logger.info(`[Cleanup] Completed, freed ${results.totalFreedMB.toFixed(2)}MB`);

    return results;
  }

  /**
   * 清理缓存
   */
  async cleanupCache() {
    const cacheDir = path.join(this.dataDir, 'cache');
    if (!fs.existsSync(cacheDir)) return 0;

    let freedBytes = 0;
    const now = Date.now();

    const cleanDir = (dir) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);

        if (stats.isDirectory()) {
          cleanDir(filePath);
        } else {
          // 检查年龄
          const age = now - stats.mtimeMs;
          if (age > this.maxCacheAge) {
            freedBytes += stats.size;
            fs.unlinkSync(filePath);
          }
        }
      }
    };

    cleanDir(cacheDir);
    return freedBytes / (1024 * 1024);
  }

  /**
   * 清理日志
   */
  async cleanupLogs() {
    const logDir = path.join(this.dataDir, 'logs');
    if (!fs.existsSync(logDir)) return 0;

    let freedBytes = 0;

    const files = fs.readdirSync(logDir);
    for (const file of files) {
      if (!file.endsWith('.log')) continue;

      const filePath = path.join(logDir, file);
      const stats = fs.statSync(filePath);

      // 检查大小
      if (stats.size > this.maxLogSize) {
        // 截断日志文件，保留最后 1000 行
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          const keptLines = lines.slice(-1000);
          const newContent = keptLines.join('\n');

          const oldSize = stats.size;
          fs.writeFileSync(filePath, newContent);
          freedBytes += (oldSize - newContent.length);
        } catch (error) {
          logger.error(`[Cleanup] Log truncate error: ${error.message}`);
        }
      }
    }

    return freedBytes / (1024 * 1024);
  }

  /**
   * 清理临时文件
   */
  async cleanupTemp() {
    const tempDir = path.join(this.dataDir, 'temp');
    if (!fs.existsSync(tempDir)) return 0;

    let freedBytes = 0;
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 小时

    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stats = fs.statSync(filePath);

      const age = now - stats.mtimeMs;
      if (age > maxAge) {
        freedBytes += stats.size;
        if (stats.isDirectory()) {
          fs.rmSync(filePath, { recursive: true });
        } else {
          fs.unlinkSync(filePath);
        }
      }
    }

    return freedBytes / (1024 * 1024);
  }

  /**
   * 清理旧版本
   */
  async cleanupOldVersions() {
    const versionsDir = path.join(this.dataDir, 'versions');
    if (!fs.existsSync(versionsDir)) return 0;

    let freedBytes = 0;

    // 获取所有版本文件
    const files = fs.readdirSync(versionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(versionsDir, f),
        mtime: fs.statSync(path.join(versionsDir, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime);

    // 只保留最新的几个
    if (files.length > this.maxOldVersions) {
      const toDelete = files.slice(this.maxOldVersions);

      for (const file of toDelete) {
        const stats = fs.statSync(file.path);
        freedBytes += stats.size;
        fs.unlinkSync(file.path);
      }
    }

    return freedBytes / (1024 * 1024);
  }

  /**
   * 获取清理建议
   */
  getRecommendations() {
    const recommendations = [];

    // 检查日志大小
    const logDir = path.join(this.dataDir, 'logs');
    if (fs.existsSync(logDir)) {
      const logFiles = fs.readdirSync(logDir)
        .filter(f => f.endsWith('.log'))
        .map(f => ({
          name: f,
          size: fs.statSync(path.join(logDir, f)).size
        }));

      const totalLogSize = logFiles.reduce((sum, f) => sum + f.size, 0);
      if (totalLogSize > this.maxLogSize * 0.8) {
        recommendations.push({
          target: 'logs',
          reason: 'Log files approaching size limit',
          potentialSavings: '20-50MB'
        });
      }
    }

    // 检查缓存
    const cacheDir = path.join(this.dataDir, 'cache');
    if (fs.existsSync(cacheDir)) {
      recommendations.push({
        target: 'cache',
        reason: 'Cache cleanup recommended',
        potentialSavings: '10-30MB'
      });
    }

    return recommendations;
  }
}

module.exports = CleanupManager;