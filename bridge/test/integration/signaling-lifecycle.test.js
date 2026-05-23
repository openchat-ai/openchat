import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';

const PORT = 3893;

async function createSignalingServer() {
  const srv = http.createServer();
  const wss = new WebSocketServer({ server: srv, path: '/signaling' });
  const peers = new Map();

  wss.on('connection', (ws) => {
    let registeredPeerId = null;
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type !== 'signaling_message' || !msg.data) return;
        const d = msg.data;

        if (d.action === 'register') {
          registeredPeerId = d.peerId;
          peers.set(registeredPeerId, ws);
          ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'registered', peerId: registeredPeerId } }));
          return;
        }

        if (['call-request', 'call-accept', 'call-reject', 'call-end'].includes(d.action)) {
          const targetWs = peers.get(d.toPeerId);
          if (targetWs && targetWs.readyState === 1) {
            targetWs.send(JSON.stringify({ type: 'signaling_message', data: { ...d, fromPeerId: registeredPeerId } }));
          } else if (d.action === 'call-request') {
            ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'call-error', message: 'Target peer not available' } }));
          }
          return;
        }

        if (['offer', 'answer', 'ice-candidate'].includes(d.action)) {
          const targetWs = peers.get(d.toPeerId);
          if (targetWs && targetWs.readyState === 1) {
            targetWs.send(JSON.stringify(msg));
          } else {
            ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'signal-error', message: 'Target peer not connected' } }));
          }
          return;
        }

        if (d.toPeerId) {
          const targetWs = peers.get(d.toPeerId);
          if (targetWs && targetWs.readyState === 1) {
            targetWs.send(JSON.stringify(msg));
          } else {
            ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'error', message: 'Peer not found' } }));
          }
        }
      } catch (_) {}
    });
    ws.on('close', () => { if (registeredPeerId) peers.delete(registeredPeerId); });
  });

  return new Promise((resolve) => srv.listen(PORT, () => resolve({ srv, wss, peers })));
}

function connect(path, peerId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}${path}`);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'register', peerId } }));
    });
    const timeout = setTimeout(() => reject(new Error('Connection timeout')), 3000);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'signaling_message' && msg.data?.action === 'registered') {
        clearTimeout(timeout);
        resolve(ws);
      }
    });
    ws.on('error', reject);
  });
}

function waitFor(ws, action) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout ${action}`)), 5000);
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

function nop(ws) {
  ws.on('message', () => {});
}

