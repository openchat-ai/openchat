// Test TopicRegistry cross-node sync via direct TCP
import net from 'net';
import { P2PNet } from './src/p2p/p2p-net.js';

async function test() {
  console.log('=== TopicRegistry Cross-Node Test ===\n');

  // Create two P2PNet nodes in-process (same as running two Bridges)
  const peerA = new P2PNet({ identity: { name: 'alice-bridge' } });
  const peerB = new P2PNet({ identity: { name: 'bob-bridge' }, knownPeers: [{ host: 'localhost', port: 3801 }] });

  // Start TCP listener on A
  peerA.listenDirect(3801);

  // Start B (connects to A)
  await peerB.start();
  console.log('  Both nodes started\n');

  // Wait for connection
  await new Promise(r => setTimeout(r, 1000));

  // Register topic on A
  peerA.topicRegistry.announce('voice-call-test-1', 'device-phone-xiaomi');
  console.log('  [A] Announced: voice-call-test-1 → device-phone-xiaomi');

  // Wait for gossip sync
  await new Promise(r => setTimeout(r, 1000));

  // Query from A (local)
  const localPeers = await peerA.topicRegistry.getPeers('voice-call-test-1');
  console.log(`  [A] Local peers: ${localPeers.length}`);
  for (const p of localPeers) console.log(`      peerId: ${p.peerId}`);

  // Query from B (cross-node via gossip)
  const remotePeers = await peerB.topicRegistry.getPeers('voice-call-test-1');
  console.log(`\n  [B] Cross-node peers via gossip: ${remotePeers.length}`);
  for (const p of remotePeers) console.log(`      peerId: ${p.peerId}`);

  // Register topic on B
  peerB.topicRegistry.announce('voice-call-test-1', 'device-phone-samsung');
  console.log('\n  [B] Announced: voice-call-test-1 → device-phone-samsung');
  await new Promise(r => setTimeout(r, 1000));

  // Query from A (should see both)
  const allPeers = await peerA.topicRegistry.getPeers('voice-call-test-1');
  console.log(`\n  [A] All peers after B's announcement: ${allPeers.length}`);
  for (const p of allPeers) console.log(`      peerId: ${p.peerId}`);

  // Result
  if (remotePeers.length === 1 && allPeers.length === 2) {
    console.log('\n✅ TopicRegistry cross-node sync WORKS');
  } else {
    console.log('\n❌ TopicRegistry cross-node sync FAILED');
    console.log(`   Expected A=1, AB=2. Got A=${remotePeers.length}, AB=${allPeers.length}`);
  }

  // Cleanup
  peerA.stop();
  peerB.stop();
  console.log('\nDone.');
}

test().catch(e => console.error('Error:', e.message));
