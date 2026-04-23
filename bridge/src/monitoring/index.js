/**
 * Monitoring Index
 * 监控模块入口
 */

const healthCheck = require('./health-check.js');
const metrics = require('../api/middleware/metrics.js');

/**
 * 获取完整系统状态
 */
async function getSystemStatus() {
  const health = await healthCheck.check();
  const metricSummary = metrics.getSummary();

  return {
    health: health.overall,
    checks: health.checks,
    metrics: metricSummary,
    timestamp: new Date().toISOString()
  };
}

/**
 * 获取快速状态（用于健康检查端点）
 */
function getQuickStatus() {
  const quickHealth = healthCheck.quickCheck();
  const metricSummary = metrics.getSummary();

  return {
    healthy: quickHealth.healthy,
    memory: quickHealth.memory,
    requests: metricSummary.requests,
    uptime: metricSummary.uptime,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  healthCheck,
  metrics,
  getSystemStatus,
  getQuickStatus
};