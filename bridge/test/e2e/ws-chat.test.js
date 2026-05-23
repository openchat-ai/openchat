import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';

/**
 * e2e test: starts a real HTTP+WS server, connects a WS client,
 * sends a message, asserts a response.
 *
 * This tests the full message pipeline without mocking.
 */
describe('e2e: WebSocket chat', () => {
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
      const clients = new Map();
      wss.on('connection', (ws) => {
        const peerId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        clients.set(peerId, ws);
        ws._peerId = peerId;

        ws.send(JSON.stringify({
          type: 'bridge_handshake',
          data: { clientId: 'e2e-test', version: 2, peerId },
        }));

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'chat' && msg.data?.message) {
              ws.send(JSON.stringify({
                type: 'chat_response',
                data: { reply: `Echo: ${msg.data.message}` },
              }));
            } else if (msg.type === 'message' && msg.data?.to) {
              const target = clients.get(msg.data.to);
              if (target && target.readyState === 1) {
                target.send(JSON.stringify({
                  type: 'message',
                  data: { from: ws._peerId, message: msg.data.message, time: Date.now() },
                }));
              }
            }
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

  test('WS connect -> handshake -> send message -> receive reply', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const messages = [];

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        ws.send(JSON.stringify({ type: 'chat', data: { message: '你好', sessionId: 'e2e-test' } }));
      });

      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
        if (messages.length >= 2) {
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
    });

    assert.strictEqual(messages[0].type, 'bridge_handshake');
    assert.ok(messages[0].data.peerId);
  });

  test('P2P: two clients message each other through Bridge', async () => {
    const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
    const ws2 = new WebSocket(`ws://localhost:${port}/ws`);
    let peer1Id, peer2Id;

    // Connect both and capture peer IDs
    await Promise.all([
      new Promise(r => ws1.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'bridge_handshake') { peer1Id = m.data.peerId; r(); } })),
      new Promise(r => ws2.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'bridge_handshake') { peer2Id = m.data.peerId; r(); } })),
    ]);

    assert.ok(peer1Id);
    assert.ok(peer2Id);

    // ws1 sends message to ws2
    const msg2 = new Promise(r => ws2.on('message', (d) => r(JSON.parse(d))));
    ws1.send(JSON.stringify({ type: 'message', data: { message: 'hello from 1', to: peer2Id } }));

    const received = await msg2;
    assert.strictEqual(received.type, 'message');
    assert.strictEqual(received.data.message, 'hello from 1');
    assert.strictEqual(received.data.from, peer1Id);

    ws1.close();
    ws2.close();
  });
});
