#!/usr/bin/env node

/**
 * Monitor CLI - 系统监控命令行接口
 */
import Monitor from './monitor.js';
import logger from '../monitoring/logger.js';

const monitor = new Monitor();

function printHelp() {
  logger.info(`
用法: node monitor-cli.js <command> [options]

命令:
  report             生成监控报告
  health             显示系统健康状态
  alerts [filter]    列出告警 (filter: all/unacknowledged/high)
  metrics            显示聚合指标
  help               显示此帮助信息

示例:
  node monitor-cli.js report
  node monitor-cli.js health
  node monitor-cli.js alerts unacknowledged
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'report';

  switch (command) {
    case 'report':
      logger.info(monitor.generateReport());
      break;

    case 'health':
      const status = monitor.getHealthStatus();
      const icons = { healthy: '✓', warning: '⚠', critical: '✗' };
      logger.info(`健康状态: ${icons[status]} ${status}`);
      break;

    case 'alerts': {
      const filter = args[1] || 'all';
      const alerts = monitor.getAlerts(filter);
      if (alerts.length === 0) {
        logger.info('无告警');
      } else {
        alerts.forEach(a => {
          logger.info(`[${a.severity}] ${a.type}: ${a.message} (${a.timestamp})${a.acknowledged ? ' ✓' : ''}`);
        });
      }
      break;
    }

    case 'metrics':
      logger.info(JSON.stringify(monitor.getMetrics(), null, 2));
      break;

    case 'help':
    default:
      printHelp();
      break;
  }
}

main().catch(err => {
  logger.error('Monitor CLI 错误:', err);
  process.exit(1);
});
