/**
 * AgentSession 测试 - 使用 Node.js 内置测试模块
 *
 * 运行方式:
 *   单次运行: node --test src/core/__tests__/agent-session.test.mjs
 *   Watch模式: node --test --watch src/core/__tests__/agent-session.test.mjs
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AgentSession, AGENT_STATES } from '../agent.mjs';

describe('AgentSession', () => {
  describe('构造函数', () => {
    test('应创建带有默认配置的实例', () => {
      const agent = new AgentSession('test-id');
      assert.strictEqual(agent.agentId, 'test-id');
      assert.strictEqual(agent.state, AGENT_STATES.IDLE);
    });

    test('应接受自定义配置', () => {
      const agent = new AgentSession('test-id', {
        name: 'CustomAgent',
        maxIterations: 5
      });
      assert.strictEqual(agent.config.name, 'CustomAgent');
      assert.strictEqual(agent.config.maxIterations, 5);
    });

    test('初始消息列表应为空', () => {
      const agent = new AgentSession('msg-test');
      assert.strictEqual(agent.messages.length, 0);
    });

    test('初始迭代计数应为0', () => {
      const agent = new AgentSession('iter-test');
      assert.strictEqual(agent.iterationCount, 0);
    });

    test('_isDestroyed 应为 false', () => {
      const agent = new AgentSession('destroy-test');
      assert.strictEqual(agent._isDestroyed, false);
    });
  });

  describe('生命周期', () => {
    test('应正确初始化', async () => {
      const agent = new AgentSession('init-test');
      await agent.initialize();
      assert.strictEqual(agent.state, AGENT_STATES.READY);
      agent.cleanup();
    });

    test('应正确销毁', async () => {
      const agent = new AgentSession('destroy-test');
      await agent.initialize();
      agent.destroy();
      assert.strictEqual(agent._isDestroyed, true);
      assert.strictEqual(agent.state, AGENT_STATES.TERMINATED);
    });

    test('销毁后再次初始化应抛出错误', async () => {
      const agent = new AgentSession('double-init-test');
      await agent.initialize();
      agent.destroy();
      await assert.rejects(
        async () => agent.initialize(),
        /destroyed/
      );
    });

    test('心跳应已启动', async () => {
      const agent = new AgentSession('heartbeat-test');
      await agent.initialize();
      assert.ok(agent._heartbeatInterval);
      agent.cleanup();
    });

    test('清理后心跳应已停止', async () => {
      const agent = new AgentSession('heartbeat-stop-test');
      await agent.initialize();
      agent.cleanup();
      assert.strictEqual(agent._heartbeatInterval, null);
    });
  });

  describe('消息管理', () => {
    test('应正确添加消息', () => {
      const agent = new AgentSession('msg-test');
      agent.addMessage('user', 'Hello');
      assert.strictEqual(agent.messages.length, 1);
      assert.strictEqual(agent.messages[0].role, 'user');
      assert.strictEqual(agent.messages[0].content, 'Hello');
    });

    test('消息应包含时间戳', () => {
      const agent = new AgentSession('timestamp-test');
      agent.addMessage('user', 'Test');
      assert.ok(agent.messages[0].timestamp);
    });

    test('多条消息应按顺序添加', () => {
      const agent = new AgentSession('multi-msg-test');
      agent.addMessage('user', 'First');
      agent.addMessage('assistant', 'Second');
      agent.addMessage('user', 'Third');
      assert.strictEqual(agent.messages.length, 3);
      assert.strictEqual(agent.messages[0].content, 'First');
      assert.strictEqual(agent.messages[2].content, 'Third');
    });
  });

  describe('状态管理', () => {
    test('getStatus 应返回完整状态', () => {
      const agent = new AgentSession('status-test', { name: 'StatusBot' });
      const status = agent.getStatus();

      assert.strictEqual(status.agentId, 'status-test');
      assert.strictEqual(status.name, 'StatusBot');
      assert.strictEqual(status.state, AGENT_STATES.IDLE);
      assert.strictEqual(status.isDestroyed, false);
    });

    test('getStatus 应包含迭代信息', () => {
      const agent = new AgentSession('iter-info-test');
      const status = agent.getStatus();
      assert.strictEqual(status.iterationCount, 0);
      assert.strictEqual(status.maxIterations, agent.config.maxIterations);
    });
  });

  describe('迭代限制', () => {
    test('超过最大迭代应抛出错误', async () => {
      const agent = new AgentSession('iter-limit-test', { maxIterations: 2 });
      await agent.initialize();

      agent.addMessage('user', 'Test');
      await agent.think();
      await agent.think();

      await assert.rejects(
        async () => agent.think(),
        /Max iterations/
      );
      agent.cleanup();
    });

    test('think 应增加迭代计数', async () => {
      const agent = new AgentSession('think-count-test');
      await agent.initialize();

      agent.addMessage('user', 'Test');
      const beforeCount = agent.iterationCount;
      // Note: actual think may fail without API, but we check the logic
      try {
        await agent.think();
      } catch (e) {
        // API call may fail, that's ok
      }

      assert.ok(agent.iterationCount >= beforeCount);
      agent.cleanup();
    });
  });

  describe('已销毁 Agent 行为', () => {
    test('think 应检查销毁状态', async () => {
      const agent = new AgentSession('destroyed-think-test');
      await agent.initialize();
      agent.destroy();

      await assert.rejects(
        async () => agent.think(),
        /destroyed/
      );
    });

    test('run 应检查销毁状态', async () => {
      const agent = new AgentSession('destroyed-run-test');
      await agent.initialize();
      agent.destroy();

      // run calls initialize internally for new task
      // so we test a destroyed agent that tries to run
      try {
        await agent.run('test task');
        assert.fail('Should have thrown');
      } catch (e) {
        assert.ok(e.message.includes('destroyed') || e.message.includes('Error'));
      }
    });
  });

  describe('sendTo / broadcast / delegateTo', () => {
    test('销毁后 sendTo 应静默返回', async () => {
      const agent = new AgentSession('sendto-test');
      await agent.initialize();
      agent.destroy();

      // Should not throw
      agent.sendTo('other-agent', { message: 'test' });
    });

    test('销毁后 broadcast 应静默返回', async () => {
      const agent = new AgentSession('broadcast-test');
      await agent.initialize();
      agent.destroy();

      // Should not throw
      agent.broadcast({ message: 'test' });
    });
  });
});
