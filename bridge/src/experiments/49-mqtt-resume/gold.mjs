// 49-mqtt-resume/gold.mjs
//
// Hand-written reference implementation of `connectWithResume`.
// Exported as a STRING (source code) so the sandbox can run it the same way
// it runs LLM-generated source — verifies the sandbox + scoring pipeline
// works end-to-end before live LLM calls.
//
// Behavior contract:
//   1. Retry up to 3 attempts on connect failure
//   2. After successful CONNACK, read subscriptions from sessionStore
//   3. Re-issue each subscription via SUBSCRIBE on the same connection
//   4. Resolve with { connId, restoredCount, subscriptions: [{topic, qos}] }
//
// If this source doesn't pass all 9 scoring dimensions in runDryRun(),
// the sandbox or scoring is broken — do NOT proceed to live mode.

export const GOLD_SOURCE = `
async function connectWithResume({host, port, clientId, sessionStore}) {
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const socket = net.connect({host, port}, async () => {
          try {
            const subs = sessionStore.getSubscriptions(clientId);
            const connectPkt = await renderConnect({
              protoName: 'MQTT', protoLevel: 4, connectFlags: 0x02, keepAlive: 60, clientId,
            });
            await new Promise((res, rej) => {
              socket.write(connectPkt.bytes, (err) => err ? rej(err) : res());
            });
            for (let i = 0; i < subs.length; i++) {
              const subPkt = await renderSubscribe({
                packetId: i + 1, subscriptions: [subs[i]],
              });
              await new Promise((res, rej) => {
                socket.write(subPkt.bytes, (err) => err ? rej(err) : res());
              });
            }
            resolve({
              connId: clientId,
              restoredCount: subs.length,
              subscriptions: subs,
            });
          } catch (e) {
            reject(e);
          }
        });
        socket.on('error', reject);
      });
      return result;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 50 * attempt));
      }
    }
  }
  throw lastErr;
}
`;

// Reference sessionStore fixture for sandbox tests
export const GOLD_SESSION_STORE = {
  getSubscriptions(clientId) {
    return [
      { topic: 'sensor/+', qos: 1 },
      { topic: 'control/' + clientId, qos: 0 },
    ];
  },
};

// Reference test args
export const GOLD_TEST_ARGS = {
  host: '127.0.0.1',
  port: 0,  // set by sandbox after broker listens
  clientId: 'test-123',
};
