import EvolutionSystem from '../evolution/evolution-system.js';
import AutoRestartManager from '../monitoring/auto-restart-manager.js';
import SandboxManager from '../security/sandbox-manager.js';
import AutoRollbackManager from '../monitoring/auto-rollback-manager.js';
import TestOrchestrator from '../quality/test-orchestrator.js';
import IntelligenceCollector from '../memory/intelligence-collector.js';
import Monitor from '../monitoring/monitor.js';

async function runPhase34IntegrationTests() {
  console.log('🧪 开始 Phase 3-4 集成测试...\n');
  let testsPassed = 0;
  let testsFailed = 0;

  // ================== Phase 3 自动化测试 ==================

  // 测试 1: AutoRestartManager
  try {
    const autoRestart = new AutoRestartManager(process.cwd());
    const stats = autoRestart.getStats();
    if (stats && stats.isRunning !== undefined) {
      console.log('✅ AutoRestartManager 初始化 - 通过');
      testsPassed++;
    } else {
      throw new Error('状态获取失败');
    }
  } catch (error) {
    console.log('❌ AutoRestartManager 初始化 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 2: SandboxManager 创建沙箱
  try {
    const sandbox = new SandboxManager();
    const sb = await sandbox.createSandbox();
    if (sb && sb.id && sb.port) {
      console.log('✅ SandboxManager 创建沙箱 - 通过');
      testsPassed++;
    } else {
      throw new Error('沙箱创建失败');
    }
  } catch (error) {
    console.log('❌ SandboxManager 创建沙箱 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 3: SandboxManager 启动沙箱
  try {
    const sandbox = new SandboxManager();
    const sb = await sandbox.createSandbox();
    const result = await sandbox.startSandbox(sb.id);
    if (result.success) {
      console.log('✅ SandboxManager 启动沙箱 - 通过');
      testsPassed++;
    } else {
      throw new Error('沙箱启动失败');
    }
  } catch (error) {
    console.log('❌ SandboxManager 启动沙箱 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 4: AutoRollbackManager
  try {
    const rollback = new AutoRollbackManager();
    const stats = rollback.getStats();
    if (stats && stats.totalRollbacks === 0) {
      console.log('✅ AutoRollbackManager 初始化 - 通过');
      testsPassed++;
    } else {
      throw new Error('初始化失败');
    }
  } catch (error) {
    console.log('❌ AutoRollbackManager 初始化 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 5: TestOrchestrator 配置
  try {
    const orchestrator = new TestOrchestrator({
      enableAutoCommit: true,
      enableSandboxTest: true,
      enableMultiModelTest: true,
      enableAdversarialTest: true,
    });
    const stats = orchestrator.getStats();
    if (stats && stats.totalExecutions !== undefined) {
      console.log('✅ TestOrchestrator 配置 - 通过');
      testsPassed++;
    } else {
      throw new Error('配置失败');
    }
  } catch (error) {
    console.log('❌ TestOrchestrator 配置 - 失败:', error.message);
    testsFailed++;
  }

  // ================== Phase 4 情报与监控测试 ==================

  // 测试 6: IntelligenceCollector 收集
  try {
    const collector = new IntelligenceCollector();
    const result = await collector.collect();
    if (result.status === 'success' && result.totalItems > 0) {
      console.log('✅ IntelligenceCollector 收集 - 通过');
      testsPassed++;
    } else {
      throw new Error('收集失败');
    }
  } catch (error) {
    console.log('❌ IntelligenceCollector 收集 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 7: IntelligenceCollector 过滤
  try {
    const collector = new IntelligenceCollector();
    await collector.collect();
    const githubItems = collector.getIntelligence({ type: 'github' });
    if (Array.isArray(githubItems)) {
      console.log('✅ IntelligenceCollector 过滤 - 通过');
      testsPassed++;
    } else {
      throw new Error('过滤失败');
    }
  } catch (error) {
    console.log('❌ IntelligenceCollector 过滤 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 8: Monitor 记录请求
  try {
    const monitor = new Monitor();
    monitor.recordRequest({ latency: 100, model: 'claude' });
    const metrics = monitor.getMetrics();
    if (metrics.totalRequests === 1) {
      console.log('✅ Monitor 记录请求 - 通过');
      testsPassed++;
    } else {
      throw new Error('记录失败');
    }
  } catch (error) {
    console.log('❌ Monitor 记录请求 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 9: Monitor 记录错误
  try {
    const monitor = new Monitor();
    monitor.recordError({ message: 'Test error', severity: 'high' });
    const metrics = monitor.getMetrics();
    if (metrics.totalErrors === 1) {
      console.log('✅ Monitor 记录错误 - 通过');
      testsPassed++;
    } else {
      throw new Error('记录失败');
    }
  } catch (error) {
    console.log('❌ Monitor 记录错误 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 10: Monitor 告警触发
  try {
    const monitor = new Monitor();
    monitor.triggerAlert('test_alert', 'Test alert message', 'high');
    const alerts = monitor.getAlerts();
    if (alerts.length === 1) {
      console.log('✅ Monitor 告警触发 - 通过');
      testsPassed++;
    } else {
      throw new Error('告警触发失败');
    }
  } catch (error) {
    console.log('❌ Monitor 告警触发 - 失败:', error.message);
    testsFailed++;
  }

  // ================== 系统集成测试 ==================

  // 测试 11: EvolutionSystem 包含新模块
  try {
    const system = new EvolutionSystem();
    if (
      system.autoRestart &&
      system.sandbox &&
      system.autoRollback &&
      system.testOrchestrator &&
      system.intelligenceCollector &&
      system.monitor
    ) {
      console.log('✅ EvolutionSystem 包含新模块 - 通过');
      testsPassed++;
    } else {
      throw new Error('模块缺失');
    }
  } catch (error) {
    console.log('❌ EvolutionSystem 包含新模块 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 12: EvolutionSystem 初始化
  try {
    const system = new EvolutionSystem();
    await system.initialize();
    if (system.isInitialized) {
      console.log('✅ EvolutionSystem 初始化 - 通过');
      testsPassed++;
    } else {
      throw new Error('初始化失败');
    }
  } catch (error) {
    console.log('❌ EvolutionSystem 初始化 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 13: EvolutionSystem 生成完整报告
  try {
    const system = new EvolutionSystem();
    await system.initialize();
    const report = await system.generateReport();
    if (report && report.includes('自动化系统') && report.includes('监控系统')) {
      console.log('✅ EvolutionSystem 完整报告 - 通过');
      testsPassed++;
    } else {
      throw new Error('报告生成失败');
    }
  } catch (error) {
    console.log('❌ EvolutionSystem 完整报告 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 14: EvolutionSystem 获取完整状态
  try {
    const system = new EvolutionSystem();
    await system.initialize();
    const status = system.getStatus();
    if (
      status.autoRestart &&
      status.sandbox &&
      status.autoRollback &&
      status.testOrchestrator &&
      status.intelligenceCollector &&
      status.monitor
    ) {
      console.log('✅ EvolutionSystem 完整状态 - 通过');
      testsPassed++;
    } else {
      throw new Error('状态获取失败');
    }
  } catch (error) {
    console.log('❌ EvolutionSystem 完整状态 - 失败:', error.message);
    testsFailed++;
  }

  // 输出测试结果
  console.log('\n' + '='.repeat(50));
  console.log(`总计: ${testsPassed + testsFailed} 个测试`);
  console.log(`✅ 通过: ${testsPassed}`);
  console.log(`❌ 失败: ${testsFailed}`);
  console.log('='.repeat(50));

  return testsFailed === 0;
}

runPhase34IntegrationTests().then(success => process.exit(success ? 0 : 1));
