import logger from './logger.js';
/**
 * 系统健康检查器
 * 检查系统各组件健康状态
 */

export class SystemHealthChecker {
  constructor(options = {}) {
    this.healthChecks = new Map();
    this.status = 'unknown';
    this.lastCheckTime = null;
    this.checkInterval = options.checkInterval || 30000; // 30秒
    this.timeout = options.timeout || 10000; // 10秒超时
    
    // 健康检查结果历史
    this.history = [];
    this.historyLimit = options.historyLimit || 100;
    
    // 回调函数
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onCheckComplete = options.onCheckComplete || (() => {});
  }

  /**
   * 注册健康检查
   */
  registerCheck(name, checkFn, options = {}) {
    this.healthChecks.set(name, {
      name,
      checkFn,
      interval: options.interval || this.checkInterval,
      timeout: options.timeout || this.timeout,
      critical: options.critical !== false, // 默认为关键检查
      lastRun: null,
      lastResult: null,
      lastError: null
    });
  }

  /**
   * 执行所有健康检查
   */
  async runAllChecks() {
    const startTime = Date.now();
    this.lastCheckTime = startTime;
    
    const results = {};
    let allHealthy = true;
    let criticalFailed = false;
    
    // 并行执行所有检查
    const checkPromises = [];
    
    for (const [name, check] of this.healthChecks) {
      checkPromises.push(
        this._executeSingleCheck(name, check)
          .then(result => ({ name, result }))
          .catch(error => ({ 
            name, 
            result: { healthy: false, error: error.message, timestamp: Date.now() } 
          }))
      );
    }
    
    const checkResults = await Promise.all(checkPromises);
    
    // 处理结果
    for (const { name, result } of checkResults) {
      results[name] = result;
      
      if (!result.healthy) {
        allHealthy = false;
        const check = this.healthChecks.get(name);
        if (check.critical) {
          criticalFailed = true;
        }
      }
    }
    
    // 更新整体状态
    let newStatus;
    if (criticalFailed) {
      newStatus = 'critical';
    } else if (!allHealthy) {
      newStatus = 'warning';
    } else {
      newStatus = 'healthy';
    }
    
    // 如果状态发生变化，触发回调
    if (this.status !== newStatus) {
      const oldStatus = this.status;
      this.status = newStatus;
      this.onStatusChange({
        oldStatus,
        newStatus,
        results,
        timestamp: Date.now()
      });
    }
    
    // 保存到历史记录
    this._addToHistory({
      status: newStatus,
      results,
      timestamp: Date.now(),
      duration: Date.now() - startTime
    });
    
    // 触发检查完成回调
    this.onCheckComplete({
      status: newStatus,
      results,
      timestamp: Date.now(),
      duration: Date.now() - startTime
    });
    
    return {
      status: newStatus,
      results,
      timestamp: Date.now(),
      duration: Date.now() - startTime
    };
  }

  /**
   * 执行单个健康检查
   */
  async _executeSingleCheck(name, check) {
    const startTime = Date.now();
    check.lastRun = startTime;
    
    try {
      // 创建带超时的Promise
      const result = await this._executeWithTimeout(
        () => check.checkFn(),
        check.timeout
      );
      
      check.lastResult = result;
      check.lastError = null;
      
      const duration = Date.now() - startTime;
      return {
        healthy: result.healthy !== false,
        ...result,
        duration,
        timestamp: Date.now()
      };
    } catch (error) {
      check.lastResult = null;
      check.lastError = error.message;
      
      const duration = Date.now() - startTime;
      return {
        healthy: false,
        error: error.message,
        duration,
        timestamp: Date.now()
      };
    }
  }

