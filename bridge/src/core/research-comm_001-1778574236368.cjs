// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:23:56.368Z

// File: sibling-status.js
// Node.js (CommonJS) 代码，演示多种姐妹状态检测方式

const net = require('net');
const dgram = require('dgram');
const Redis = require('ioredis');
const WebSocket = require('ws');

// ---------- 1. TCP 端口监听 ----------
function startTcpServer() {
  const server = net.createServer((socket) => {
    console.log(`TCP: 连接成功，来自 ${socket.remoteAddress}:${socket.remotePort}`);
    socket.end(); // 立即关闭
  });

  const PORT = 0; // 0 让系统自动分配可用端口
  server.listen(PORT, () => {
    const addr = server.address();
    console.log(`TCP: 服务器已在 ${addr.address}:${addr.port} 上监听`);
    // 让其它实例尝试连接
    setTimeout(() => {
      const client = net.connect({ port: addr.port }, () => {
        console.log(`TCP: 客户端已连接到 ${addr.address}:${addr.port}`);
        client.end();
      });
    }, 1000);
  });

  server.on('error', (err) => {
    console.error('TCP: 服务器错误', err);
  });

  return server;
}

// ---------- 2. UDP 广播 ----------
function startUdpBroadcast() {
  const BROADCAST_PORT = 41234;
  const MESSAGE = Buffer.from('Hello from UDP');

  const server = dgram.createSocket('udp4');

  server.on('listening', () => {
    const address = server.address();
    console.log(`UDP: 服务器在 ${address.address}:${address.port} 上监听`);
    server.setBroadcast(true);

    // 发送广播
    server.send(MESSAGE, 0, MESSAGE.length, BROADCAST_PORT, '255.255.255.255', (err) => {
      if (err) console.error('UDP: 发送广播失败', err);
      else console.log('UDP: 广播消息已发送');
    });
  });

  server.on('message', (msg, rinfo) => {
    console.log(`UDP: 收到来自 ${rinfo.address}:${rinfo.port} 的消息 -> ${msg}`);
  });

  server.on('error', (err) => {
    console.error('UDP: 错误', err);
    server.close();
  });

  server.bind(BROADCAST_PORT);
  return server;
}

// ---------- 3. Redis Pub/Sub ----------
async function startRedisHeartbeat() {
  const redis = new Redis(); // 默认连接到 localhost:6379
  const channel = 'sibling-heartbeat';

  // 订阅同一频道
  await redis.subscribe(channel, (err, count) => {
    if (err) console.error('Redis: 订阅失败', err);
    else console.log(`Redis: 成功订阅 ${channel}（订阅者数: ${count}）`);
  });

  redis.on('message', (chan, message) => {
    if (chan === channel) console.log(`Redis: 收到心跳 -> ${message}`);
  });

  // 定时发布自己的心跳
  setInterval(() => {
    const msg = `Node-${process.pid}@${new Date().toISOString()}`;
    redis.publish(channel, msg);
    console.log(`Redis: 发布心跳 -> ${msg}`);
  }, 3000);
}

// ---------- 4. WebSocket ----------
function startWebSocketServer() {
  const wss = new WebSocket.Server({ port: 0 }, () => {
    const address = wss.address();
    console.log(`WebSocket: 服务器已在 ${address.address}:${address.port} 上监听`);
  });

  wss.on('connection', (ws, req) => {
    console.log(`WebSocket: 连接来自 ${req.socket.remoteAddress}:${req.socket.remotePort}`);
    ws.on('message', (msg) => console.log(`WebSocket: 收到消息 -> ${msg}`));
    ws.send('欢迎连接！');
  });

  wss.on('error', (err) => console.error('WebSocket: 错误', err));
  return wss;
}

// ---------- 启动所有检测 ----------
function main() {
  console.log('=== 开始姐妹状态检测演示 ===');

  // 1. TCP
  startTcpServer();

  // 2. UDP
  startUdpBroadcast();

  // 3. Redis
  startRedisHeartbeat();

  // 4. WebSocket
  startWebSocketServer();

  console.log('=== 所有服务已启动，等待检测结果 ===');
}

main();