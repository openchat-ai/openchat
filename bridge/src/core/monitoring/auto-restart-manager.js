import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import logger from '../monitoring/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * AutoRestartManager 类：自动重启机制
 *
 * 功能拆分（2026-04-24）：
 * - 文件监听 + 自动重启：默认禁用（开发模式用）
 * - 父子进程管理：默认启用（始终有效）
 *
 * 与 HotUpdateManager 的关系：
 * - HotUpdateManager: 生产环境热更新（动态加载，不杀进程）
 * - AutoRestartManager: 保留父子进程管理，文件监听默认关闭
 *
 * 使用方式：
 * - 生产环境：不启用文件监听，用 HotUpdateManager
 * - 开发环境：启用文件监听（startWatching），自动重启
 */
class AutoRestartManager {
  constructor(watchDir = null, ignorePatterns = []) {
    this.watchDir = watchDir || process.cwd();
    this.ignorePatterns = ignorePatterns.length > 0
      ? ignorePatterns
      : ['node_modules', '.git', 'dist', '.claude', 'test', 'spec'];

    // 🔴 关键：文件监听默认关闭，与热更新冲突
    this.fileWatchingEnabled = false; // 默认禁用！

    this.watchers = new Map(); // 文件监听器
    this.isRunning = false;
    this.childProcess = null;
    this.restartCallback = null;
    this.lastRestartTime = null;
    this.debounceDelay = 1000; // 防抖延迟（毫秒）
    this.debounceTimer = null;
    this.changeQueue = []; // 等待处理的文件变化
    this.restartHistory = []; // 重启历史
  }

  /**
   * 是否应该忽略这个文件
   * @param {string} filePath - 文件路径
   * @returns {boolean} 是否应该忽略
   */
  shouldIgnore(filePath) {
    // 规范化路径为正斜杠
    const normalizedPath = filePath.replace(/\\/g, '/');
    return this.ignorePatterns.some(pattern => normalizedPath.includes(pattern));
  }

  /**
   * 应该监听的文件类型
   * @param {string} filePath - 文件路径
   * @returns {boolean} 是否应该监听
   */
  shouldWatch(filePath) {
    const ext = path.extname(filePath);
    const jsExtensions = ['.js', '.mjs', '.cjs'];
    return jsExtensions.includes(ext) && !this.shouldIgnore(filePath);
  }

  /**
   * 开始监听文件变化
   * ⚠️ 注意：默认关闭，与 HotUpdateManager 冲突
   *       如需启用，请在生产环境外使用，或确保 HotUpdateManager 未运行
   * @param {Function} callback - 重启回调函数
   * @param {boolean} forceEnable - 强制启用文件监听
   */
  startWatching(callback, forceEnable = false) {
    // 🔒 安全检查：默认禁止启用，除非明确指定
    if (!forceEnable && !this.fileWatchingEnabled) {
      logger.info('⚠️  文件监听已禁用（与热更新冲突）');
      logger.info('   如需启用：autoRestartManager.startWatching(cb, true)');
      logger.info('   或设置：autoRestartManager.fileWatchingEnabled = true');
      return;
    }

    this.restartCallback = callback;
    this.isRunning = true;

    logger.info(`🔍 开始监听文件变化: ${this.watchDir}`);
    logger.info(`⏭️  忽略模式: ${this.ignorePatterns.join(', ')}`);

    // 递归监听所有 JS 文件
    this.watchDirectory(this.watchDir);

    logger.info('✅ 文件监听已启动');
  }

  /**
   * 启用文件监听（谨慎使用）
   * @param {Function} callback - 重启回调函数
   */
  enableFileWatching(callback) {
    logger.info('⚠️  启用文件监听（生产环境建议关闭）');
    this.fileWatchingEnabled = true;
    this.startWatching(callback, true);
  }

  /**
   * 禁用文件监听
   */
  disableFileWatching() {
    this.fileWatchingEnabled = false;
    logger.info('🔒 文件监听已禁用');
  }

