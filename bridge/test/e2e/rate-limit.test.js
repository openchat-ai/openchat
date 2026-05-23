import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';

describe('e2e: WebSocket rate limiting', () => {
  let httpServer;
  let wss;
  let port;

  before(() => {
    return new Promise(r => {
      httpServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      });

      wss = new WebSocketServer({ server: httpServer, path: '/ws' });
      wss.on('connection', (ws) => {
        const msgCount = { count: 0, lastReset: Date.now() };
        ws.send(JSON.stringify({
          type: 'bridge_handshake',
          data: { clientId: 'rate-test', version: 2, peerId: 'rate-test-client' },
        }));

        ws.on('message', (data) => {
          const now = Date.now();
          if (now - msgCount.lastReset > 1000) { msgCount.count = 0; msgCount.lastReset = now; }
          msgCount.count++;
          if (msgCount.count > 20) {
            ws.send(JSON.stringify({ type: 'error', data: { message: 'rate limit exceeded' } }));
            return;
          }
          try {
            const msg = JSON.parse(data.toString());
            ws.send(JSON.stringify({ type: 'chat_response', data: { reply: `ok: ${msg.data?.message || ''}` } }));
          } catch {
            ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid JSON' } }));
          }
        });
      });

      httpServer.listen(0, () => {
        port = httpServer.address().port;
        r();
      });
    });
  });

  after(() => {
    wss?.close();
    httpServer?.close();
  });

  test('rate limit: 20 fast messages within 1 second triggers error', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise(r => ws.on('open', r));
    await new Promise(r => ws.on('message', r));

    const received = [];
    ws.on('message', (data) => {
      received.push(JSON.parse(data.toString()));
    });

    for (let i = 0; i < 25; i++) {
      ws.send(JSON.stringify({ type: 'chat', data: { message: `msg-${i}`, sessionId: 'rate-test' } }));
    }
    await new Promise(r => setTimeout(r, 500));

    const errors = received.filter(m => m.type === 'error' && m.data?.message?.includes('rate limit'));
    assert.ok(errors.length >= 1, `expected rate limit errors, got ${received.length} msgs`);
    ws.close();
  });

  test('rate limit: normal rate (5/sec) is not throttled', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise(r => ws.on('open', r));
    await new Promise(r => ws.on('message', r));

    const received = [];
    ws.on('message', (data) => {
      received.push(JSON.parse(data.toString()));
    });

    for (let i = 0; i < 5; i++) {
      ws.send(JSON.stringify({ type: 'chat', data: { message: `normal-${i}`, sessionId: 'rate-test' } }));
      await new Promise(r => setTimeout(r, 250));
    }
    await new Promise(r => setTimeout(r, 500));

    const errors = received.filter(m => m.type === 'error');
    assert.strictEqual(errors.length, 0, `expected 0 errors, got ${errors.length}`);
    ws.close();
  });
});
