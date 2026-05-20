import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { DEFAULT_PORT } from '../../constants.js';
import logger from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * SandboxManager 类：沙箱测试环境
 * 提供隔离的测试执行环境
 */
class SandboxManager {
  constructor(baseDir = null, config = {}) {
    // 默认存储位置：~/.openchat-sandbox/
    this.baseDir = baseDir || path.join(os.homedir(), '.openchat-sandbox');
    this.config = {
      basePort: DEFAULT_PORT,
      maxConcurrentSandboxes: 5,
      timeoutMs: 30000,
      enableNetworkIsolation: false,
      enableFileSystemIsolation: true,
      ...config,
    };

    this.sandboxes = new Map(); // 运行中的沙箱实例
    this.portPool = this.initializePortPool(); // 可用的端口池
    this.sandboxCounter = 0; // 沙箱计数器
    this.cleanupHistory = []; // 清理历史

    // 确保基础目录存在
    this.ensureDirectories();
  }

  /**
   * 确保必要的目录存在
   */
  ensureDirectories() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * 初始化端口池
   * @returns {Array} 可用的端口列表
   */
  initializePortPool() {
    const ports = [];
    for (let i = 0; i < this.config.maxConcurrentSandboxes; i++) {
      ports.push(this.config.basePort + i);
    }
    return ports;
  }

  /**
   * 创建新的沙箱实例
   * @param {object} options - 沙箱选项
   * @returns {object} 沙箱实例
   */
  async createSandbox(options = {}) {
    if (this.sandboxes.size >= this.config.maxConcurrentSandboxes) {
      throw new Error(
        `已达到最大沙箱数量 (${this.config.maxConcurrentSandboxes})`
      );
    }

    this.sandboxCounter++;
    const sandboxId = `sandbox-${this.sandboxCounter}`;

    // 分配独立端口
    const port = this.portPool.shift();
    if (!port) {
      throw new Error('没有可用的端口');
    }

    // 创建独立的数据目录
    const dataDir = path.join(this.baseDir, sandboxId);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const sandbox = {
      id: sandboxId,
      port,
      dataDir,
      status: 'created', // created, running, stopped, failed
      createdAt: new Date().toISOString(),
      startedAt: null,
      stoppedAt: null,
      process: null,
      isolationLevel: options.isolationLevel || 'medium',
      config: {
        enableNetworkIsolation: options.enableNetworkIsolation || false,
        enableFileSystemIsolation: options.enableFileSystemIsolation || true,
      },
      environment: {
        NODE_ENV: 'test',
        SANDBOX_ID: sandboxId,
        SANDBOX_PORT: port,
        SANDBOX_DATA_DIR: dataDir,
        ...options.environment,
      },
      stats: {
        commandsRun: 0,
        filesCreated: 0,
        fileSystem: {
          totalSize: 0,
          fileCount: 0,
        },
      },
    };

    this.sandboxes.set(sandboxId, sandbox);
    return sandbox;
  }

