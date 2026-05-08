// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:58:05.858Z

/**
 * 研究实例间通讯方式（除 HTTP Ping 之外）
 * 该脚本演示并测试以下几种常见方式：
 *   1. UDP 广播/单播
 *   2. TCP 连接
 *   3. WebSocket（ws）
 *   4. Redis Pub/Sub（可选）
 *
 * 运行前请确保：
 *   - Node.js 已安装
 *   - 如果想测试 Redis，需在本机安装 Redis 并启动服务
 *   - 可按需注释掉不想用的部分
 *
 * 代码使用 CommonJS（require）规范，直接在终端执行 `node this_file.js`
 */

const dgram = require('dgram');
const net = require('net');
const http = require('http');
const WebSocket = require('ws');
const util = require('util');

// ------------------ 1. UDP ------------------

const UDP_PORT = 41234;
const udpServer = dgram.createSocket('udp4');

udpServer.on('error', (err) => {
  console.log(`UDP 服务器错误: ${err}`);
  udpServer.close();
});

udpServer.on('message', (msg, rinfo) => {
  console.log(`UDP 收到来自 ${rinfo.address}:${rinfo.port} 的消息: ${msg}`);
});

udpServer.on('listening', () => {
  const address = udpServer.address();
  console.log(`UDP 服务器监听在 ${address.address}:${address.port}`);
});
udpServer.bind(UDP_PORT);

// 发送 UDP 消息
setTimeout(() => {
  const message = Buffer.from('Hello from UDP client');
  udpServer.send(message, 0, message.length, UDP_PORT, '127.0.0.1', (err) => {
    if (err) console.log(`UDP 发送失败: ${err}`);
    else console.log('UDP 客户端已发送消息');
  });
}, 1000);

// ------------------ 2. TCP ------------------

const TCP_PORT = 41235;
const tcpServer = net.createServer((socket) => {
  console.log(`TCP 客户端已连接: ${socket.remoteAddress}:${socket.remotePort}`);
  socket.on('data', (data) => {
    console.log(`TCP 收到: ${data}`);
    socket.write('ACK from TCP server');
  });
  socket.on('end', () => console.log('TCP 连接已关闭'));
});

tcpServer.on('error', (err) => console.log(`TCP 服务器错误: ${err}`));
tcpServer.listen(TCP_PORT, () => {
  console.log(`TCP 服务器监听在 127.0.0.1:${TCP_PORT}`);
});

// TCP 客户端
setTimeout(() => {
  const client = net.createConnection({ port: TCP_PORT }, () => {
    console.log('TCP 客户端已连接到服务器');
    client.write('Hello TCP Server');
  });
  client.on('data', (data) => {
    console.log(`TCP 客户端收到: ${data}`);
    client.end();
  });
}, 2000);

// ------------------ 3. WebSocket ------------------

const WS_PORT = 41236;
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('listening', () => {
  console.log(`WebSocket 服务器监听在 ws://127.0.0.1:${WS_PORT}`);
});

wss.on('connection', (ws, req) => {
  console.log(`WebSocket 客户端连接: ${req.socket.remoteAddress}`);
  ws.on('message', (message) => {
    console.log(`WebSocket 收到: ${message}`);
    ws.send('ACK from WS server');
  });
});

// WebSocket 客户端
setTimeout(() => {
  const wsClient = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
  wsClient.on('open', () => {
    console.log('WebSocket 客户端已连接');
    wsClient.send('Hello WS Server');
  });
  wsClient.on('message', (data) => {
    console.log(`WebSocket 客户端收到: ${data}`);
    wsClient.close();
  });
}, 3000);

// ------------------ 4. Redis Pub/Sub (可选) ------------------

// 如果你想测试 Redis Pub/Sub，请先安装 ioredis 并确保 Redis 运行在本机 6379 端口
let redisAvailable = false;
try {
  var Redis = require('ioredis');
  redisAvailable = true;
} catch (e) {
  console.log('ioredis 未安装，跳过 Redis 示例');
}

if (redisAvailable) {
  const redis = new Redis(); // 默认连接到 127.0.0.1:6379

  // 订阅频道
  redis.subscribe('sister_status', (err, count) => {
    if (err) console.log(`Redis 订阅错误: ${err}`);
    else console.log(`Redis 订阅成功，等待 ${count} 个频道`);
  });

  redis.on('message', (channel, message) => {
    console.log(`Redis 频道 ${channel} 收到消息: ${message}`);
  });

  // 发布消息
  setTimeout(() => {
    redis.publish('sister_status', 'Hello from Redis publisher');
    console.log('Redis 发布消息: Hello from Redis publisher');
  }, 4000);
}

// ------------------ 运行结束 ------------------
setTimeout(() => {
  console.log('=== 所有示例已完成 ===');
  udpServer.close();
  tcpServer.close();
  wss.close();
  if (redisAvailable) {
    redis.quit();
  }
  process.exit(0);
}, 6000);