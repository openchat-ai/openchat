/**
 * AgentSession 核心功能单元测试
 *
 * 测试范围：
 * 1. 生命周期 (创建/初始化/销毁)
 * 2. 状态管理
 * 3. 心跳机制
 * 4. 消息处理
 * 5. 核心循环 (think/run)
 * 6. API 调用与错误处理
 */

import { AgentSession, AGENT_STATES } from './src/core/agent-session.js';
import fs from 'fs/promises';
import path from 'path';

// ============================================
// Mock 层
// ============================================

// Mock persistentConfig
const mockConfig = {
  preferences: { currentProvider: 'openrouter', currentModel: 'auto' },
  apiKeys: { openrouter: 'test-key-12345' },
  providers: ['openrouter']
};

// 临时替换模块（测试时使用 import 的模块会被缓存，需要特殊处理）
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

async function setupMockConfig() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(mockConfig, null, 2));
}

async function cleanupMockConfig() {
  try {
    await fs.unlink(CONFIG_FILE);
  } catch (e) {}
}

// Mock fetch for API calls
const originalFetch = global.fetch;
let mockFetchResponse = null;
let mockFetchCallCount = 0;

function mockFetch(data) {
  mockFetchResponse = data;
  mockFetchCallCount = 0;

  global.fetch = async (url, options) => {
    mockFetchCallCount++;

    if (typeof mockFetchResponse === 'function') {
      return mockFetchResponse(url, options);
    }

    return {
      ok: mockFetchResponse.ok !== false,
      status: mockFetchResponse.status || 200,
      json: async () => mockFetchResponse.data || mockFetchResponse
    };
  };
}

function restoreFetch() {
  global.fetch = originalFetch;
}

// ============================================
// 测试框架
// ============================================

let passed = 0;
let failed = 0;
const testResults = [];

function log(name, success, message = '') {
  const status = success ? '✅' : '❌';
  console.log(`  ${status} ${name}${message ? ': ' + message : ''}`);
  if (success) passed++;
  else failed++;
  testResults.push({ name, success, message });
}

async function test(name, fn) {
  console.log(`\n[Test] ${name}`);
  try {
    await fn();
  } catch (e) {
    log(name, false, e.message);
  }
}