  /**
   * 启动沙箱
   * @param {string} sandboxId - 沙箱 ID
   * @param {object} options - 启动选项
   * @returns {Promise<object>} 启动结果
   */
  async startSandbox(sandboxId, options = {}) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`沙箱 ${sandboxId} 不存在`);
    }

    if (sandbox.status === 'running') {
      throw new Error(`沙箱 ${sandboxId} 已在运行`);
    }

    try {
      sandbox.status = 'running';
      sandbox.startedAt = new Date().toISOString();

      // 模拟启动沙箱进程
      // 在实际环境中，这里会使用 firejail 或 nsjail
      sandbox.process = {
        pid: Math.floor(Math.random() * 100000),
        running: true,
      };

      return {
        success: true,
        sandboxId,
        port: sandbox.port,
        dataDir: sandbox.dataDir,
        message: `沙箱 ${sandboxId} 已启动`,
      };
    } catch (error) {
      sandbox.status = 'failed';
      throw new Error(`启动沙箱失败: ${error.message}`);
    }
  }

  /**
   * 在沙箱中执行命令
   * @param {string} sandboxId - 沙箱 ID
   * @param {string} command - 要执行的命令
   * @returns {Promise<object>} 执行结果
   */
  async executeInSandbox(sandboxId, command) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`沙箱 ${sandboxId} 不存在`);
    }

    if (sandbox.status !== 'running') {
      throw new Error(`沙箱 ${sandboxId} 未运行`);
    }

    try {
      sandbox.stats.commandsRun++;

      // 执行命令（模拟）
      const result = {
        success: true,
        command,
        output: `Command executed in ${sandboxId}`,
        exitCode: 0,
        executionTime: Math.random() * 1000,
      };

      return result;
    } catch (error) {
      throw new Error(`执行命令失败: ${error.message}`);
    }
  }

  /**
   * 停止沙箱
   * @param {string} sandboxId - 沙箱 ID
   * @returns {Promise<object>} 停止结果
   */
  async stopSandbox(sandboxId) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`沙箱 ${sandboxId} 不存在`);
    }

    try {
      sandbox.status = 'stopped';
      sandbox.stoppedAt = new Date().toISOString();

      if (sandbox.process) {
        sandbox.process.running = false;
      }

      // 释放端口
      this.portPool.push(sandbox.port);

      return {
        success: true,
        sandboxId,
        message: `沙箱 ${sandboxId} 已停止`,
      };
    } catch (error) {
      throw new Error(`停止沙箱失败: ${error.message}`);
    }
  }

  /**
   * 清理沙箱（删除数据）
   * @param {string} sandboxId - 沙箱 ID
   * @returns {Promise<object>} 清理结果
   */
  async cleanupSandbox(sandboxId) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`沙箱 ${sandboxId} 不存在`);
    }

    try {
      // 停止沙箱
      if (sandbox.status === 'running') {
        await this.stopSandbox(sandboxId);
      }

      // 删除数据目录
      if (fs.existsSync(sandbox.dataDir)) {
        fs.rmSync(sandbox.dataDir, { recursive: true, force: true });
      }

      // 从管理器中移除
      this.sandboxes.delete(sandboxId);

      const cleanupRecord = {
        sandboxId,
        timestamp: new Date().toISOString(),
        duration: sandbox.stoppedAt
          ? new Date(sandbox.stoppedAt) - new Date(sandbox.startedAt)
          : null,
      };
      this.cleanupHistory.push(cleanupRecord);

      return {
        success: true,
        sandboxId,
        message: `沙箱 ${sandboxId} 已清理`,
      };
    } catch (error) {
      throw new Error(`清理沙箱失败: ${error.message}`);
    }
  }

  /**
   * 获取沙箱信息
   * @param {string} sandboxId - 沙箱 ID
   * @returns {object} 沙箱信息
   */
  getSandbox(sandboxId) {
    return this.sandboxes.get(sandboxId) || null;
  }

  /**
   * 获取所有沙箱
   * @returns {Array} 沙箱列表
   */
  getAllSandboxes() {
    return Array.from(this.sandboxes.values());
  }

  /**
   * 获取沙箱统计
   * @returns {object} 统计信息
   */
  getStats() {
    const sandboxes = this.getAllSandboxes();
    const runningCount = sandboxes.filter(s => s.status === 'running').length;
    const stoppedCount = sandboxes.filter(s => s.status === 'stopped').length;

    return {
      totalSandboxes: this.sandboxCounter,
      activeSandboxes: this.sandboxes.size,
      runningCount,
      stoppedCount,
      availablePorts: this.portPool.length,
      baseDirectory: this.baseDir,
      config: this.config,
      cleanupHistory: this.cleanupHistory.length,
    };
  }

  /**
   * 生成沙箱报告
   * @returns {string} 可读的报告
   */
  generateReport() {
    const stats = this.getStats();
    const sandboxes = this.getAllSandboxes();

    const lines = [
      '╔════════════════════════════════════════════════════════╗',
      '║        沙箱测试环境报告                           ║',
      '╚════════════════════════════════════════════════════════╝',
      '',
      '统计信息:',
      `  总沙箱数: ${stats.totalSandboxes}`,
      `  活跃沙箱: ${stats.activeSandboxes}`,
      `  运行中: ${stats.runningCount}`,
      `  已停止: ${stats.stoppedCount}`,
      `  可用端口: ${stats.availablePorts}`,
      `  清理历史: ${stats.cleanupHistory} 次`,
      '',
      '配置:',
      `  基础目录: ${stats.baseDirectory}`,
      `  基础端口: ${stats.config.basePort}`,
      `  最大并发: ${stats.config.maxConcurrentSandboxes}`,
      `  超时时间: ${stats.config.timeoutMs}ms`,
      `  网络隔离: ${stats.config.enableNetworkIsolation ? '启用' : '禁用'}`,
      `  文件系统隔离: ${stats.config.enableFileSystemIsolation ? '启用' : '禁用'}`,
      '',
      '沙箱列表:',
    ];

    for (const sandbox of sandboxes) {
      const statusEmoji = {
        created: '📦',
        running: '▶️',
        stopped: '⏹️',
        failed: '❌',
      };

      lines.push(
        `  ${statusEmoji[sandbox.status]} ${sandbox.id} [${sandbox.status}]`
      );
      lines.push(`     端口: ${sandbox.port}, 数据目录: ${sandbox.dataDir}`);
      lines.push(`     创建于: ${sandbox.createdAt}`);
      if (sandbox.startedAt) {
        lines.push(`     启动于: ${sandbox.startedAt}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 清理所有沙箱
   * @returns {Promise<number>} 清理的沙箱数
   */
  async cleanupAll() {
    const sandboxIds = Array.from(this.sandboxes.keys());
    let cleanedCount = 0;

    for (const sandboxId of sandboxIds) {
      try {
        await this.cleanupSandbox(sandboxId);
        cleanedCount++;
      } catch (error) {
        logger.error(`清理 ${sandboxId} 失败: ${error.message}`);
      }
    }

    return cleanedCount;
  }

  /**
   * 获取可用的端口
   * @returns {number} 下一个可用的端口
   */
  getNextAvailablePort() {
    if (this.portPool.length === 0) {
      throw new Error('没有可用的端口');
    }
    return this.portPool[0];
  }
}

export default SandboxManager;
