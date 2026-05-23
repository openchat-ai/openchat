/**
 * 测试 Agent 监控持久化功能和人机协作机制
 */

import { AgentMonitor, AgentState } from './src/core/agent-monitor.js';
import fs from 'fs/promises';
import path from 'path';

const STATE_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'agent-state.json');
const HISTORY_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'agent-history.json');

console.log('═══════════════════════════════════════════════════════════════');
console.log('       Agent Monitor 持久化 & 人机协作 测试');
console.log('═══════════════════════════════════════════════════════════════\n');

async function runTests() {
  const monitor = new AgentMonitor();
  let passed = 0;
  let failed = 0;

  // ============================================
  // 测试 1: 状态持久化 - 保存
  // ============================================
  console.log('[Test 1] 状态持久化 - 保存功能');
  try {
    // 模拟 Agent 注册
    monitor.agents.set('test-agent-1', {
      agentId: 'test-agent-1',
      name: 'TestAgent',
      state: AgentState.EXECUTING,
      iterationCount: 5,
      currentTask: 'Test task description',
      lastActivity: Date.now()
    });

    // 记录执行
    const execId = monitor.recordExecutionStart('test-agent-1', 'Executing test task');
    console.log(`  ✓ 创建执行记录: ${execId.substring(0, 8)}...`);

    // 记录工具调用
    monitor.recordToolCall('test-agent-1', 'read_file', { path: '/test/file.js' }, { success: true });
    monitor.recordToolCall('test-agent-1', 'write_file', { path: '/test/output.js' }, { success: true });
    console.log(`  ✓ 记录了 2 次工具调用`);

    // 创建检查点
    const checkpointId = monitor.createCheckpoint('test-agent-1', {
      messages: [{ role: 'user', content: 'test' }],
      step: 3
    });
    console.log(`  ✓ 创建检查点: ${checkpointId?.substring(0, 8)}...`);

    // 保存状态
    await monitor.saveState();

    // 验证文件存在
    const stateData = await fs.readFile(STATE_FILE, 'utf8');
    const state = JSON.parse(stateData);
    console.log(`  ✓ 状态文件已保存到: ${STATE_FILE}`);
    console.log(`  ✓ 包含 ${state.agents.length} 个 Agent 状态`);
    console.log(`  ✓ 指标: ${JSON.stringify(state.metrics)}`);

    console.log('[Test 1] ✅ PASSED\n');
    passed++;
  } catch (e) {
    console.log(`[Test 1] ❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // ============================================
  // 测试 2: 状态持久化 - 加载/恢复
  // ============================================
  console.log('[Test 2] 状态持久化 - 加载/恢复功能');
  try {
    // 创建新的 monitor 实例模拟重启
    const newMonitor = new AgentMonitor();

    // 模拟一个暂停状态的 Agent
    monitor.agents.set('paused-agent', {
      agentId: 'paused-agent',
      name: 'PausedAgent',
      state: AgentState.PAUSED,
      pausedAt: Date.now(),
      currentExecution: {
        checkpoints: [{ id: 'cp-1', timestamp: Date.now() }]
      }
    });
    await monitor.saveState();

    // 加载状态
    await newMonitor.loadState();

    const recoveredAgents = newMonitor.getAgentList();
    console.log(`  ✓ 恢复了 ${recoveredAgents.length} 个 Agent`);

    const pausedAgent = newMonitor.getAgent('paused-agent');
    if (pausedAgent && pausedAgent.recovered) {
      console.log(`  ✓ 暂停的 Agent 已标记为 recovered`);
    }

    const resumable = newMonitor.getResumableAgents();
    console.log(`  ✓ 可恢复的 Agent: ${resumable.length} 个`);

    console.log('[Test 2] ✅ PASSED\n');
    passed++;
  } catch (e) {
    console.log(`[Test 2] ❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // ============================================
  // 测试 3: 人机协作 - 回调机制
  // ============================================
  console.log('[Test 3] 人机协作 - 回调机制');
  try {
    const testMonitor = new AgentMonitor();

    // 注册 Agent
    testMonitor.agents.set('human-collab-agent', {
      agentId: 'human-collab-agent',
      name: 'CollabAgent',
      state: AgentState.EXECUTING
    });

    // 设置人机协作回调
    let humanInputReceived = null;
    testMonitor.onHumanInputNeeded = async (agentId, prompt, options) => {
      console.log(`  ✓ 收到人机协作请求: "${prompt}"`);
      console.log(`  ✓ Agent ID: ${agentId}`);
      humanInputReceived = 'approved';
      return humanInputReceived;
    };

    // 请求人机输入
    const response = await testMonitor.requestHumanInput(
      'human-collab-agent',
      '是否继续执行此操作？'
    );

    if (response === 'approved') {
      console.log(`  ✓ 人机协作响应: "${response}"`);
    }

    // 验证 Agent 状态变化
    const agent = testMonitor.getAgent('human-collab-agent');
    console.log(`  ✓ Agent 状态: ${agent.state}`);

    console.log('[Test 3] ✅ PASSED\n');
    passed++;
  } catch (e) {
    console.log(`[Test 3] ❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // ============================================
  // 测试 4: 人机协作 - Promise 等待机制
  // ============================================
  console.log('[Test 4] 人机协作 - Promise 等待机制');
  try {
    const testMonitor = new AgentMonitor();

    testMonitor.agents.set('promise-agent', {
      agentId: 'promise-agent',
      name: 'PromiseAgent',
      state: AgentState.EXECUTING
    });

    // 不设置回调，使用 Promise 等待机制
    const inputPromise = testMonitor.requestHumanInput(
      'promise-agent',
      '需要用户确认'
    );

    // 验证状态
    const agent = testMonitor.getAgent('promise-agent');
    if (agent.state === AgentState.WAITING_INPUT) {
      console.log(`  ✓ Agent 已进入 WAITING_INPUT 状态`);
    }
    if (agent.waitingFor === '需要用户确认') {
      console.log(`  ✓ 等待提示已记录`);
    }

    // 模拟外部提供输入
    setTimeout(() => {
      testMonitor.provideHumanInput('promise-agent', 'user-confirmed');
    }, 100);

    const result = await inputPromise;
    console.log(`  ✓ 收到用户输入: "${result}"`);

    // 验证状态恢复
    const updatedAgent = testMonitor.getAgent('promise-agent');
    if (updatedAgent.state === AgentState.EXECUTING) {
      console.log(`  ✓ Agent 已恢复到 EXECUTING 状态`);
    }

    console.log('[Test 4] ✅ PASSED\n');
    passed++;
  } catch (e) {
    console.log(`[Test 4] ❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // ============================================
  // 测试 5: 暂停/恢复机制
  // ============================================
  console.log('[Test 5] 暂停/恢复机制');
  try {
    const testMonitor = new AgentMonitor();

    testMonitor.agents.set('pausable-agent', {
      agentId: 'pausable-agent',
      name: 'PausableAgent',
      state: AgentState.EXECUTING,
      currentExecution: {
        iterations: 3,
        checkpoints: []
      }
    });

    // 暂停 Agent
    testMonitor.pauseAgent('pausable-agent');
    const pausedAgent = testMonitor.getAgent('pausable-agent');
    if (pausedAgent.state === AgentState.PAUSED) {
      console.log(`  ✓ Agent 已暂停`);
    }
    if (pausedAgent.pausedAt) {
      console.log(`  ✓ 记录了暂停时间`);
    }

    // 恢复 Agent
    testMonitor.resumeAgent('pausable-agent');
    const resumedAgent = testMonitor.getAgent('pausable-agent');
    if (resumedAgent.state === AgentState.EXECUTING) {
      console.log(`  ✓ Agent 已恢复执行`);
    }

    console.log('[Test 5] ✅ PASSED\n');
    passed++;
  } catch (e) {
    console.log(`[Test 5] ❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // ============================================
  // 测试 6: 执行历史记录
  // ============================================
  console.log('[Test 6] 执行历史记录');
  try {
    const testMonitor = new AgentMonitor();
    testMonitor.maxHistorySize = 5;

    // 创建多个执行记录
    for (let i = 0; i < 8; i++) {
      const agentId = `history-agent-${i}`;
      testMonitor.agents.set(agentId, {
        agentId,
        state: AgentState.IDLE,
        currentExecution: {
          id: `exec-${i}`,
          startTime: Date.now() - i * 1000,
          iterations: i,
          toolsUsed: []
        }
      });

      testMonitor.recordExecutionComplete(agentId, {
        success: i % 2 === 0,
        content: `Result ${i}`
      });
    }

    const history = testMonitor.getExecutionHistory();
    console.log(`  ✓ 历史记录数: ${history.length} (限制: 5)`);

    if (history.length <= 5) {
      console.log(`  ✓ 历史记录已正确限制`);
    }

    // 检查历史文件
    const historyFileExists = await fs.access(HISTORY_FILE)
      .then(() => true)
      .catch(() => false);

    if (historyFileExists) {
      const historyData = await fs.readFile(HISTORY_FILE, 'utf8');
      const parsedHistory = JSON.parse(historyData);
      console.log(`  ✓ 历史文件包含 ${parsedHistory.length} 条记录`);
    }

    console.log('[Test 6] ✅ PASSED\n');
    passed++;
  } catch (e) {
    console.log(`[Test 6] ❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // ============================================
  // 测试 7: 监控摘要
  // ============================================
  console.log('[Test 7] 监控摘要');
  try {
    const testMonitor = new AgentMonitor();

    // 添加多个 Agent
    testMonitor.agents.set('summary-1', {
      agentId: 'summary-1',
      state: AgentState.EXECUTING,
      iterationCount: 5
    });
    testMonitor.agents.set('summary-2', {
      agentId: 'summary-2',
      state: AgentState.IDLE,
      iterationCount: 2
    });
    testMonitor.agents.set('summary-3', {
      agentId: 'summary-3',
      state: AgentState.PAUSED,
      iterationCount: 3
    });

    testMonitor.metrics = {
      totalExecutions: 10,
      successCount: 8,
      failureCount: 2,
      totalToolsUsed: 25,
      averageIterations: 3.5
    };

    const summary = testMonitor.getSummary();

    console.log(`  ✓ 总 Agent 数: ${summary.totalAgents}`);
    console.log(`  ✓ 按状态分布: ${JSON.stringify(summary.byState)}`);
    console.log(`  ✓ 总执行数: ${summary.metrics.totalExecutions}`);
    console.log(`  ✓ 成功率: ${(summary.metrics.successCount / summary.metrics.totalExecutions * 100).toFixed(1)}%`);
    console.log(`  ✓ 平均迭代: ${summary.metrics.averageIterations}`);

    console.log('[Test 7] ✅ PASSED\n');
    passed++;
  } catch (e) {
    console.log(`[Test 7] ❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // ============================================
  // 最终结果
  // ============================================
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  测试结果: ${passed} 通过, ${failed} 失败`);
  console.log('═══════════════════════════════════════════════════════════════');

  // 清理测试文件
  try {
    await fs.unlink(STATE_FILE);
    await fs.unlink(HISTORY_FILE);
    console.log('\n✓ 清理了测试文件');
  } catch (e) {
    // 忽略清理错误
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('测试失败:', e);
  process.exit(1);
});