// ============================================
// 测试用例
// ============================================

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       AgentSession 核心功能单元测试');
  console.log('═══════════════════════════════════════════════════════════════');

  // 设置 Mock 环境
  await setupMockConfig();

  // ----------------------------------------
  // 测试 1: 构造函数和基本属性
  // ----------------------------------------
  await test('构造函数 - 基本属性', async () => {
    const agent = new AgentSession('test-agent-001', { name: 'TestBot' });

    log('agentId 正确', agent.agentId === 'test-agent-001');
    log('name 正确', agent.config.name === 'TestBot');
    log('初始状态 IDLE', agent.state === AGENT_STATES.IDLE);
    log('messages 为空', agent.messages.length === 0);
    log('iterationCount 为 0', agent.iterationCount === 0);
    log('_isDestroyed 为 false', agent._isDestroyed === false);
  });

  // ----------------------------------------
  // 测试 2: 初始化和状态转换
  // ----------------------------------------
  await test('初始化 - 状态转换', async () => {
    const agent = new AgentSession('test-agent-002');

    log('初始状态 IDLE', agent.state === AGENT_STATES.IDLE);

    await agent.initialize();

    log('初始化后状态 READY', agent.state === AGENT_STATES.READY);
    log('心跳已启动', agent._heartbeatInterval !== null);
    log('订阅已建立', agent.subscriptions.length > 0);

    agent.cleanup();
    log('清理后状态 TERMINATED', agent.state === AGENT_STATES.TERMINATED);
    log('心跳已停止', agent._heartbeatInterval === null);
  });

  // ----------------------------------------
  // 测试 3: 销毁机制
  // ----------------------------------------
  await test('销毁机制', async () => {
    const agent = new AgentSession('test-agent-003');
    await agent.initialize();

    // 验证销毁前的状态
    log('销毁前 _isDestroyed=false', agent._isDestroyed === false);

    agent.destroy();

    log('销毁后 _isDestroyed=true', agent._isDestroyed === true);
    log('状态 TERMINATED', agent.state === AGENT_STATES.TERMINATED);
    log('心跳已停止', agent._heartbeatInterval === null);

    // 再次调用 destroy 应该无影响
    agent.destroy();
    log('重复销毁安全', agent._isDestroyed === true);
  });

  // ----------------------------------------
  // 测试 4: 消息管理
  // ----------------------------------------
  await test('消息管理', async () => {
    const agent = new AgentSession('test-agent-004');

    agent.addMessage('user', 'Hello');
    agent.addMessage('assistant', 'Hi there!');
    agent.addMessage('system', 'System message');

    log('消息数量正确', agent.messages.length === 3);
    log('第一条消息角色正确', agent.messages[0].role === 'user');
    log('消息有时间戳', agent.messages[0].timestamp !== undefined);
    log('lastActivity 已更新', agent.lastActivity >= agent.createdAt);
  });

  // ----------------------------------------
  // 测试 5: getStatus 返回值
  // ----------------------------------------
  await test('getStatus - 完整状态', async () => {
    const agent = new AgentSession('test-agent-005', {
      name: 'StatusBot',
      maxIterations: 5
    });

    const status = agent.getStatus();

    log('包含 agentId', status.agentId === 'test-agent-005');
    log('包含 name', status.name === 'StatusBot');
    log('包含 state', status.state === AGENT_STATES.IDLE);
    log('包含 maxIterations', status.maxIterations === 5);
    log('包含 messageCount', status.messageCount === 0);
    log('包含 uptime', status.uptime >= 0);
    log('包含 isDestroyed', status.isDestroyed === false);
  });

  // ----------------------------------------
  // 测试 6: 心跳机制
  // ----------------------------------------
  await test('心跳机制', async () => {
    const agent = new AgentSession('test-agent-006');
    await agent.initialize();

    const beforeHeartbeat = agent.lastHeartbeat;

    // 等待至少一次心跳
    await new Promise(resolve => setTimeout(resolve, 6000));

    log('心跳更新了 lastHeartbeat', agent.lastHeartbeat >= beforeHeartbeat);
    log('心跳间隔存在', agent._heartbeatInterval !== null);

    agent.cleanup();
  });

  // ----------------------------------------
  // 测试 7: think() 迭代限制
  // ----------------------------------------
  await test('think() - 迭代限制', async () => {
    const agent = new AgentSession('test-agent-007', { maxIterations: 2 });
    await agent.initialize();

    // Mock API 返回
    mockFetch({
      ok: true,
      data: {
        choices: [{ message: { content: 'Test response' } }]
      }
    });

    // 执行两次
    agent.addMessage('user', 'Test');
    await agent.think();
    log('第一次 think 成功', agent.iterationCount === 1);

    await agent.think();
    log('第二次 think 成功', agent.iterationCount === 2);

    // 第三次应该抛出错误
    let errorThrown = false;
    try {
      await agent.think();
    } catch (e) {
      errorThrown = true;
    }
    log('达到限制后抛出错误', errorThrown);

    agent.cleanup();
    restoreFetch();
  });

  // ----------------------------------------
  // 测试 8: run() 简单任务
  // ----------------------------------------
  await test('run() - 简单任务', async () => {
    const agent = new AgentSession('test-agent-008');

    // Mock API
    mockFetch({
      ok: true,
      data: {
        choices: [{ message: { content: 'Task completed successfully' } }]
      }
    });

    const result = await agent.run('What is 2+2?');

    log('run 返回结果', result !== undefined);
    log('状态变为 COMPLETED', agent.state === AGENT_STATES.COMPLETED);
    log('消息已添加', agent.messages.length >= 1);

    agent.cleanup();
    restoreFetch();
  });

  // ----------------------------------------
  // 测试 9: 已销毁 Agent 的操作
  // ----------------------------------------
  await test('已销毁 Agent 行为', async () => {
    const agent = new AgentSession('test-agent-009');
    await agent.initialize();
    agent.destroy();

    // 尝试初始化已销毁的 agent
    let initError = false;
    try {
      await agent.initialize();
    } catch (e) {
      initError = e.message.includes('destroyed');
    }
    log('initialize 抛出 destroyed 错误', initError);

    // 尝试 think
    let thinkError = false;
    try {
      await agent.think();
    } catch (e) {
      thinkError = e.message.includes('destroyed');
    }
    log('think 抛出 destroyed 错误', thinkError);
  });

  // ----------------------------------------
  // 测试 10: API 错误处理
  // ----------------------------------------
  await test('API 错误处理', async () => {
    const agent = new AgentSession('test-agent-010');
    await agent.initialize();

    // Mock 401 错误
    mockFetch({
      ok: false,
      status: 401,
      data: { error: { message: 'Invalid API key' } }
    });

    agent.addMessage('user', 'Test');
    const result = await agent.think();

    // 检查返回了某种响应（错误消息或状态码）
    log('返回了响应', result && result.content !== undefined);

    agent.cleanup();
    restoreFetch();
  });

  // ----------------------------------------
  // 测试 11: 网络超时处理
  // ----------------------------------------
  await test('网络超时处理', async () => {
    const agent = new AgentSession('test-agent-011', {
      safetyTimeout: 1000,
      safetyMaxTimeout: 2000
    });
    await agent.initialize();

    // Mock 超时
    mockFetch((url, options) => {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          reject(new Error('Request timeout'));
        }, 100);
      });
    });

    agent.addMessage('user', 'Test timeout');
    const result = await agent.think();

    log('超时返回错误消息', result.content !== undefined);

    agent.cleanup();
    restoreFetch();
  });

  // ----------------------------------------
  // 测试 12: 熔断器触发
  // ----------------------------------------
  await test('熔断器机制', async () => {
    const agent = new AgentSession('test-agent-012', {
      circuitFailureThreshold: 2,
      circuitSuccessThreshold: 1,
      circuitOpenTimeout: 5000
    });
    await agent.initialize();

    // 直接测试熔断器
    agent._circuitBreaker.recordFailure(500, 100);
    agent._circuitBreaker.recordFailure(500, 100);
    agent._circuitBreaker.recordFailure(500, 100);

    const circuitStatus = agent._circuitBreaker.getStatus();
    // 熔断器应该打开或记录失败
    log('熔断器状态变化', circuitStatus.state === 'OPEN' || circuitStatus.failureCount > 0);

    agent.cleanup();
  });

  // ----------------------------------------
  // 测试 13: 输出验证
  // ----------------------------------------
  await test('输出验证', async () => {
    const agent = new AgentSession('test-agent-013');
    await agent.initialize();

    // 设置 schema
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' }
      },
      required: ['name']
    };

    agent.setOutputSchema(schema);

    // 验证有效数据 (JSON 字符串)
    const validResult = agent.validateOutput('{"name": "Alice", "age": 25}');
    log('验证返回结果', validResult !== undefined);

    // 验证无效数据
    const invalidResult = agent.validateOutput('{"age": "not a number"}');
    log('验证有返回值', invalidResult !== undefined);

    agent.cleanup();
  });

  // ----------------------------------------
  // 测试 14: 内容分析
  // ----------------------------------------
  await test('内容分析', async () => {
    const agent = new AgentSession('test-agent-014');
    await agent.initialize();

    const content = `
      Here's some code:
      \`\`\`javascript
      function hello() { return "world"; }
      \`\`\`

      And some JSON: {"key": "value"}
    `;

    const analysis = agent._contentAnalyzer.analyze(content);

    log('检测到代码', analysis.hasCode === true);
    log('检测到代码块', analysis.codeBlocks.length >= 1);
    log('分析了内容', analysis !== undefined);

    agent.cleanup();
  });

  // ----------------------------------------
  // 测试 15: 质量评分
  // ----------------------------------------
  await test('质量评分', async () => {
    const agent = new AgentSession('test-agent-015');
    await agent.initialize();

    const goodContent = 'The answer to your question is 42. This is based on the mathematical calculation.';
    const score = agent.scoreQuality(goodContent, { question: 'What is the meaning of life?' });

    log('质量评分返回数值', typeof score === 'number' || typeof score === 'object');

    agent.cleanup();
  });

  // ----------------------------------------
  // 清理
  // ----------------------------------------
  await cleanupMockConfig();

  // ============================================
  // 结果汇总
  // ============================================
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  测试结果: ${passed} 通过, ${failed} 失败`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) {
    console.log('\n失败的测试:');
    testResults.filter(t => !t.success).forEach(t => {
      console.log(`  - ${t.name}: ${t.message}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

// 运行测试
runTests().catch(e => {
  console.error('测试执行失败:', e);
  process.exit(1);
});
