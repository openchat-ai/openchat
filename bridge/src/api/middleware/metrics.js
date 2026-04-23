/**
 * API Metrics Collector
 * API 指标收集器
 */

class MetricsCollector {
  constructor(options = {}) {
    this.resetInterval = options.resetInterval || 3600000; // 1 小时

    this.metrics = {
      requests: {
        total: 0,
        success: 0,
        error: 0,
        byEndpoint: {},
        byStatus: {}
      },
      responseTime: {
        sum: 0,
        count: 0,
        min: Infinity,
        max: 0,
        p50: [],
        p95: [],
        p99: []
      },
      bandwidth: {
        bytesIn: 0,
        bytesOut: 0
      },
      errors: {
        byType: {},
        recent: []
      },
      uptime: {
        startTime: Date.now(),
        restartCount: 0
      }
    }

    // 定期重置
    this.resetTimer = setInterval(() => this.resetHourly(), this.resetInterval)
  }

  /**
   * 记录请求
   */
  recordRequest(endpoint, statusCode, responseTimeMs, bytesIn = 0, bytesOut = 0) {
    // 请求计数
    this.metrics.requests.total++

    if (statusCode < 400) {
      this.metrics.requests.success++
    } else {
      this.metrics.requests.error++
    }

    // 按端点统计
    if (!this.metrics.requests.byEndpoint[endpoint]) {
      this.metrics.requests.byEndpoint[endpoint] = { total: 0, success: 0, error: 0 }
    }
    this.metrics.requests.byEndpoint[endpoint].total++
    if (statusCode < 400) {
      this.metrics.requests.byEndpoint[endpoint].success++
    } else {
      this.metrics.requests.byEndpoint[endpoint].error++
    }

    // 按状态码统计
    const statusBucket = `${Math.floor(statusCode / 100)}xx`
    this.metrics.requests.byStatus[statusBucket] = (this.metrics.requests.byStatus[statusBucket] || 0) + 1

    // 响应时间
    this.metrics.responseTime.sum += responseTimeMs
    this.metrics.responseTime.count++
    this.metrics.responseTime.min = Math.min(this.metrics.responseTime.min, responseTimeMs)
    this.metrics.responseTime.max = Math.max(this.metrics.responseTime.max, responseTimeMs)

    // 百分位数近似
    this.metrics.responseTime.p50.push(responseTimeMs)
    this.metrics.responseTime.p95.push(responseTimeMs)
    this.metrics.responseTime.p99.push(responseTimeMs)

    // 限制数组大小
    const maxSamples = 1000
    if (this.metrics.responseTime.p50.length > maxSamples) {
      this.metrics.responseTime.p50 = this.metrics.responseTime.p50.slice(-maxSamples)
      this.metrics.responseTime.p95 = this.metrics.responseTime.p95.slice(-maxSamples)
      this.metrics.responseTime.p99 = this.metrics.responseTime.p99.slice(-maxSamples)
    }

    // 带宽
    this.metrics.bandwidth.bytesIn += bytesIn
    this.metrics.bandwidth.bytesOut += bytesOut
  }

  /**
   * 记录错误
   */
  recordError(errorType, errorMessage, endpoint) {
    // 按类型统计
    this.metrics.errors.byType[errorType] = (this.metrics.errors.byType[errorType] || 0) + 1

    // 最近错误
    this.metrics.errors.recent.push({
      type: errorType,
      message: errorMessage,
      endpoint,
      timestamp: Date.now()
    })

    // 只保留最近 100 个错误
    if (this.metrics.errors.recent.length > 100) {
      this.metrics.errors.recent = this.metrics.errors.recent.slice(-100)
    }
  }

  /**
   * 获取指标摘要
   */
  getSummary() {
    const responseTime = this.calculatePercentiles()

    return {
      requests: {
        total: this.metrics.requests.total,
        success: this.metrics.requests.success,
        error: this.metrics.requests.error,
        successRate: this.metrics.requests.total > 0
          ? (this.metrics.requests.success / this.metrics.requests.total * 100).toFixed(2) + '%'
          : '0%'
      },
      responseTime: {
        avg: this.metrics.responseTime.count > 0
          ? (this.metrics.responseTime.sum / this.metrics.responseTime.count).toFixed(2) + 'ms'
          : '0ms',
        min: this.metrics.responseTime.min === Infinity ? '0ms' : this.metrics.responseTime.min + 'ms',
        max: this.metrics.responseTime.max === 0 ? '0ms' : this.metrics.responseTime.max + 'ms',
        p50: responseTime.p50,
        p95: responseTime.p95,
        p99: responseTime.p99
      },
      bandwidth: {
        in: this.formatBytes(this.metrics.bandwidth.bytesIn),
        out: this.formatBytes(this.metrics.bandwidth.bytesOut)
      },
      uptime: {
        seconds: Math.floor((Date.now() - this.metrics.uptime.startTime) / 1000),
        restartCount: this.metrics.uptime.restartCount
      }
    }
  }

  /**
   * 获取详细指标
   */
  getDetailed() {
    return {
      ...this.metrics,
      endpoints: Object.entries(this.metrics.requests.byEndpoint).map(([endpoint, stats]) => ({
        endpoint,
        ...stats,
        successRate: stats.total > 0
          ? (stats.success / stats.total * 100).toFixed(2) + '%'
          : '0%'
      }))
    }
  }

  /**
   * 计算百分位数
   */
  calculatePercentiles() {
    const calc = (arr) => {
      if (arr.length === 0) return '0ms'
      const sorted = arr.slice().sort((a, b) => a - b)
      const idx = Math.floor(sorted.length * 0.5)
      return sorted[idx] + 'ms'
    }

    return {
      p50: calc(this.metrics.responseTime.p50),
      p95: calc(this.metrics.responseTime.p95),
      p99: calc(this.metrics.responseTime.p99)
    }
  }

  /**
   * 格式化字节
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
  }

  /**
   * 每小时重置
   */
  resetHourly() {
    // 保留总计，只重置计数
    this.metrics.responseTime = {
      sum: 0,
      count: 0,
      min: Infinity,
      max: 0,
      p50: [],
      p95: [],
      p99: []
    }
    console.log('[Metrics] Hourly reset completed')
  }

  /**
   * 完全重置
   */
  reset() {
    this.metrics = {
      requests: { total: 0, success: 0, error: 0, byEndpoint: {}, byStatus: {} },
      responseTime: { sum: 0, count: 0, min: Infinity, max: 0, p50: [], p95: [], p99: [] },
      bandwidth: { bytesIn: 0, bytesOut: 0 },
      errors: { byType: {}, recent: [] },
      uptime: { startTime: Date.now(), restartCount: this.metrics.uptime.restartCount + 1 }
    }
  }

  /**
   * 停止收集器
   */
  destroy() {
    if (this.resetTimer) {
      clearInterval(this.resetTimer)
    }
  }
}

// 导出单例
const metrics = new MetricsCollector()

export default metrics
export { MetricsCollector }