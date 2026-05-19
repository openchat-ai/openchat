/**
 * AgentSession Jest 测试
 * 运行: npx jest --watch
 */

import { jest } from '@jest/globals';
import { AgentSession, AGENT_STATES } from '../agent-session.js';

// Mock dependencies
jest.mock('../../memory/persistent-config.js', () => ({
  persistentConfig: {
    getPreference: jest.fn((key) => {
      if (key === 'currentProvider') return 'openrouter';
      if (key === 'currentModel') return 'auto';
      return null;
    }),
    getApiKey: jest.fn(() => 'test-api-key'),
    listProviders: jest.fn(() => ['openrouter'])
  }
}));

jest.mock('../providers/provider-manager.js', () => ({
  providerManager: {
    getProviderConfig: jest.fn(() => ({
      baseUrl: 'https://openrouter.ai/api',
      chatEndpoint: '/v1/chat/completions',
      defaultModel: 'auto'
    })),
    getDefaultModel: jest.fn(() => 'auto')
  },
  DEFAULT_PROVIDER: 'openrouter'
}));

describe('AgentSession', () => {
  describe('构造函数', () => {
    it('应创建带有默认配置的实例', () => {
      const agent = new AgentSession('test-id');
      expect(agent.agentId).toBe('test-id');
      expect(agent.state).toBe(AGENT_STATES.IDLE);
    });

    it('应接受自定义配置', () => {
      const agent = new AgentSession('test-id', {
        name: 'CustomAgent',
        maxIterations: 5
      });
      expect(agent.config.name).toBe('CustomAgent');
      expect(agent.config.maxIterations).toBe(5);
    });
  });

  describe('生命周期', () => {
    it('应正确初始化', async () => {
      const agent = new AgentSession('init-test');
      await agent.initialize();
      expect(agent.state).toBe(AGENT_STATES.READY);
      agent.cleanup();
    });

    it('应正确销毁', async () => {
      const agent = new AgentSession('destroy-test');
      await agent.initialize();
      agent.destroy();
      expect(agent._isDestroyed).toBe(true);
      expect(agent.state).toBe(AGENT_STATES.TERMINATED);
    });

    it('销毁后再次初始化应抛出错误', async () => {
      const agent = new AgentSession('double-init-test');
      await agent.initialize();
      agent.destroy();
      await expect(agent.initialize()).rejects.toThrow('destroyed');
    });
  });

  describe('消息管理', () => {
    it('应正确添加消息', () => {
      const agent = new AgentSession('msg-test');
      agent.addMessage('user', 'Hello');
      expect(agent.messages.length).toBe(1);
      expect(agent.messages[0].role).toBe('user');
      expect(agent.messages[0].content).toBe('Hello');
    });

    it('消息应包含时间戳', () => {
      const agent = new AgentSession('timestamp-test');
      agent.addMessage('user', 'Test');
      expect(agent.messages[0].timestamp).toBeDefined();
    });
  });

  describe('状态管理', () => {
    it('getStatus 应返回完整状态', () => {
      const agent = new AgentSession('status-test', { name: 'StatusBot' });
      const status = agent.getStatus();

      expect(status.agentId).toBe('status-test');
      expect(status.name).toBe('StatusBot');
      expect(status.state).toBe(AGENT_STATES.IDLE);
      expect(status.isDestroyed).toBe(false);
    });
  });

  describe('迭代限制', () => {
    it('超过最大迭代应抛出错误', async () => {
      const agent = new AgentSession('iter-test', { maxIterations: 2 });
      await agent.initialize();

      agent.addMessage('user', 'Test');
      await agent.think();
      await agent.think();

      await expect(agent.think()).rejects.toThrow('Max iterations');
      agent.cleanup();
    });
  });

  describe('已销毁 Agent 行为', () => {
    it('think 应检查销毁状态', async () => {
      const agent = new AgentSession('destroyed-think-test');
      await agent.initialize();
      agent.destroy();

      await expect(agent.think()).rejects.toThrow('destroyed');
    });
  });
});
