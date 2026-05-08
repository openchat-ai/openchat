// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:15:56.215Z

/**
 * 研究实例间通讯方式（Beyond HTTP ping）
 *
 * 本脚本演示三种常见的“姐妹状态”检测手段：
 * 1. HTTP GET /ping（最直观的主动请求方式）
 * 2. UDP 广播/组播（网络层的广播发现）
 * 3. Redis Pub/Sub（分布式消息队列）
 *
 * 运行环境：
 *   - Node.js 18+
 *   - 若想使用 Redis，请提前在本机安装并启动 Redis 服务
 *
 * 说明：
 *   - 你可以在多台机器或多进程上同时执行此脚本，
 *     通过不同的实例 ID 来观察互相检测的效果。
 *   - 通过 console.log 输出的结果，你可以看到每种方式的发现情况。
 */

const http = require('http');
const dgram = require('dgram');
const { createClient } = require('redis');

// ---------- 配置 ----------
const INSTANCE_ID = process.argv[2] || `node-${process.pid}`; // 用于区分实例
const HTTP_PORT = 3000 + (process.pid % 1000);                  // 随机端口，避免冲突
const UDP_PORT = 41234;
const UDP_BROADCAST_ADDR = '255.255.255.255';
const REDIS_CHANNEL = 'instance_status';
const REDIS_URL = 'redis://127.0.0.1:6379';

// ---------- 1. HTTP ping ----------
const httpServer = http.createServer((req, res) => {
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: INSTANCE_ID, time: Date.now() }));
    console.log(`[HTTP] Received ping from ${INSTANCE_ID}`);
  } else {
    res.writeHead(404);
    res.end();
  }
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Instance ${INSTANCE_ID} listening on port ${HTTP_PORT}`);
});

// 轮询发现同一网段内的其他实例（简化为固定 IP 列表）
const peerHttpHosts = [
  // 你可以在此添加已知的其他实例 IP
  // 'http://192.168.1.10',
  // 'http://192.168.1.11',
];
const pingInterval = 15000; // 15 秒

function pingPeers() {
  peerHttpHosts.forEach(host => {
    const url = `${host}:${HTTP_PORT}/ping`;
    http.get(url, res => {
      if (res.statusCode === 200) {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          console.log(`[HTTP] Ping success from ${url} -> ${data}`);
        });
      }
    }).on('error', err => {
      console.log(`[HTTP] Ping error to ${url}: ${err.message}`);
    });
  });
}
setInterval(pingPeers, pingInterval);

// ---------- 2. UDP 广播 ----------
const udpSocket = dgram.createSocket('udp4');

udpSocket.on('error', err => {
  console.log(`[UDP] Socket error:\n${err.stack}`);
  udpSocket.close();
});

udpSocket.on('message', (msg, rinfo) => {
  const payload = msg.toString();
  if (payload.startsWith('PING:')) {
    const responderId = payload.split(':')[1];
    console.log(`[UDP] Received ping from ${responderId} at ${rinfo.address}`);
    // 回复确认
    const reply = Buffer.from(`PONG:${INSTANCE_ID}`);
    udpSocket.send(reply, 0, reply.length, rinfo.port, rinfo.address, err => {
      if (err) console.log(`[UDP] Reply error: ${err.message}`);
    });
  } else if (payload.startsWith('PONG:')) {
    const responderId = payload.split(':')[1];
    console.log(`[UDP] Received pong from ${responderId}`);
  }
});

udpSocket.bind(UDP_PORT, () => {
  udpSocket.setBroadcast(true);
  console.log(`[UDP] Instance ${INSTANCE_ID} listening on port ${UDP_PORT}`);
});

// 发送广播 ping
function broadcastPing() {
  const msg = Buffer.from(`PING:${INSTANCE_ID}`);
  udpSocket.send(msg, 0, msg.length, UDP_PORT, UDP_BROADCAST_ADDR, err => {
    if (err) console.log(`[UDP] Broadcast error: ${err.message}`);
    else console.log(`[UDP] Broadcasted ping from ${INSTANCE_ID}`);
  });
}
setInterval(broadcastPing, 10000); // 每 10 秒广播一次

// ---------- 3. Redis Pub/Sub ----------
(async () => {
  const publisher = createClient({ url: REDIS_URL });
  const subscriber = createClient({ url: REDIS_URL });

  publisher.on('error', err => console.log('[Redis] Publisher error:', err));
  subscriber.on('error', err => console.log('[Redis] Subscriber error:', err));

  await publisher.connect();
  await subscriber.connect();

  // 订阅频道
  await subscriber.subscribe(REDIS_CHANNEL, message => {
    const { id, time } = JSON.parse(message);
    if (id !== INSTANCE_ID) {
      console.log(`[Redis] Detected instance ${id} at ${new Date(time).toISOString()}`);
    }
  });

  // 定期发布自身信息
  setInterval(async () => {
    const msg = JSON.stringify({ id: INSTANCE_ID, time: Date.now() });
    await publisher.publish(REDIS_CHANNEL, msg);
    console.log(`[Redis] Published status of ${INSTANCE_ID}`);
  }, 12000); // 每 12 秒
})().catch(err => console.error('[Redis] init error:', err));