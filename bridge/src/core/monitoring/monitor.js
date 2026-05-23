/**
 * Monitor 类：系统监控和指标记录
 */
class Monitor {
  constructor() {
    this.metrics = {
      requests: [],
      errors: [],
      rollbacks: [],
      restarts: [],
    };
    this.aggregated = {
      totalRequests: 0,
      totalErrors: 0,
      totalRollbacks: 0,
      totalRestarts: 0,
      averageLatency: 0,
      successRate: 100,
      errorRate: 0,
    };
    this.alerts = [];
  }

  /**
   * 记录请求指标
   * @param {object} metric - 请求指标
   */
  recordRequest(metric) {
    const record = {
      timestamp: new Date().toISOString(),
      ttft: metric.ttft || 0, // Time To First Token
      latency: metric.latency || 0,
      model: metric.model || 'unknown',
      tokensUsed: metric.tokensUsed || 0,
      status: metric.status || 'success',
    };

    this.metrics.requests.push(record);
    this.updateAggregated();
  }

  /**
   * 记录错误
   * @param {object} error - 错误信息
   */
  recordError(error) {
    const record = {
      timestamp: new Date().toISOString(),
      message: error.message || String(error),
      severity: error.severity || 'medium',
      component: error.component || 'unknown',
    };

    this.metrics.errors.push(record);
    this.updateAggregated();

    // 检查错误阈值
    if (this.metrics.errors.length > 10) {
      this.triggerAlert(
        'high_error_rate',
        `最近错误数达到 ${this.metrics.errors.length}`,
        'high'
      );
    }
  }

  /**
   * 记录回滚事件
   * @param {object} rollback - 回滚信息
   */
  recordRollback(rollback) {
    const record = {
      timestamp: new Date().toISOString(),
      reason: rollback.reason || 'unknown',
      targetCommit: rollback.targetCommit || 'unknown',
      status: rollback.status || 'success',
    };

    this.metrics.rollbacks.push(record);
    this.updateAggregated();

    this.triggerAlert(
      'rollback_occurred',
      `发生回滚: ${record.reason}`,
      'medium'
    );
  }

  /**
   * 记录重启事件
   * @param {object} restart - 重启信息
   */
  recordRestart(restart) {
    const record = {
      timestamp: new Date().toISOString(),
      reason: restart.reason || 'unknown',
      duration: restart.duration || 0,
      status: restart.status || 'success',
    };

    this.metrics.restarts.push(record);
    this.updateAggregated();
  }

  /**
   * 更新聚合指标
   */
  updateAggregated() {
    this.aggregated.totalRequests = this.metrics.requests.length;
    this.aggregated.totalErrors = this.metrics.errors.length;
    this.aggregated.totalRollbacks = this.metrics.rollbacks.length;
    this.aggregated.totalRestarts = this.metrics.restarts.length;

    // 计算平均延迟
    if (this.metrics.requests.length > 0) {
      const totalLatency = this.metrics.requests.reduce(
        (sum, r) => sum + r.latency,
        0
      );
      this.aggregated.averageLatency = (
        totalLatency / this.metrics.requests.length
      ).toFixed(2);
    }

    // 计算成功率
    if (this.metrics.requests.length > 0) {
      const successCount = this.metrics.requests.filter(
        r => r.status === 'success'
      ).length;
      this.aggregated.successRate = (
        (successCount / this.metrics.requests.length) *
        100
      ).toFixed(2);
      this.aggregated.errorRate = (100 - this.aggregated.successRate).toFixed(
        2
      );
    }
  }

  /**
   * 触发告警
   * @param {string} type - 告警类型
   * @param {string} message - 告警消息
   * @param {string} severity - 严重程度
   */
  triggerAlert(type, message, severity) {
    const alert = {
      id: `alert-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type,
      message,
      severity,
      acknowledged: false,
    };

    this.alerts.push(alert);
  }

  /**
   * 确认告警
   * @param {string} alertId - 告警 ID
   */
  acknowledgeAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date().toISOString();
    }
  }

  /**
   * 获取指标
   * @returns {object} 当前指标
   */
  getMetrics() {
    return this.aggregated;
  }

  /**
   * 获取告警
   * @param {string} filter - 过滤条件: all/unacknowledged/high
   * @returns {Array} 告警列表
   */
  getAlerts(filter = 'all') {
    let alerts = [...this.alerts];

    if (filter === 'unacknowledged') {
      alerts = alerts.filter(a => !a.acknowledged);
    } else if (filter === 'high') {
      alerts = alerts.filter(a => a.severity === 'high');
    }

    return alerts;
  }

  /**
   * 生成监控报告
   * @returns {string} 可读的报告
   */
  generateReport() {
    const metrics = this.getMetrics();
    const lines = [
      '╔════════════════════════════════════════════════════════╗',
      '║        系统监控报告                               ║',
      '╚════════════════════════════════════════════════════════╝',
      '',
      '请求统计:',
      `  总请求数: ${metrics.totalRequests}`,
      `  平均延迟: ${metrics.averageLatency}ms`,
      `  成功率: ${metrics.successRate}%`,
      `  错误率: ${metrics.errorRate}%`,
      '',
      '系统事件:',
      `  总错误数: ${metrics.totalErrors}`,
      `  总回滚数: ${metrics.totalRollbacks}`,
      `  总重启数: ${metrics.totalRestarts}`,
      '',
      '告警:',
      `  总告警数: ${this.alerts.length}`,
      `  未确认: ${this.getAlerts('unacknowledged').length}`,
      `  高危: ${this.getAlerts('high').length}`,
    ];

    return lines.join('\n');
  }

  /**
   * 清空所有数据
   */
  clear() {
    this.metrics = {
      requests: [],
      errors: [],
      rollbacks: [],
      restarts: [],
    };
    this.alerts = [];
    this.updateAggregated();
  }

  /**
   * 获取健康状态
   * @returns {string} 健康状态 (healthy/warning/critical)
   */
  getHealthStatus() {
    const errorRate = parseFloat(this.aggregated.errorRate);
    const unacknowledgedAlerts = this.getAlerts('unacknowledged').length;

    if (errorRate > 20 || unacknowledgedAlerts > 5) {
      return 'critical';
    } else if (errorRate > 10 || unacknowledgedAlerts > 2) {
      return 'warning';
    }
    return 'healthy';
  }
}

export default Monitor;
