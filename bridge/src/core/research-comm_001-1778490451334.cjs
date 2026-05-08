// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:07:31.334Z

/**
 * 例子：多种实例间“姐妹状态”检测方式
 * 1. WebSocket ping/pong（双向心跳）
 * 2. UDP 广播（广播心跳）
 * 3. Redis Pub/Sub（集中式心跳）
 *
 * 运行方式：
 *   $ node heartbeat.js
 *
 * 需要在本机安装 redis 并启动，或者使用云端 redis 实例。
 * 若没有 redis，可将相关代码注释掉。
 */

const WebSocket = require('ws');
const dgram = require('dgram');
const redis = require('redis');

// === 1. WebSocket ping/pong ===
const wsPort = 8080;
const wsServer = new WebSocket.Server({ port: wsPort });

wsServer.on('connection', (ws, req) => {
  console.log(`[WS] New client connected from ${req.socket.remoteAddress}`);
  
  // 服务器主动 ping
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 3000);

  // 收到客户端 pong，说明客户端存活
  ws.on('pong', () => {
    console.log(`[WS] Received pong from ${req.socket.remoteAddress}`);
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    console.log(`[WS] Client ${req.socket.remoteAddress} disconnected`);
  });
});

// 客户端模拟：连接到服务器并响应 ping
function startWsClient() {
  const ws = new WebSocket(`ws://localhost:${wsPort}`);
  ws.on('open', () => {
    console.log('[WS Client] Connected to server');
  });

  // 自动响应 ping 为 pong
  ws.on('ping', () => {
    ws.pong();
    console.log('[WS Client] Responded to ping with pong');
  });

  ws.on('close', () => {
    console.log('[WS Client] Disconnected from server');
  });
}
startWsClient();

// === 2. UDP 广播心跳 ===
const udpPort = 5000;
const udpAddr = '255.255.255.255'; // 广播地址
const udpSocket = dgram.createSocket('udp4');

udpSocket.bind(udpPort, () => {
  udpSocket.setBroadcast(true);
  console.log(`[UDP] Listening for heartbeats on ${udpPort}`);
});

// 发送广播心跳
setInterval(() => {
  const msg = Buffer.from(`heartbeat-${Date.now()}`);
  udpSocket.send(msg, 0, msg.length, udpPort, udpAddr, (err) => {
    if (!err) {
      console.log(`[UDP] Sent heartbeat: ${msg.toString()}`);
    }
  });
}, 4000);

// 接收心跳
udpSocket.on('message', (msg, rinfo) => {
  console.log(`[UDP] Received heartbeat from ${rinfo.address}:${rinfo.port} - ${msg.toString()}`);
});

// === 3. Redis Pub/Sub 心跳 ===
const redisHost = '127.0.0.1';
const redisPort = 6379;
const redisChannel = 'heartbeat_channel';

const pubClient = redis.createClient({ host: redisHost, port: redisPort });
const subClient = redis.createClient({ host: redisHost, port: redisPort });

pubClient.on('error', err => console.error('Redis pub error:', err));
subClient.on('error', err => console.error('Redis sub error:', err));

subClient.subscribe(redisChannel, () => {
  console.log(`[Redis] Subscribed to ${redisChannel}`);
});

subClient.on('message', (channel, message) => {
  console.log(`[Redis] Received heartbeat on ${channel}: ${message}`);
});

// 发布心跳
setInterval(() => {
  const msg = `redis-heartbeat-${Date.now()}`;
  pubClient.publish(redisChannel, msg, (err, reply) => {
    if (!err) {
      console.log(`[Redis] Published: ${msg} (subscribers=${reply})`);
    }
  });
}, 5000);