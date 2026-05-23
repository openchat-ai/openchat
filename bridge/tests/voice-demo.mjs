import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import APIServer from '../src/api/server.js';
import { DEFAULT_PORT } from '../src/constants.js';

describe('P2P voice demo — full lifecycle', () => {
  let server;
  let base;
  const port = DEFAULT_PORT + 10; // avoid conflicts

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DISABLE_API_AUTH = 'true';
    server = new APIServer({ port });
    await server.start();
    base = `http://127.0.0.1:${port}/api/v1/voice`;
  });

  after(async () => {
    await server.stop();
  });

  async function json(path, opts = {}) {
    const url = `${base}${path}`;
    const res = await fetch(url, {
      headers: { 'content-type': 'application/json', 'connection': 'close', ...opts.headers },
      ...opts,
    });
    const body = await res.json();
    return { status: res.status, body };
  }

  let roomId;
  let participantId;

  it('1. creates a voice room', async () => {
    const { status, body } = await json('/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: 'demo-room', mode: 'adaptive' }),
    });
    assert.equal(status, 201);
    assert.ok(body.id);
    roomId = body.id;
  });

  it('2. lists rooms and sees the new room', async () => {
    const { status, body } = await json('/rooms');
    assert.equal(status, 200);
    assert.ok(body.rooms.length >= 1);
    assert.ok(body.rooms.some(r => r.id === roomId));
  });

  it('3. joins the room', async () => {
    const { status, body } = await json(`/rooms/${roomId}/join`, {
      method: 'POST',
      body: JSON.stringify({ agentId: 'demo-agent', agentType: 'test' }),
    });
    assert.equal(status, 201);
    assert.ok(body.participant);
    assert.ok(body.participant.id);
    assert.ok(body.iceServers);
    participantId = body.participant.id;
  });

  it('4. sends a WebRTC offer signal', async () => {
    const { status, body } = await json(`/rooms/${roomId}/signal`, {
      method: 'POST',
      body: JSON.stringify({
        participantId,
        signal: { type: 'offer', sdp: 'v=0\no=demo 0 0 IN IP4 127.0.0.1\n...' },
      }),
    });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.forwardedTo));
  });

  it('5. sends an ICE candidate', async () => {
    const { status, body } = await json(`/rooms/${roomId}/signal`, {
      method: 'POST',
      body: JSON.stringify({
        participantId,
        signal: { type: 'ice-candidate', candidate: 'candidate:1 1 UDP 2122252543 192.168.1.1 54321 typ host' },
      }),
    });
    assert.equal(status, 200);
    assert.equal(body.success, true);
  });

  it('6. gets room stats', async () => {
    const { status, body } = await json(`/rooms/${roomId}/stats`);
    assert.equal(status, 200);
    assert.equal(body.participantCount, 1);
    assert.ok(body.traffic);
  });

  it('7. leaves the room', async () => {
    const { status, body } = await json(`/rooms/${roomId}/leave`, {
      method: 'POST',
      body: JSON.stringify({ participantId }),
    });
    assert.equal(status, 200);
    assert.equal(body.success, true);
  });

  it('8. room has 0 participants after leave', async () => {
    const { status, body } = await json(`/rooms/${roomId}/stats`);
    assert.equal(status, 200);
    assert.equal(body.participantCount, 0);
  });
});
