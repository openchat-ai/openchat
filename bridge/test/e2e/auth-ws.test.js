import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';

function wsRejected(url) {
  return new Promise((resolve) => {
    const req = http.request(url.replace('ws://', 'http://'), {
      method: 'GET',
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    req.on('response', (res) => {
      resolve(res.statusCode === 401);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

describe('e2e: WebSocket authentication', () => {
  let httpServer;
  let wss;
  let port;

  before(() => {
    return new Promise(r => {
      httpServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      });

      const VALID_TOKENS = ['secret-token-123', 'another-token'];
      wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
        verifyClient: (info, cb) => {
          const url = new URL(info.req.url || '', `http://${info.req.headers.host || 'localhost'}`);
          const token = url.searchParams.get('token');
          if (!token || !VALID_TOKENS.includes(token)) {
            cb(false, 401, 'Unauthorized');
            return;
          }
          cb(true);
        },
      });
      wss.on('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'bridge_handshake', data: { clientId: 'auth-test', version: 2, peerId: 'auth-client' } }));
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

  test('WS connection without token is rejected', async () => {
    const rejected = await wsRejected(`ws://localhost:${port}/ws`);
    assert.ok(rejected, 'connection without token should be rejected');
  });

  test('WS connection with invalid token is rejected', async () => {
    const rejected = await wsRejected(`ws://localhost:${port}/ws?token=wrong-token`);
    assert.ok(rejected, 'connection with bad token should be rejected');
  });

  test('WS connection with valid token succeeds', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=secret-token-123`);
    const msg = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 3000);
      ws.on('message', (data) => {
        clearTimeout(t);
        resolve(JSON.parse(data.toString()));
      });
      ws.on('error', reject);
    });
    assert.strictEqual(msg.type, 'bridge_handshake');
    assert.ok(msg.data.peerId);
    ws.close();
  });
});
