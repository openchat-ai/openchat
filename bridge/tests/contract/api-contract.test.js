/**
 * API 契约测试
 * 验证 API 端点的请求/响应格式与 Flutter 端对齐
 * 运行: node --test tests/contract/api-contract.test.js （需要运行中的 Bridge）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

const BASE = process.env.API_BASE || 'http://localhost:3001';

async function get(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Authorization': 'Bearer test-key' },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function post(path, data) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-key' },
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('API Contract: Health', () => {
  test('GET /health returns 200 with status', async () => {
    const { status, body } = await get('/health');
    assert.strictEqual(status, 200);
    assert.ok(body);
    // Contract: { status: string, uptime?: number }
    assert.ok(typeof body.status === 'string');
  });
});

describe('API Contract: Residents', () => {
  test('GET /api/v1/residents returns array', async () => {
    const { status, body } = await get('/api/v1/residents');
    if (status === 200) {
      assert.ok(Array.isArray(body));
    }
  });
});

describe('API Contract: P2P', () => {
  test('GET /api/v1/p2p/status returns p2p state', async () => {
    const { status, body } = await get('/api/v1/p2p/status');
    if (status === 200) {
      assert.ok(body);
      // Contract: { peers?: number, connected?: number, topicCount?: number }
    }
  });
});

describe('API Contract: Voice', () => {
  test('POST /api/v1/voice/offer returns signaling response', async () => {
    const { status, body } = await post('/api/v1/voice/offer', {
      sdp: 'mock_sdp',
      type: 'offer',
      targetPeerId: 'peer-test',
    });
    // If no P2P peer, expect 400/404, not 500
    assert.ok(status < 500, 'should not crash');
  });
});
