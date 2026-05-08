// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:55:55.400Z

/**
 * 研究实例间通讯方式
 * 目标：除了 HTTP Ping 之外，尝试几种常见的“健康检测”方式
 * 方式：
 *   1. HTTP GET（最常用）
 *   2. TCP Socket 连接（简单的“连接测试”）
 *   3. UDP 广播/多播（广播检测，适合同一网段）
 *   4. Redis Pub/Sub（消息队列方式，跨机器）
 *
 * 说明：
 *   - 代码中既启动了对应的“被检测端”，也在主流程里对其进行检测。
 *   - 所有输出均通过 console.log 记录，便于观察效果。
 *   - 运行前请确保本机已安装 `redis` 并已启动服务（若想跳过 Redis，可直接注释掉相关代码）。
 *
 * 运行方式（Node 18+ 推荐）：
 *   node detect.js
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const redis = require('redis');

// ---------------------------------------------------------------------------
// 1️⃣ HTTP Ping
// ---------------------------------------------------------------------------

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('pong');
});

const HTTP_PORT = 3000;
httpServer.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Server listening on http://localhost:${HTTP_PORT}`);
  // 发起请求
  http.get(`http://localhost:${HTTP_PORT}`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log(`[HTTP] Received response: ${data}`);
    });
  }).on('error', err => {
    console.error(`[HTTP] Request error: ${err.message}`);
  });
});

// ---------------------------------------------------------------------------
// 2️⃣ TCP Socket 连接
// ---------------------------------------------------------------------------

const tcpServer = net.createServer((socket) => {
  console.log('[TCP] New connection accepted');
  socket.end('pong\n');
});

const TCP_PORT = 4000;
tcpServer.listen(TCP_PORT, () => {
  console.log(`[TCP] Server listening on port ${TCP_PORT}`);
  // 发起连接
  const client = net.createConnection({ port: TCP_PORT }, () => {
    console.log('[TCP] Connected to server');
  });

  client.on('data', (data) => {
    console.log(`[TCP] Received: ${data.toString().trim()}`);
    client.end();
  });

  client.on('error', (err) => {
    console.error(`[TCP] Connection error: ${err.message}`);
  });
});

// ---------------------------------------------------------------------------
// 3️⃣ UDP 广播/多播
// ---------------------------------------------------------------------------

const udpPort = 5000;
const udpServer = dgram.createSocket('udp4');

udpServer.on('message', (msg, rinfo) => {
  console.log(`[UDP] Received from ${rinfo.address}:${rinfo.port} -> ${msg}`);
});

udpServer.bind(udpPort, () => {
  console.log(`[UDP] Server listening on port ${udpPort}`);
  // 发送广播
  const message = Buffer.from('ping');
  udpServer.setBroadcast(true);
  udpServer.send(message, 0, message.length, udpPort, '255.255.255.255', (err) => {
    if (err) console.error(`[UDP] Send error: ${err.message}`);
    else console.log('[UDP] Broadcast message sent');
  });
});

// ---------------------------------------------------------------------------
// 4️⃣ Redis Pub/Sub
// ---------------------------------------------------------------------------

async function redisDemo() {
  const publisher = redis.createClient();
  const subscriber = redis.createClient();

  try {
    await publisher.connect();
    await subscriber.connect();

    // 订阅频道
    await subscriber.subscribe('health', (message) => {
      console.log(`[Redis] Received message on 'health': ${message}`);
    });

    console.log('[Redis] Subscribed to channel "health"');

    // 等待一会再发布
    setTimeout(async () => {
      await publisher.publish('health', 'pong');
      console.log('[Redis] Published message to channel "health"');
    }, 2000);
  } catch (err) {
    console.error(`[Redis] Error: ${err.message}`);
  }
}

redisDemo();

// ---------------------------------------------------------------------------
// 关闭所有服务器（演示用，实际应用中请根据业务自行关闭）
// ---------------------------------------------------------------------------

setTimeout(() => {
  httpServer.close(() => console.log('[HTTP] Server closed'));
  tcpServer.close(() => console.log('[TCP] Server closed'));
  udpServer.close(() => console.log('[UDP] Server closed'));
  // Redis 客户端在 redisDemo 里已经自动关闭
  process.exit(0);
}, 5000);