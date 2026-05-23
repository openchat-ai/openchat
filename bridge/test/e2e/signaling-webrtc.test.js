import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { WebSocket } from 'ws';

const SIGNALING_PORT = 3882;
let server, bridge;

async function createServer() {
  const http = await import('node:http');
  const { WebSocketServer } = await import('ws');

  const srv = http.createServer();
  const wss = new WebSocketServer({ server: srv, path: '/signaling' });
  const peers = new Map();

  wss.on('connection', (ws) => {
    let registeredPeerId = null;
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'signaling_message' && msg.data) {
          const d = msg.data;

          if (d.action === 'register') {
            registeredPeerId = d.peerId;
            peers.set(registeredPeerId, ws);
            ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'registered', peerId: registeredPeerId } }));
            return;
          }

          if (d.action === 'call-request') {
            const targetWs = peers.get(d.toPeerId);
            if (targetWs && targetWs.readyState === 1) {
              targetWs.send(JSON.stringify({
                type: 'signaling_message',
                data: { action: 'call-request', fromPeerId: registeredPeerId, roomId: d.roomId }
              }));
            } else {
              ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'call-error', message: 'Target peer not available' } }));
            }
            return;
          }

          if (d.action === 'call-accept') {
            const targetWs = peers.get(d.toPeerId);
            if (targetWs && targetWs.readyState === 1) {
              targetWs.send(JSON.stringify({
                type: 'signaling_message',
                data: { action: 'call-accept', fromPeerId: registeredPeerId, roomId: d.roomId }
              }));
            }
            return;
          }

          if (d.action === 'call-reject') {
            const targetWs = peers.get(d.toPeerId);
            if (targetWs && targetWs.readyState === 1) {
              targetWs.send(JSON.stringify({
                type: 'signaling_message',
                data: { action: 'call-reject', fromPeerId: registeredPeerId }
              }));
            }
            return;
          }

          if (d.action === 'call-end') {
            const targetWs = peers.get(d.toPeerId);
            if (targetWs && targetWs.readyState === 1) {
              targetWs.send(JSON.stringify({
                type: 'signaling_message',
                data: { action: 'call-end', fromPeerId: registeredPeerId }
              }));
            }
            return;
          }

          if (d.action === 'offer' || d.action === 'answer' || d.action === 'ice-candidate') {
            const targetWs = peers.get(d.toPeerId);
            if (targetWs && targetWs.readyState === 1) {
              targetWs.send(JSON.stringify(msg));
            } else {
              ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'signal-error', message: 'Target peer not connected' } }));
            }
            return;
          }
        }
      } catch (_) {}
    });
    ws.on('close', () => { if (registeredPeerId) peers.delete(registeredPeerId); });
  });

  return new Promise((resolve) => { srv.listen(SIGNALING_PORT, () => resolve(srv)); });
}

function wsConnect(path, peerId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${SIGNALING_PORT}${path}`);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'register', peerId } }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'signaling_message' && msg.data?.action === 'registered') {
        resolve(ws);
      }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 3000);
  });
}

function waitForMessage(ws, action) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${action}`)), 3000);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'signaling_message' && msg.data?.action === action) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);
        resolve(msg.data);
      }
    };
    ws.on('message', handler);
  });
}

describe('WebRTC Signaling via WebSocket', () => {
  before(async () => {
    server = await createServer();
  });

  after(() => {
    if (server) server.close();
  });

  it('two peers can register and exchange call-request', async () => {
    const alice = await wsConnect('/signaling', 'alice-001');
    const bob = await wsConnect('/signaling', 'bob-002');

    alice.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-request', toPeerId: 'bob-002', roomId: 'room-001' }
    }));

    const data = await waitForMessage(bob, 'call-request');
    assert.strictEqual(data.fromPeerId, 'alice-001');
    assert.strictEqual(data.roomId, 'room-001');

    alice.close();
    bob.close();
  });

  it('call-accept is forwarded to caller', async () => {
    const alice = await wsConnect('/signaling', 'alice-003');
    const bob = await wsConnect('/signaling', 'bob-004');

    bob.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-accept', toPeerId: 'alice-003', roomId: 'room-002' }
    }));

    const data = await waitForMessage(alice, 'call-accept');
    assert.strictEqual(data.fromPeerId, 'bob-004');

    alice.close();
    bob.close();
  });

  it('call-reject is forwarded to caller', async () => {
    const alice = await wsConnect('/signaling', 'alice-005');
    const bob = await wsConnect('/signaling', 'bob-006');

    bob.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-reject', toPeerId: 'alice-005' }
    }));

    const data = await waitForMessage(alice, 'call-reject');
    assert.strictEqual(data.fromPeerId, 'bob-006');

    alice.close();
    bob.close();
  });

  it('offer/answer SDP exchange between peers', async () => {
    const alice = await wsConnect('/signaling', 'alice-007');
    const bob = await wsConnect('/signaling', 'bob-008');

    const offerSdp = { sdp: 'v=0...', type: 'offer' };
    alice.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'offer', toPeerId: 'bob-008', sdp: offerSdp }
    }));

    const offerData = await waitForMessage(bob, 'offer');
    assert.deepStrictEqual(offerData.sdp, offerSdp);

    const answerSdp = { sdp: 'v=0...answer', type: 'answer' };
    bob.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'answer', toPeerId: 'alice-007', sdp: answerSdp }
    }));

    const answerData = await waitForMessage(alice, 'answer');
    assert.deepStrictEqual(answerData.sdp, answerSdp);

    alice.close();
    bob.close();
  });

  it('ICE candidate exchange between peers', async () => {
    const alice = await wsConnect('/signaling', 'alice-009');
    const bob = await wsConnect('/signaling', 'bob-010');

    const iceCandidate = { candidate: 'candidate:1...', sdpMid: '0', sdpMLineIndex: 0 };
    alice.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'ice-candidate', toPeerId: 'bob-010', candidate: iceCandidate }
    }));

    const data = await waitForMessage(bob, 'ice-candidate');
    assert.deepStrictEqual(data.candidate, iceCandidate);

    alice.close();
    bob.close();
  });

  it('call-end terminates session', async () => {
    const alice = await wsConnect('/signaling', 'alice-011');
    const bob = await wsConnect('/signaling', 'bob-012');

    alice.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-end', toPeerId: 'bob-012' }
    }));

    const data = await waitForMessage(bob, 'call-end');
    assert.strictEqual(data.fromPeerId, 'alice-011');

    alice.close();
    bob.close();
  });

  it('registration returns peerId', async () => {
    const ws = await wsConnect('/signaling', 'test-peer');
    ws.close();
  });

  it('call to unknown peer returns error', async () => {
    const alice = await wsConnect('/signaling', 'alice-013');
    const errorPromise = waitForMessage(alice, 'call-error');

    alice.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-request', toPeerId: 'nonexistent', roomId: 'room-003' }
    }));

    const data = await errorPromise;
    assert.ok(data.message.includes('not available'));

    alice.close();
  });
});