  /**
   * 带超时的执行函数
   */
  _executeWithTimeout(fn, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Health check timed out after ${timeout}ms`));
      }, timeout);

      Promise.resolve()
        .then(() => fn())
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 获取当前健康状态
   */
  getHealthStatus() {
    return {
      status: this.status,
      lastCheckTime: this.lastCheckTime,
      checks: this._getCheckSummaries(),
      timestamp: Date.now()
    };
  }

  /**
   * 获取检查摘要
   */
  _getCheckSummaries() {
    const summaries = {};
    
    for (const [name, check] of this.healthChecks) {
      summaries[name] = {
        name: check.name,
        healthy: check.lastResult?.healthy !== false,
        critical: check.critical,
        lastRun: check.lastRun,
        lastResult: check.lastResult,
        lastError: check.lastError
      };
    }
    
    return summaries;
  }

  /**
   * 添加到历史记录
   */
  _addToHistory(record) {
    this.history.push(record);
    
    // 限制历史记录大小
    if (this.history.length > this.historyLimit) {
      this.history.shift();
    }
  }

  /**
   * 获取健康历史
   */
  getHistory(limit = 10) {
    const endIndex = this.history.length;
    const startIndex = Math.max(0, endIndex - limit);
    return this.history.slice(startIndex, endIndex);
  }

  /**
   * 获取健康摘要
   */
  getSummary() {
    const summaries = this._getCheckSummaries();
    const checkCount = Object.keys(summaries).length;
    const healthyCount = Object.values(summaries).filter(s => s.healthy).length;
    
    return {
      status: this.status,
      healthyChecks: healthyCount,
      totalChecks: checkCount,
      healthPercentage: checkCount > 0 ? (healthyCount / checkCount) * 100 : 100,
      lastCheckTime: this.lastCheckTime,
      checks: summaries
    };
  }

  /**
   * 添加常用的健康检查
   */
  addCommonChecks() {
    // 内存使用检查
    this.registerCheck('memory', async () => {
      if (typeof process !== 'undefined' && process.memoryUsage) {
        const usage = process.memoryUsage();
        const heapUsedPercent = (usage.heapUsed / usage.heapTotal) * 100;
        
        return {
          healthy: heapUsedPercent < 80,
          details: {
            heapUsed: usage.heapUsed,
            heapTotal: usage.heapTotal,
            heapUsedPercent: Math.round(heapUsedPercent)
          }
        };
      }
      
      return { healthy: true, details: { message: 'Memory check not available in this environment' } };
    }, { critical: false });

    // 事件循环延迟检查
    this.registerCheck('event-loop', async () => {
      return new Promise((resolve) => {
        const start = process.hrtime.bigint();
        setImmediate(() => {
          const elapsed = Number(process.hrtime.bigint() - start) / 1000000; // 转换为毫秒
          
          resolve({
            healthy: elapsed < 10, // 延迟小于10ms认为健康
            details: {
              delayMs: Math.round(elapsed)
            }
          });
        });
      });
    }, { critical: false });

    // 基本连通性检查
    this.registerCheck('connectivity', async () => {
      // 这里可以添加与外部服务的连通性检查
      return { 
        healthy: true, 
        details: { message: 'Basic connectivity OK' } 
      };
    }, { critical: false });
  }

  /**
   * 启动定期健康检查
   */
  startAutoCheck() {
    if (this.autoCheckTimer) {
      clearInterval(this.autoCheckTimer);
    }
    
    this.autoCheckTimer = setInterval(() => {
      this.runAllChecks().catch(error => {
        logger.error('Error running auto health checks:', error);
      });
    }, this.checkInterval);
  }

  /**
   * 停止自动健康检查
   */
  stopAutoCheck() {
    if (this.autoCheckTimer) {
      clearInterval(this.autoCheckTimer);
      this.autoCheckTimer = null;
    }
  }
}

// 全局健康检查器实例
let globalHealthChecker = null;
export const getSystemHealthChecker = (options = {}) => {
  if (!globalHealthChecker) {
    globalHealthChecker = new SystemHealthChecker(options);
    globalHealthChecker.addCommonChecks(); // 添加常用检查
  }
  return globalHealthChecker;
};

// 便捷函数
export const createHealthCheckRoute = (healthChecker) => {
  return async (ctx) => {
    const result = await healthChecker.runAllChecks();
    ctx.status = result.status === 'critical' ? 500 : 
                 result.status === 'warning' ? 200 : 200;
    ctx.body = result;
  };
};