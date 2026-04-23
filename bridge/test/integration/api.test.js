/**
 * API Integration Tests
 * 测试所有 23 个 API 端点
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

// 测试配置
const API_BASE = 'http://localhost:3001';
const TEST_TIMEOUT = 30000;

// HTTP 请求辅助函数
async function request(method, path, body = null) {
  const url = `${API_BASE}${path}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  } catch (error) {
    return { status: 0, error: error.message };
  }
}

// 测试数据存储
const testData = {
  agentId: null,
  messageId: null,
  skillId: null,
  updateId: null
};

describe('API Integration Tests', { timeout: TEST_TIMEOUT }, () => {

  // ==================== Health Check ====================
  describe('Health Check', () => {
    it('GET /health should return ok', async () => {
      const res = await request('GET', '/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'ok');
      assert.ok(res.data.timestamp);
    });

    it('GET /api/v1 should return API info', async () => {
      const res = await request('GET', '/api/v1');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.version, '1.0');
      assert.ok(res.data.endpoints);
    });
  });

  // ==================== Agents API ====================
  describe('Agents API (P0-02)', () => {
    it('GET /api/v1/agents should return agents list', async () => {
      const res = await request('GET', '/api/v1/agents');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.agents));
      assert.ok(typeof res.data.total === 'number');
    });

    it('POST /api/v1/agents should create new agent', async () => {
      const res = await request('POST', '/api/v1/agents', {
        role: 'custom',
        task: 'test task',
        priority: 'HIGH'
      });
      assert.strictEqual(res.status, 201);
      assert.ok(res.data.id);
      assert.strictEqual(res.data.role, 'custom');
      assert.strictEqual(res.data.status, 'RUNNING');
      testData.agentId = res.data.id;
    });

    it('GET /api/v1/agents/:id should return agent details', async () => {
      const res = await request('GET', `/api/v1/agents/${testData.agentId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.id, testData.agentId);
    });

    it('GET /api/v1/agents/:id/feedback should return agent feedback', async () => {
      const res = await request('GET', `/api/v1/agents/${testData.agentId}/feedback`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.agentId, testData.agentId);
      assert.ok(Array.isArray(res.data.feedback));
    });

    it('DELETE /api/v1/agents/:id should terminate agent', async () => {
      const res = await request('DELETE', `/api/v1/agents/${testData.agentId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'TERMINATED');
    });
  });

  // ==================== Feedback API ====================
  describe('Feedback API (P0-02)', () => {
    it('POST /api/v1/feedback/aggregate should aggregate feedback', async () => {
      const res = await request('POST', '/api/v1/feedback/aggregate', {
        agentIds: ['agent_1', 'agent_2'],
        options: { includeHistory: true }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.id);
      assert.ok(Array.isArray(res.data.agentIds));
      assert.ok(res.data.summary);
    });
  });

  // ==================== Decisions API ====================
  describe('Decisions API (P0-02)', () => {
    it('GET /api/v1/decisions should return decisions list', async () => {
      const res = await request('GET', '/api/v1/decisions');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.decisions));
    });

    it('POST /api/v1/decisions should create decision', async () => {
      const res = await request('POST', '/api/v1/decisions', {
        type: 'approve',
        feedbackIds: ['fb_1', 'fb_2'],
        reasoning: 'Test decision'
      });
      assert.strictEqual(res.status, 201);
      assert.ok(res.data.id);
      assert.strictEqual(res.data.status, 'PENDING');
    });

    it('POST /api/v1/decisions/:id/execute should execute decision', async () => {
      const res = await request('POST', '/api/v1/decisions/decision_1/execute', {
        confirmed: true
      });
      assert.ok(res.status === 200 || res.status === 404);
    });
  });

  // ==================== P2P API ====================
  describe('P2P API (P0-03)', () => {
    it('GET /api/v1/p2p/stats should return stats', async () => {
      const res = await request('GET', '/api/v1/p2p/stats');
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.peers);
      assert.ok(res.data.messages);
      assert.ok(res.data.config);
    });

    it('GET /api/v1/p2p/peers should return peers list', async () => {
      const res = await request('GET', '/api/v1/p2p/peers');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.peers));
    });

    it('GET /api/v1/p2p/inbox should return inbox', async () => {
      const res = await request('GET', '/api/v1/p2p/inbox');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.messages));
    });

    it('POST /api/v1/p2p/messages should send message', async () => {
      const res = await request('POST', '/api/v1/p2p/messages', {
        type: 'insight_share',
        payload: { data: 'test insight' },
        priority: 'NORMAL'
      });
      assert.strictEqual(res.status, 201);
      assert.ok(res.data.id);
      assert.strictEqual(res.data.status, 'PENDING');
      testData.messageId = res.data.id;
    });

    it('GET /api/v1/p2p/messages/:id should return message', async () => {
      const res = await request('GET', `/api/v1/p2p/messages/${testData.messageId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.id, testData.messageId);
    });

    it('POST /api/v1/p2p/peers/:id/connect should connect peer', async () => {
      const res = await request('POST', '/api/v1/p2p/peers/peer_test/connect', {
        peerAddress: '192.168.1.100:8080'
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.status);
    });

    it('DELETE /api/v1/p2p/peers/:id should disconnect peer', async () => {
      const res = await request('DELETE', '/api/v1/p2p/peers/peer_test');
      assert.strictEqual(res.status, 200);
    });

    it('PUT /api/v1/p2p/config should update config', async () => {
      const res = await request('PUT', '/api/v1/p2p/config', {
        maxPeers: 100,
        discoveryEnabled: true
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.config);
    });
  });

  // ==================== Updates API ====================
  describe('Updates API (P0-01)', () => {
    it('GET /api/v1/updates/available should return available versions', async () => {
      const res = await request('GET', '/api/v1/updates/available');
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.currentVersion);
      assert.ok(Array.isArray(res.data.availableVersions));
    });

    it('GET /api/v1/updates/history should return update history', async () => {
      const res = await request('GET', '/api/v1/updates/history');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.history));
      assert.ok(typeof res.data.total === 'number');
    });

    it('GET /api/v1/updates/:version should return version info', async () => {
      const res = await request('GET', '/api/v1/updates/2.0.0');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.version, '2.0.0');
    });

    it('POST /api/v1/updates/:version/apply should apply update', async () => {
      const res = await request('POST', '/api/v1/updates/2.1.0/apply', {
        autoRollbackIfFailed: true,
        preferredUpdateTime: 'immediate'
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.updateId);
      assert.strictEqual(res.data.status, 'in_progress');
      testData.updateId = res.data.updateId;
    });

    it('POST /api/v1/updates/:version/rollback should rollback', async () => {
      const res = await request('POST', '/api/v1/updates/2.0.0/rollback', {});
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.rollbackId);
    });
  });

  // ==================== Skills API ====================
  describe('Skills API (P0-04)', () => {
    it('GET /api/v1/skills should list active skills', async () => {
      const res = await request('GET', '/api/v1/skills');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.skills));
    });

    it('GET /api/v1/skills/search should search skills', async () => {
      const res = await request('GET', '/api/v1/skills/search?query=sort');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.skills));
    });

    it('POST /api/v1/skills should create skill', async () => {
      const res = await request('POST', '/api/v1/skills', {
        name: 'Test Skill',
        type: 'ALGORITHM',
        code: 'function test() { return true; }',
        description: 'A test skill'
      });
      assert.strictEqual(res.status, 201);
      assert.ok(res.data.id);
      assert.strictEqual(res.data.status, 'draft');
      testData.skillId = res.data.id;
    });

    it('GET /api/v1/skills/:id should return skill details', async () => {
      const res = await request('GET', `/api/v1/skills/${testData.skillId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.id, testData.skillId);
    });

    it('POST /api/v1/skills/:id/validate should validate skill', async () => {
      const res = await request('POST', `/api/v1/skills/${testData.skillId}/validate`, {});
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'validated');
    });

    it('POST /api/v1/skills/:id/publish should publish validated skill', async () => {
      const res = await request('POST', `/api/v1/skills/${testData.skillId}/publish`, {
        version: '1.0.0'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'active');
    });

    it('POST /api/v1/skills/:id/rate should rate skill', async () => {
      const res = await request('POST', `/api/v1/skills/${testData.skillId}/rate`, {
        rating: 4,
        comment: 'Good skill'
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.rating);
    });
  });

  // ==================== Versions API ====================
  describe('Versions API (P0-04)', () => {
    it('GET /api/v1/versions/current should return current version', async () => {
      const res = await request('GET', '/api/v1/versions/current');
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.currentVersion);
      assert.ok(res.data.status);
    });

    it('GET /api/v1/versions/history should return version history', async () => {
      const res = await request('GET', '/api/v1/versions/history');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.versions));
      assert.ok(typeof res.data.total === 'number');
    });

    it('GET /api/v1/versions/:version should return version details', async () => {
      const res = await request('GET', '/api/v1/versions/2.0.0');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.version, '2.0.0');
    });

    it('POST /api/v1/versions/:version/rollback should rollback version', async () => {
      const res = await request('POST', '/api/v1/versions/2.0.0/rollback', {});
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.rollbackId);
    });
  });

  // ==================== Resources API ====================
  describe('Resources API (P0-05)', () => {
    it('GET /api/v1/resources/status should return resource status', async () => {
      const res = await request('GET', '/api/v1/resources/status');
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.network);
      assert.ok(res.data.storage);
      assert.ok(res.data.system);
    });

    it('PUT /api/v1/resources/policy should update policy', async () => {
      const res = await request('PUT', '/api/v1/resources/policy', {
        cacheEnabled: true,
        maxStorageMB: 512
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.policy);
    });

    it('POST /api/v1/resources/cleanup should execute cleanup', async () => {
      const res = await request('POST', '/api/v1/resources/cleanup', {
        targets: ['cache', 'logs']
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.targets);
      assert.ok(res.data.totalFreedMB >= 0);
    });
  });

  // ==================== Metrics API ====================
  describe('Metrics API', () => {
    it('GET /api/v1/metrics should return metrics', async () => {
      const res = await request('GET', '/api/v1/metrics');
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.requests || res.data.metrics);
    });
  });

  // ==================== Error Handling ====================
  describe('Error Handling', () => {
    it('GET /nonexistent should return 404', async () => {
      const res = await request('GET', '/nonexistent/path');
      assert.strictEqual(res.status, 404);
    });

    it('POST /api/v1/p2p/messages with invalid type should return 400', async () => {
      const res = await request('POST', '/api/v1/p2p/messages', {
        type: 'invalid_type',
        payload: {}
      });
      assert.strictEqual(res.status, 400);
    });

    it('POST /api/v1/skills without required fields should return 400', async () => {
      const res = await request('POST', '/api/v1/skills', {
        name: 'test'
        // missing type and code
      });
      assert.strictEqual(res.status, 400);
    });
  });
});

// 测试运行说明
console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    API Integration Tests                   ║
╠═══════════════════════════════════════════════════════════╣
║ 运行测试:                                                  ║
║   cd bridge                                                ║
║   node --test test/integration/api.test.js                 ║
║                                                            ║
║ 前置条件:                                                  ║
║   - 确保 API 服务器运行在 localhost:3001                   ║
║   - 或运行: node src/main.js --headless                    ║
╚═══════════════════════════════════════════════════════════╝
`);
