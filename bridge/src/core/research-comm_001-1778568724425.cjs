// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:52:04.425Z

// inter_instance_communication.js
// 运行方式: node inter_instance_communication.js
const http = require('http');
const dgram = require('dgram');
const WebSocket = require('ws');
const redis = require('redis');

// ---------------------------
// 1. 配置
// ---------------------------
const HTTP_PORT = 8000;
const UDP_PORT = 8001;
const WS_PORT = 8002;
const REDIS_CHANNEL = 'sister_status';
const CHECK_INTERVAL_MS = 3000;

// ---------------------------
// 2. HTTP Ping
// ---------------------------
const httpServer = http.createServer((req, res) => {
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong');
  } else {
    res.writeHead(404);
    res.end();
  }
});
httpServer.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Listening on port ${HTTP_PORT}`);
});

// 客户端发送 ping
function httpPing() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${HTTP_PORT}/ping`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ ok: true, body: data.trim() }));
    });
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(1000, () => resolve({ ok: false }));
  });
}

async function testHttpPing() {
  const result = await httpPing();
  console.log(`[HTTP Ping] ${result.ok ? 'Success' : 'Failure'} - ${result.body || ''}`);
}

// ---------------------------
// 3. UDP 广播
// ---------------------------
const udpSocket = dgram.createSocket('udp4');
udpSocket.on('message', (msg, rinfo) => {
  if (msg.toString() === 'ping') {
    const reply = Buffer.from('pong');
    udpSocket.send(reply, 0, reply.length, rinfo.port, rinfo.address);
  }
});
udpSocket.bind(UDP_PORT, () => {
  console.log(`[UDP] Listening on port ${UDP_PORT}`);
});

function udpPing() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('ping');
    let received = false;

    client.on('message', (msg) => {
      if (msg.toString() === 'pong') {
        received = true;
        client.close();
        resolve({ ok: true });
      }
    });

    client.send(message, 0, message.length, UDP_PORT, '127.0.0.1', (err) => {
      if (err) {
        client.close();
        resolve({ ok: false });
      }
    });

    setTimeout(() => {
      if (!received) {
        client.close();
        resolve({ ok: false });
      }
    }, 1000);
  });
}

async function testUdpPing() {
  const result = await udpPing();
  console.log(`[UDP Ping] ${result.ok ? 'Success' : 'Failure'}`);
}

// ---------------------------
// 4. Redis Pub/Sub
// ---------------------------
let redisClient, redisSubscriber;
async function initRedis() {
  try {
    redisClient = redis.createClient();
    redisSubscriber = redisClient.duplicate();
    await redisClient.connect();
    await redisSubscriber.connect();
    console.log('[Redis] Connected to local Redis server');

    redisSubscriber.subscribe(REDIS_CHANNEL, (message) => {
      if (message === 'ping') redisClient.publish(REDIS_CHANNEL, 'pong');
    });
  } catch (err) {
    console.warn('[Redis] Could not connect to Redis, skipping Redis tests');
    redisClient = null;
    redisSubscriber = null;
  }
}

async function redisPing() {
  if (!redisClient) return { ok: false, reason: 'no redis' };
  try {
    const reply = await redisClient.pSubscribe(REDIS_CHANNEL, (msg, channel) => {
      if (msg === 'pong') resolve({ ok: true });
    });
    await redisClient.publish(REDIS_CHANNEL, 'ping');
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function testRedisPing() {
  if (!redisClient) return;
  const result = await redisPing();
  console.log(`[Redis Ping] ${result.ok ? 'Success' : 'Failure'}${result.reason ? ' - ' + result.reason : ''}`);
}

// ---------------------------
// 5. WebSocket
// ---------------------------
const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  console.log(`[WS] Listening on port ${WS_PORT}`);
});

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    if (msg === 'ping') ws.send('pong');
  });
});

function wsPing() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
    ws.on('open', () => ws.send('ping'));
    ws.on('message', (msg) => {
      if (msg === 'pong') {
        ws.close();
        resolve({ ok: true });
      }
    });
    ws.on('error', () => resolve({ ok: false }));
    setTimeout(() => {
      ws.terminate();
      resolve({ ok: false });
    }, 1000);
  });
}

async function testWSPing() {
  const result = await wsPing();
  console.log(`[WS Ping] ${result.ok ? 'Success' : 'Failure'}`);
}

// ---------------------------
// 6. 主循环
// ---------------------------
async function main() {
  await initRedis();

  setInterval(async () => {
    console.log('--- 检测周期开始 ---');
    await testHttpPing();
    await testUdpPing();
    await testRedisPing();
    await testWSPing();
    console.log('--- 检测周期结束 ---\n');
  }, CHECK_INTERVAL_MS);
}

main().catch((e) => console.error(e));