  /**
   * 递归监听目录
   * @param {string} dir - 目录路径
   */
  watchDirectory(dir) {
    try {
      const files = fs.readdirSync(dir);

      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          // 递归监听子目录
          if (!this.shouldIgnore(filePath)) {
            this.watchDirectory(filePath);
          }
        } else if (stat.isFile() && this.shouldWatch(filePath)) {
          // 监听 JS 文件
          this.watchFile(filePath);
        }
      }
    } catch (error) {
      logger.error(`❌ 监听目录失败: ${error.message}`);
    }
  }

  /**
   * 监听单个文件
   * @param {string} filePath - 文件路径
   */
  watchFile(filePath) {
    if (this.watchers.has(filePath)) {
      return; // 已经在监听
    }

    try {
      const watcher = fs.watch(filePath, (eventType, filename) => {
        if (eventType === 'change') {
          this.handleFileChange(filePath);
        }
      });

      this.watchers.set(filePath, watcher);
      logger.info(`📁 监听文件: ${path.relative(this.watchDir, filePath)}`);
    } catch (error) {
      logger.error(`❌ 监听文件失败: ${filePath} - ${error.message}`);
    }
  }

  /**
   * 处理文件变化
   * @param {string} filePath - 变化的文件路径
   */
  handleFileChange(filePath) {
    // 🔒 安全检查
    if (!this.fileWatchingEnabled) {
      return;
    }

    if (this.shouldIgnore(filePath)) {
      return;
    }

    logger.info(`📝 文件变化: ${path.relative(this.watchDir, filePath)}`);
    this.changeQueue.push(filePath);

    // 防抖处理：在 debounceDelay 毫秒内的多个变化只触发一次重启
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.triggerRestart();
    }, this.debounceDelay);
  }

  /**
   * 触发重启
   */
  triggerRestart() {
    if (!this.isRunning) {
      return;
    }

    // 检查是否太频繁（防止无限重启）
    const now = Date.now();
    if (this.lastRestartTime && now - this.lastRestartTime < 2000) {
      logger.info('⏱️  重启太频繁，跳过本次重启');
      return;
    }

    logger.info('\n🔄 触发应用重启...');
    logger.info(`   变化文件: ${this.changeQueue.join(', ')}`);

    this.changeQueue = [];
    this.restart();
  }

  /**
   * 执行重启
   */
  restart() {
    if (this.childProcess) {
      logger.info('🛑 杀死当前进程...');
      this.childProcess.kill();
      this.childProcess = null;
    }

    this.lastRestartTime = Date.now();

    const restartRecord = {
      timestamp: new Date().toISOString(),
      time: this.lastRestartTime,
    };
    this.restartHistory.push(restartRecord);

    if (this.restartCallback) {
      logger.info('🚀 启动新进程...');
      try {
        this.restartCallback();
        logger.info('✅ 应用已重启\n');
      } catch (error) {
        logger.error(`❌ 重启失败: ${error.message}`);
      }
    }
  }

  /**
   * 停止监听
   */
  stopWatching() {
    logger.info('🛑 停止文件监听...');
    this.isRunning = false;

    // 关闭所有监听器
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close();
      } catch (error) {
        // 忽略关闭错误
      }
    }

    this.watchers.clear();
    clearTimeout(this.debounceTimer);

    // 杀死子进程
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
    }

    logger.info('✅ 文件监听已停止');
  }

  /**
   * 通过 Privileged Agent 执行重启（安全的重启方式）
   * @param {Function} privilegedAgent - 特权代理函数
   * @returns {Promise<void>}
   */
  async restartWithPrivilegedAgent(privilegedAgent) {
    if (!this.isRunning) {
      return;
    }

    logger.info('🔐 通过特权代理执行重启...');

    try {
      await privilegedAgent.executeCommand('restart', {
        timestamp: new Date().toISOString(),
        reason: 'File change detected',
      });

      logger.info('✅ 特权重启完成');
    } catch (error) {
      logger.error(`❌ 特权重启失败: ${error.message}`);
    }
  }

  /**
   * 获取重启历史
   * @returns {Array} 重启历史记录
   */
  getRestartHistory() {
    return this.restartHistory;
  }

  /**
   * 获取重启统计
   * @returns {object} 统计信息
   */
  getStats() {
    const now = Date.now();
    const recentRestarts = this.restartHistory.filter(
      r => now - r.time < 3600000 // 最近 1 小时
    );

    return {
      isRunning: this.isRunning,
      fileWatchingEnabled: this.fileWatchingEnabled,  // 🔒 新增
      watchingDirectory: this.watchDir,
      watchingFileCount: this.watchers.size,
      totalRestarts: this.restartHistory.length,
      recentRestarts: recentRestarts.length,
      lastRestartTime: this.lastRestartTime
        ? new Date(this.lastRestartTime).toISOString()
        : null,
      ignorePatterns: this.ignorePatterns,
      note: this.fileWatchingEnabled
        ? '⚠️ 文件监听已启用（可能与热更新冲突）'
        : '🔒 文件监听已禁用（安全模式，使用热更新）'
    };
  }

  /**
   * 清空重启历史
   */
  clearHistory() {
    this.restartHistory = [];
  }

  /**
   * 生成监听报告
   * @returns {string} 可读的报告
   */
  generateReport() {
    const stats = this.getStats();
    const lines = [
      '╔════════════════════════════════════════════════════════╗',
      '║        自动重启监听报告                           ║',
      '╚════════════════════════════════════════════════════════╝',
      '',
      `状态: ${stats.isRunning ? '✅ 运行中' : '❌ 已停止'}`,
      `监听目录: ${stats.watchingDirectory}`,
      `监听文件数: ${stats.watchingFileCount}`,
      '',
      '重启统计:',
      `  总重启次数: ${stats.totalRestarts}`,
      `  最近 1 小时重启: ${stats.recentRestarts}`,
      `  最后重启时间: ${stats.lastRestartTime || '从未重启'}`,
      '',
      '忽略模式:',
      ...stats.ignorePatterns.map(p => `  - ${p}`),
    ];

    return lines.join('\n');
  }

  /**
   * 添加忽略模式
   * @param {string} pattern - 要忽略的模式
   */
  addIgnorePattern(pattern) {
    if (!this.ignorePatterns.includes(pattern)) {
      this.ignorePatterns.push(pattern);
    }
  }

  /**
   * 移除忽略模式
   * @param {string} pattern - 要移除的模式
   */
  removeIgnorePattern(pattern) {
    const index = this.ignorePatterns.indexOf(pattern);
    if (index > -1) {
      this.ignorePatterns.splice(index, 1);
    }
  }
}

export default AutoRestartManager;
