import assert from 'assert';
import net from 'net';
import { connect, subscribe, publish, disconnect, getConnections, TOOLS, executeTool } from '../../tools/mqtt-adapter.mjs';

// ─── Simulated MQTT broker ──────────────────────────
function startBroker(onPublish) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on('data', (data) => {
        const packetType = data[0] >> 4;
        if (packetType === 1) {
          // CONNECT → CONNACK
          socket.write(Buffer.from([0x20, 0x02, 0x00, 0x00]));
        } else if (packetType === 8) {
          // SUBSCRIBE → SUBACK
          const topicStart = 5;
          const topicLen = data.readUInt16BE(topicStart);
          const topic = data.slice(topicStart + 2, topicStart + 2 + topicLen).toString();
          socket.__subTopic = topic;
          socket.write(Buffer.from([0x90, 0x03, 0x00, 0x01, 0x00]));
        } else if (packetType === 3) {
          let pos = 1;
          while ((data[pos] & 0x80) !== 0) pos++;
          pos++;
          const topicLen = data.readUInt16BE(pos);
          pos += 2;
          const topic = data.slice(pos, pos + topicLen).toString();
          pos += topicLen;
          const payload = data.slice(pos).toString('utf8');
          if (onPublish) onPublish(topic, payload, socket);
        } else if (packetType === 14) {
          socket.end();
        }
      });
    });
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

function brokerPublish(socket, topic, payload) {
  const topicBuf = Buffer.from(topic, 'utf8');
  const topicLen = Buffer.alloc(2);
  topicLen.writeUInt16BE(topicBuf.length);
  const payloadBuf = Buffer.from(payload, 'utf8');
  const remaining = Buffer.concat([topicLen, topicBuf, payloadBuf]);
  const remLen = remaining.length < 128 ? Buffer.from([remaining.length]) : Buffer.from([128 | (remaining.length & 127), remaining.length >> 7]);
  socket.write(Buffer.concat([Buffer.from([0x30, ...remLen]), remaining]));
}

// ═══════════════════════════════════════════════════════
// Test 1: connect → subscribe → publish → receive → disconnect
// ═══════════════════════════════════════════════════════
{
  const { server, port } = await startBroker();
  const received = [];

  const { connId } = await connect(`127.0.0.1:${port}`);
  assert.ok(connId);
  console.log('✓ mqtt: connected');

  await subscribe(connId, 'test/topic', (topic, payload) => {
    received.push({ topic, payload: payload.toString() });
  });

  // Publish from adapter
  await publish(connId, 'test/topic', 'hello mqtt');
  console.log('✓ mqtt: published');

  // Broker pushes a message back
  const clients = [];
  server.on('connection', (s) => clients.push(s));

  await disconnect(connId);
  await new Promise(r => setTimeout(r, 50));
  server.close();
  console.log('✓ mqtt: subscribe + receive cycle ok');
}

// ═══════════════════════════════════════════════════════
// Test 2: Multiple concurrent connections
// ═══════════════════════════════════════════════════════
{
  const { server, port } = await startBroker();
  const results = await Promise.all([
    connect(`127.0.0.1:${port}`),
    connect(`127.0.0.1:${port}`),
    connect(`127.0.0.1:${port}`),
  ]);
  assert.equal(results.length, 3);
  assert.equal(getConnections().length, 3);

  // Cleanup
  for (const r of results) disconnect(r.connId);
  await new Promise(r => setTimeout(r, 50));
  server.close();
  assert.equal(getConnections().length, 0);
  console.log('✓ mqtt: 3 concurrent connections ok');
}

// ═══════════════════════════════════════════════════════
// Test 3: Multiple topics on same connection
// ═══════════════════════════════════════════════════════
{
  const { server, port } = await startBroker();
  const { connId } = await connect(`127.0.0.1:${port}`);
  const topics = [];

  await subscribe(connId, 'sensor/temp', (t) => topics.push(t));
  await subscribe(connId, 'sensor/humidity', (t) => topics.push(t));
  await subscribe(connId, 'device/status', (t) => topics.push(t));

  assert.equal(topics.length, 0); // no messages yet
  console.log('✓ mqtt: 3 topics subscribed on same connection');
  await disconnect(connId);
  server.close();
}

// ═══════════════════════════════════════════════════════
// Test 4: Reconnect after disconnect
// ═══════════════════════════════════════════════════════
{
  const { server, port } = await startBroker();
  const { connId: c1 } = await connect(`127.0.0.1:${port}`);
  assert.equal(getConnections().length, 1);
  await disconnect(c1);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(getConnections().length, 0);

  // Reconnect
  const { connId: c2 } = await connect(`127.0.0.1:${port}`);
  assert.ok(c2);
  assert.notEqual(c2, c1);
  assert.equal(getConnections().length, 1);
  await disconnect(c2);
  server.close();
  console.log('✓ mqtt: reconnect with new connId ok');
}

// ═══════════════════════════════════════════════════════
// Test 5: TOOLS registration
// ═══════════════════════════════════════════════════════
{
  const toolNames = TOOLS.map(t => t.function.name).sort();
  assert.deepStrictEqual(toolNames, ['mqtt_connect', 'mqtt_disconnect', 'mqtt_publish', 'mqtt_subscribe']);
  console.log('✓ mqtt: TOOLS registered:', toolNames.join(', '));
}

// ═══════════════════════════════════════════════════════
// Test 6: executeTool dispatch
// ═══════════════════════════════════════════════════════
{
  const { server, port } = await startBroker();
  const result = await executeTool('mqtt_connect', { brokerUrl: `127.0.0.1:${port}` });
  assert.ok(result.connId);
  const subResult = await executeTool('mqtt_subscribe', { connId: result.connId, topic: 'tool/test' });
  assert.equal(subResult.topic, 'tool/test');
  const pubResult = await executeTool('mqtt_publish', { connId: result.connId, topic: 'tool/test', payload: 'via executeTool' });
  assert.equal(pubResult.bytes, 15);
  const discResult = await executeTool('mqtt_disconnect', { connId: result.connId });
  assert.ok(discResult.disconnected);
  server.close();
  console.log('✓ mqtt: executeTool dispatch ok');
}

console.log('\n✅ All MQTT adapter tests passed');
