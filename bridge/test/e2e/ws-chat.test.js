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
      wss.on('connection', (ws) => {
        ws.send(JSON.stringify({
          type: 'bridge_handshake',
          data: { clientId: 'e2e-test', version: 2 },
        }));

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'chat' && msg.data?.message) {
              ws.send(JSON.stringify({
                type: 'chat_response',
                data: { reply: `Echo: ${msg.data.message}` },
              }));
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
        // Send chat message
        ws.send(JSON.stringify({
          type: 'chat',
          data: { message: '你好', sessionId: 'e2e-test' },
        }));
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

    // Assert handshake
    assert.strictEqual(messages[0].type, 'bridge_handshake');
    assert.ok(messages[0].data.clientId);

    // Assert reply
    assert.strictEqual(messages[1].type, 'chat_response');
    assert.ok(messages[1].data.reply);
  });
});
