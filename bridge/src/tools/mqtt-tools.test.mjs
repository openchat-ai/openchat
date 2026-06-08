import { create, ok, ng } from '../experiments/lib/report.mjs';
import { createMockBroker } from '../experiments/33-mqtt-auto/index.mjs';
import { mqttConnect, mqttSubscribe, mqttPublish, mqttDisconnect, executeTool } from './mqtt-tools.mjs';

export async function test() {
  const { ok, ng, skip, report } = create();
  const NAME = 'MQTT-Tools';

  const broker = createMockBroker();
  await new Promise(r => broker.listen(0, '127.0.0.1', r));
  const port = broker.address().port;

  try {
    // 1. connect
    try {
      const c = await mqttConnect('127.0.0.1', port, 'test-tools-1');
      ok(`connect: connId=${c.connId}, rc=${c.returnCode}`);

      // 2. subscribe
      try {
        const sr = await mqttSubscribe(c.connId, 'test/topic', 0);
        if (sr.returnCodes[0] === 0) ok('subscribe: SUBACK accepted');
        else ng(`subscribe: returnCode=${sr.returnCodes[0]}`);
      } catch (e) { ng('subscribe', e); }

      // 3. publish QoS 0
      try {
        await mqttPublish(c.connId, 'test/topic', 'hello', 0);
        ok('publish QoS0');
      } catch (e) { ng('publish QoS0', e); }

      // 4. publish QoS 1
      try {
        await mqttPublish(c.connId, 'test/topic', 'qos1 msg', 1);
        ok('publish QoS1');
      } catch (e) { ng('publish QoS1', e); }

      // 5. disconnect
      try {
        await mqttDisconnect(c.connId);
        ok('disconnect');
      } catch (e) { ng('disconnect', e); }

    } catch (e) { ng('connect phase', e); }

    // 6. executeTool routing
    try {
      const c2 = await executeTool('mqtt_connect', { host: '127.0.0.1', port, clientId: 'exec-test' });
      ok('executeTool connect');

      const sub = await executeTool('mqtt_subscribe', { connId: c2.connId, topic: 'test/#' });
      if (sub.returnCodes[0] === 0) ok('executeTool subscribe');
      else ng(`executeTool subscribe: rc=${sub.returnCodes[0]}`);

      const pub = await executeTool('mqtt_publish', { connId: c2.connId, topic: 'test/hello', payload: 'world' });
      if (pub.ok) ok('executeTool publish');
      else ng('executeTool publish failed');

      const disc = await executeTool('mqtt_disconnect', { connId: c2.connId });
      if (disc.ok) ok('executeTool disconnect');
      else ng('executeTool disconnect failed');
    } catch (e) { ng('executeTool phase', e); }

    // 7. auto-generated clientId
    try {
      const c3 = await mqttConnect('127.0.0.1', port);
      ok(`auto clientId: connId=${c3.connId}`);
      await mqttDisconnect(c3.connId);
    } catch (e) { ng('auto clientId', e); }

    // 8. CONNACK refused
    try {
      const refBroker = createMockBroker({ refuseConnack: 5 });
      await new Promise(r => refBroker.listen(0, '127.0.0.1', r));
      const refPort = refBroker.address().port;
      try {
        await mqttConnect('127.0.0.1', refPort, 'refused', { timeout: 2000 });
        ng('CONNACK refused should throw');
      } catch (e) {
        if (e.message.includes('CONNACK refused')) ok('CONNACK refused: ' + e.message.substring(0, 30));
        else ng('refused error: ' + e.message.substring(0, 30));
      }
      refBroker.close();
    } catch (e) { ng('CONNACK refused setup', e); }

    // 9. unknown connId
    try {
      await mqttPublish(99999, 't', 'x');
      ng('unknown connId should throw');
    } catch (e) { ok('unknown connId: ' + e.message.substring(0, 25)); }

  } finally {
    broker.close();
  }

  report(NAME);
}

if (process.argv[1] === import.meta.filename || process.argv[1] === new URL(import.meta.url).pathname) {
  test();
}
