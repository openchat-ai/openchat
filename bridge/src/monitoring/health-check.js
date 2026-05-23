/**
 * Health Check System
 * 系统健康检查
 */

const os = require('os');

class HealthCheck {
  constructor(options = {}) {
    this.checks = new Map();
    this.lastCheck = null;
    this.checkInterval = options.checkInterval || 30000;

    // 注册默认检查
    this.registerDefaultChecks();
  }

  /**
   * 注册默认检查
   */
  registerDefaultChecks() {
    // 基础系统检查
    this.registerCheck('system', async () => {
      const cpuLoad = os.loadavg()[0];
      const memUsage = process.memoryUsage();

      return {
        healthy: cpuLoad < 10 && memUsage.heapUsed < memUsage.heapLimit,
        cpuLoad: cpuLoad.toFixed(2),
        memory: {
          usedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          limitMB: Math.round(memUsage.heapLimit / 1024 / 1024),
          percent: Math.round(memUsage.heapUsed / memUsage.heapLimit * 100)
        }
      };
    });

    // 事件循环检查
    this.registerCheck('eventLoop', async () => {
      const start = Date.now();
      await new Promise(resolve => setImmediate(resolve));
      const latency = Date.now() - start;

      return {
        healthy: latency < 50,
        latency: latency + 'ms'
      };
    });

    // 磁盘空间检查
    this.registerCheck('disk', async () => {
      // 简化：返回静态值
      return {
        healthy: true,
        available: 'unknown'
      };
    });

    // 网络检查
    this.registerCheck('network', async () => {
      const interfaces = os.networkInterfaces();
      const hasNetwork = Object.keys(interfaces).length > 0;

      return {
        healthy: hasNetwork,
        interfaces: Object.keys(interfaces).length
      };
    });
  }

  /**
   * 注册检查
   */
  registerCheck(name, checkFn) {
    this.checks.set(name, checkFn);
  }

  /**
   * 执行所有检查
   */
  async check() {
    const results = {
      timestamp: new Date().toISOString(),
      overall: 'healthy',
      checks: {}
    };

    let failedChecks = 0;

    for (const [name, checkFn] of this.checks) {
      try {
        const result = await checkFn();
        results.checks[name] = {
          status: result.healthy ? 'healthy' : 'unhealthy',
          ...result
        };

        if (!result.healthy) {
          failedChecks++;
        }
      } catch (error) {
        results.checks[name] = {
          status: 'error',
          message: error.message
        };
        failedChecks++;
      }
    }

    if (failedChecks > 0) {
      results.overall = failedChecks === this.checks.size ? 'unhealthy' : 'degraded';
    }

    this.lastCheck = results;
    return results;
  }

  /**
   * 获取单次检查结果
   */
  getLastCheck() {
    return this.lastCheck;
  }

  /**
   * 快速健康检查（用于 Watchdog）
   */
  quickCheck() {
    const memUsage = process.memoryUsage();
    const healthy = memUsage.heapUsed < memUsage.heapLimit;

    return {
      healthy,
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        limit: Math.round(memUsage.heapLimit / 1024 / 1024)
      }
    };
  }
}

// 导出单例
const healthCheck = new HealthCheck();

module.exports = healthCheck;
module.exports.HealthCheck = HealthCheck;