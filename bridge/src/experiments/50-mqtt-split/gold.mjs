// 50-mqtt-split/gold.mjs
//
// Hand-written reference implementations for the 2-round split.
// Exported as STRINGS (source code) so the sandbox can run them the same way
// it runs LLM-generated source — verifies the sandbox + scoring pipeline
// works end-to-end before live LLM calls.
//
// Behavior contracts:
//   GOLD_R1_SOURCE: connectWithRetry({host, port, clientId}) → { socket, clientId }
//     - Retry up to 3 attempts on connect failure
//     - Use net.connect factory + 'connect' event + write CONNECT
//     - On success, return { socket, clientId }
//
//   GOLD_R2_SOURCE: restoreSubscriptions({conn, sessionStore}) → { restoredCount, subscriptions }
//     - Read sessionStore.getSubscriptions(conn.clientId)
//     - For each stored sub, write SUBSCRIBE on conn.socket
//     - Return { restoredCount, subscriptions }
//
// If these don't pass all 14 scoring dimensions in runDryRun(),
// the sandbox or scoring is broken — do NOT proceed to live mode.

export const GOLD_R1_SOURCE = `
async function connectWithRetry({host, port, clientId}) {
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const conn = await new Promise((resolve, reject) => {
        const socket = net.connect({host, port}, async () => {
          try {
            const pkt = await renderConnect({
              protoName: 'MQTT', protoLevel: 4, connectFlags: 2, keepAlive: 60, clientId,
            });
            socket.write(pkt.bytes, (err) => {
              if (err) return reject(err);
              resolve({socket, clientId});
            });
          } catch (e) {
            reject(e);
          }
        });
        socket.on('error', reject);
      });
      return conn;
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

export const GOLD_R2_SOURCE = `
async function restoreSubscriptions({conn, sessionStore}) {
  const subs = sessionStore.getSubscriptions(conn.clientId) || [];
  for (let i = 0; i < subs.length; i++) {
    const subPkt = await renderSubscribe({
      packetId: i + 1, subscriptions: [subs[i]],
    });
    await new Promise((resolve) => {
      conn.socket.write(subPkt.bytes, resolve);
    });
  }
  return { restoredCount: subs.length, subscriptions: subs };
}
`;

// Reference sessionStore fixture — 3 stored subscriptions (used in subTest B)
export const GOLD_SESSION_STORE_3 = {
  getSubscriptions(clientId) {
    return [
      { topic: 'sensor/+', qos: 1 },
      { topic: 'control/' + clientId, qos: 0 },
      { topic: 'system/' + clientId + '/status', qos: 2 },
    ];
  },
};

// Reference sessionStore fixture — 0 stored subscriptions (used in subTest A)
export const GOLD_SESSION_STORE_0 = {
  getSubscriptions(clientId) {
    return [];
  },
};

// Reference test args
export const GOLD_TEST_ARGS = {
  host: '127.0.0.1',
  port: 0,  // mock net ignores this
  clientId: 'test-split',
};