describe('P2P Signaling Integration — Full Call Lifecycle', () => {
  let srv, wss, peers;

  before(async () => {
    const result = await createSignalingServer();
    srv = result.srv;
    wss = result.wss;
    peers = result.peers;
  });

  after(() => {
    wss.close();
    srv.close();
  });

  it('full call lifecycle: register → offer → answer → ICE → end', async () => {
    const alice = await connect('/signaling', 'alice-lifecycle');
    const bob = await connect('/signaling', 'bob-lifecycle');

    alice.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-request', toPeerId: 'bob-lifecycle', roomId: 'lifecycle-room' }
    }));
    let data = await waitFor(bob, 'call-request');
    assert.strictEqual(data.fromPeerId, 'alice-lifecycle');

    bob.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-accept', toPeerId: 'alice-lifecycle', roomId: 'lifecycle-room' }
    }));
    data = await waitFor(alice, 'call-accept');
    assert.strictEqual(data.fromPeerId, 'bob-lifecycle');

    const offerSdp = { sdp: 'v=0\no=sample-offer', type: 'offer' };
    alice.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'offer', toPeerId: 'bob-lifecycle', sdp: offerSdp }
    }));
    data = await waitFor(bob, 'offer');
    assert.deepStrictEqual(data.sdp, offerSdp);

    const answerSdp = { sdp: 'v=0\no=sample-answer', type: 'answer' };
    bob.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'answer', toPeerId: 'alice-lifecycle', sdp: answerSdp }
    }));
    data = await waitFor(alice, 'answer');
    assert.deepStrictEqual(data.sdp, answerSdp);

    const ice = { candidate: 'candidate:1 1 UDP 2122252543 192.168.1.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    alice.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'ice-candidate', toPeerId: 'bob-lifecycle', candidate: ice }
    }));
    data = await waitFor(bob, 'ice-candidate');
    assert.deepStrictEqual(data.candidate, ice);

    alice.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-end', toPeerId: 'bob-lifecycle' }
    }));
    data = await waitFor(bob, 'call-end');
    assert.strictEqual(data.fromPeerId, 'alice-lifecycle');

    alice.close();
    bob.close();
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('peer disconnect mid-call is cleaned up', async () => {

    const alice = await connect('/signaling', 'alice-cleanup');
    const bob = await connect('/signaling', 'bob-cleanup');
    assert.strictEqual(peers.size, 2);

    bob.close();
    await new Promise(r => {
      const check = () => { if (peers.size === 1) r(); else setTimeout(check, 10); };
      check();
    });
    assert.strictEqual(peers.size, 1);

    alice.close();
    await new Promise(r => {
      const check = () => { if (peers.size === 0) r(); else setTimeout(check, 10); };
      check();
    });
    assert.strictEqual(peers.size, 0);
  });

  it('call to disconnected peer returns error', async () => {
    const alice = await connect('/signaling', 'alice-disco');
    const bob = await connect('/signaling', 'bob-disco');

    bob.close();
    await new Promise(r => setTimeout(r, 100));

    alice.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-request', toPeerId: 'bob-disco', roomId: 'room-disco' }
    }));
    const data = await waitFor(alice, 'call-error');
    assert.ok(data.message.includes('not available'));

    alice.close();
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('rejection is delivered to caller', async () => {
    const alice = await connect('/signaling', 'alice-reject');
    const bob = await connect('/signaling', 'bob-reject');

    alice.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-request', toPeerId: 'bob-reject', roomId: 'room-reject' }
    }));
    await waitFor(bob, 'call-request');

    bob.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-reject', toPeerId: 'alice-reject' }
    }));
    const data = await waitFor(alice, 'call-reject');
    assert.strictEqual(data.fromPeerId, 'bob-reject');

    alice.close();
    bob.close();
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('two concurrent independent calls do not interfere', async () => {
    const alice = await connect('/signaling', 'con-alice');
    const bob = await connect('/signaling', 'con-bob');
    const charlie = await connect('/signaling', 'con-charlie');
    const dave = await connect('/signaling', 'con-dave');

    // Alice→Bob and Charlie→Dave simultaneously
    alice.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-request', toPeerId: 'con-bob', roomId: 'room-ab' }
    }));
    charlie.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'call-request', toPeerId: 'con-dave', roomId: 'room-cd' }
    }));

    const dataBob = await waitFor(bob, 'call-request');
    const dataDave = await waitFor(dave, 'call-request');

    assert.strictEqual(dataBob.fromPeerId, 'con-alice');
    assert.strictEqual(dataBob.roomId, 'room-ab');
    assert.strictEqual(dataDave.fromPeerId, 'con-charlie');
    assert.strictEqual(dataDave.roomId, 'room-cd');

    // Exchange offers in parallel
    bob.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'offer', toPeerId: 'con-alice', sdp: { sdp: 'bob-offer', type: 'offer' } }
    }));
    dave.send(JSON.stringify({
      type: 'signaling_message',
      data: { action: 'offer', toPeerId: 'con-charlie', sdp: { sdp: 'dave-offer', type: 'offer' } }
    }));

    const offerAlice = await waitFor(alice, 'offer');
    const offerCharlie = await waitFor(charlie, 'offer');
    assert.strictEqual(offerAlice.sdp.sdp, 'bob-offer');
    assert.strictEqual(offerCharlie.sdp.sdp, 'dave-offer');

    alice.close();
    bob.close();
    charlie.close();
    dave.close();
    await new Promise(resolve => setTimeout(resolve, 50));
  });
});
