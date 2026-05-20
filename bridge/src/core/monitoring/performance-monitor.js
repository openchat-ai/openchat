/**
 * 性能监控器
 * 监控系统性能指标，优化响应时间
 */

export class PerformanceMonitor {
  constructor(options = {}) {
    this.metrics = {
      requests: 0,
      errors: 0,
      avgResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      activeConnections: 0,
      totalConnections: 0
    };
    
    this.responseTimes = [];
    this.windowSize = options.windowSize || 100; // 滑动窗口大小
    this.sampleRate = options.sampleRate || 1.0; // 采样率 (0-1)
    
    // 性能阈值
    this.thresholds = {
      responseTime: options.responseTimeThreshold || 2000, // 2秒
      errorRate: options.errorRateThreshold || 0.05,      // 5%
      activeConnections: options.connectionThreshold || 100
    };
    
    // 回调函数
    this.onThresholdBreached = options.onThresholdBreached || (() => {});
    this.onMetricsUpdate = options.onMetricsUpdate || (() => {});
    
    // 启动指标重置定时器
    this.startMetricsResetTimer();
  }

  /**
   * 记录请求开始
   */
  startRequest() {
    this.metrics.requests++;
    this.metrics.activeConnections++;
    this.metrics.totalConnections++;
    
    return {
      startTime: Date.now(),
      requestId: this._generateRequestId()
    };
  }

  /**
   * 记录请求结束
   */
  endRequest(requestInfo, error = null) {
    const duration = Date.now() - requestInfo.startTime;
    
    // 更新响应时间统计
    this._updateResponseTime(duration);
    
    // 如果有错误，增加错误计数
    if (error) {
      this.metrics.errors++;
    }
    
    // 减少活跃连接数
    this.metrics.activeConnections--;
    
    // 检查阈值
    this._checkThresholds(duration, error);
    
    // 通知指标更新
    this.onMetricsUpdate({
      ...this.metrics,
      lastResponseTime: duration,
      requestId: requestInfo.requestId
    });
    
    return duration;
  }

  /**
   * 更新响应时间统计
   */
  _updateResponseTime(duration) {
    // 添加到滑动窗口
    this.responseTimes.push(duration);
    if (this.responseTimes.length > this.windowSize) {
      this.responseTimes.shift();
    }
    
    // 计算平均响应时间（滑动窗口）
    if (this.responseTimes.length > 0) {
      const sum = this.responseTimes.reduce((a, b) => a + b, 0);
      this.metrics.avgResponseTime = sum / this.responseTimes.length;
    }
    
    // 更新最小和最大响应时间
    this.metrics.minResponseTime = Math.min(this.metrics.minResponseTime, duration);
    this.metrics.maxResponseTime = Math.max(this.metrics.maxResponseTime, duration);
  }

  /**
   * 检查阈值
   */
  _checkThresholds(duration, error) {
    const breachInfo = [];
    
    // 检查响应时间阈值
    if (duration > this.thresholds.responseTime) {
      breachInfo.push({
        type: 'response_time',
        value: duration,
        threshold: this.thresholds.responseTime
      });
    }
    
    // 检查错误率阈值
    const errorRate = this.metrics.errors / this.metrics.requests;
    if (errorRate > this.thresholds.errorRate) {
      breachInfo.push({
        type: 'error_rate',
        value: errorRate,
        threshold: this.thresholds.errorRate
      });
    }
    
    // 检查连接数阈值
    if (this.metrics.activeConnections > this.thresholds.activeConnections) {
      breachInfo.push({
        type: 'connections',
        value: this.metrics.activeConnections,
        threshold: this.thresholds.activeConnections
      });
    }
    
    // 如果有任何阈值被突破，触发回调
    if (breachInfo.length > 0) {
      this.onThresholdBreached(breachInfo);
    }
  }

  /**
   * 获取当前指标
   */
  getMetrics() {
    const errorRate = this.metrics.requests > 0 
      ? this.metrics.errors / this.metrics.requests 
      : 0;
      
    return {
      ...this.metrics,
      errorRate,
      responseTimeWindow: [...this.responseTimes],
      responseTimePercentiles: this._getResponseTimePercentiles()
    };
  }

  /**
   * 获取响应时间百分位数
   */
  _getResponseTimePercentiles() {
    if (this.responseTimes.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0 };
    }
    
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const len = sorted.length;
    
    return {
      p50: sorted[Math.floor(len * 0.5)],
      p90: sorted[Math.floor(len * 0.9)],
      p95: sorted[Math.floor(len * 0.95)],
      p99: sorted[Math.floor(len * 0.99)]
    };
  }

  /**
   * 生成请求ID
   */
  _generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 启动指标重置定时器
   */
  startMetricsResetTimer() {
    this.resetTimer = setInterval(() => {
      // 定期重置某些指标，保留近期趋势
      this.metrics.minResponseTime = Infinity;
      this.metrics.maxResponseTime = 0;
    }, 300000); // 每5分钟重置一次短期指标
  }

  /**
   * 停止监控器
   */
  stop() {
    if (this.resetTimer) {
      clearInterval(this.resetTimer);
    }
  }

  /**
   * 创建中间件函数
   */
  createMiddleware() {
    const monitor = this;
    
    return async (ctx, next) => {
      // 只在满足采样率时才记录
      if (Math.random() < this.sampleRate) {
        const requestInfo = monitor.startRequest();
        
        try {
          await next();
          monitor.endRequest(requestInfo);
        } catch (error) {
          monitor.endRequest(requestInfo, error);
          throw error;
        }
      } else {
        await next();
      }
    };
  }
}

// 全局性能监控器实例
let globalMonitor = null;
export const getPerformanceMonitor = (options = {}) => {
  if (!globalMonitor) {
    globalMonitor = new PerformanceMonitor(options);
  }
  return globalMonitor;
};

// 便捷函数
export const withPerformanceMonitoring = (fn, operationName = 'operation') => {
  return async (...args) => {
    const monitor = getPerformanceMonitor();
    const requestInfo = monitor.startRequest();
    
    try {
      const result = await fn(...args);
      monitor.endRequest(requestInfo);
      return result;
    } catch (error) {
      monitor.endRequest(requestInfo, error);
      throw error;
    }
  };
};