import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { TopicRegistry, default as TopicRegistryDefault } from '../topic-registry.js';

describe('TopicRegistry gossip sync', () => {
  let nodeA, nodeB;
  const messages = [];

  before(() => {
    nodeA = new TopicRegistry({ ttl: 5000 });
    nodeB = new TopicRegistry({ ttl: 5000 });

    // Wire A -> B via mock send
    nodeA.setP2PSend((msg) => {
      const result = nodeB.handleMessage(msg);
      return result;
    });

    nodeB.setP2PSend((msg) => {
      const result = nodeA.handleMessage(msg);
      return result;
    });
  });

  after(() => {
    nodeA._timer?.unref?.();
    nodeB._timer?.unref?.();
  });

  test('announce on nodeA discoverable from nodeB', async () => {
    nodeA.announce('topic:chat:lobby', 'peer-111', { nick: 'alice' });
    const peers = await nodeB.getPeers('topic:chat:lobby');
    assert.ok(Array.isArray(peers));
    assert.strictEqual(peers.length, 1);
    assert.strictEqual(peers[0].peerId, 'peer-111');
    assert.strictEqual(peers[0].nick, 'alice');
  });

  test('announce on nodeB discoverable from nodeA', async () => {
    nodeB.announce('topic:chat:lobby', 'peer-222', { nick: 'bob' });
    const peers = await nodeA.getPeers('topic:chat:lobby');
    assert.strictEqual(peers.length, 2);
    assert.ok(peers.some(p => p.peerId === 'peer-222'));
  });

  test('excludePeerId filters local peer', async () => {
    const peers = await nodeA.getPeers('topic:chat:lobby', 'peer-111');
    assert.strictEqual(peers.length, 1);
    assert.strictEqual(peers[0].peerId, 'peer-222');
  });

  test('non-existent topic returns empty', async () => {
    const peers = await nodeA.getPeers('topic:nonexistent');
    assert.strictEqual(peers.length, 0);
  });

  test('leave removes peer from both nodes', async () => {
    nodeA.leave('topic:chat:lobby', 'peer-111');
    const peers = await nodeB.getPeers('topic:chat:lobby');
    assert.strictEqual(peers.length, 1);
    assert.strictEqual(peers[0].peerId, 'peer-222');
  });

  test('ttl expiry cleans stale peers', async () => {
    const nodeC = new TopicRegistry({ ttl: 500 });
    nodeC.setP2PSend(() => {});
    nodeC.announce('topic:temp', 'peer-stale', {});

    const before = nodeC._getLocalPeers('topic:temp');
    assert.strictEqual(before.length, 1);

    await new Promise(r => setTimeout(r, 600));
    const after = nodeC._getLocalPeers('topic:temp');
    assert.strictEqual(after.length, 0);
    nodeC._timer?.unref?.();
  });
});

describe('TopicRegistry edge cases', () => {
  test('handleMessage with null msg does nothing', async () => {
    const reg = new TopicRegistry({ ttl: 5000 });
    reg.handleMessage(null);
    reg.handleMessage({});
    reg.handleMessage({ topic: 't', peerId: null });
    const peers = await reg.getPeers('t');
    assert.strictEqual(peers.length, 0);
    reg._timer?.unref?.();
  });

  test('multiple topics isolated', async () => {
    const reg = new TopicRegistry({ ttl: 5000 });
    reg.setP2PSend(() => {});
    reg.announce('topic:games', 'p1');
    reg.announce('topic:music', 'p2');
    assert.strictEqual((await reg.getPeers('topic:games')).length, 1);
    assert.strictEqual((await reg.getPeers('topic:music')).length, 1);
    assert.strictEqual((await reg.getPeers('topic:games'))[0].peerId, 'p1');
    reg._timer?.unref?.();
  });
});
