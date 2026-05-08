// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:31:00.398Z

/**
 * 实例间通讯方式研究
 * 1. UDP 广播（广播到同一子网）
 * 2. Redis Pub/Sub（集中式消息总线）
 * 3. WebSocket（双向长连接）
 * 4. TCP keep‑alive（保活探测）
 *
 * 运行方式：
 *   node instance_heartbeat.js
 *
 * 需要先启动本地 Redis 服务（默认 127.0.0.1:6379）
 */

const dgram = require('dgram');
const net = require('net');
const ws = require('ws');
const redis = require('redis');

// -------------------------------
// 配置
// -------------------------------
const CONFIG = {
  udp: {
    port: 50000,
    broadcastAddr: '255.255.255.255',
    intervalMs: 2000
  },
  redis: {
    host: '127.0.0.1',
    port: 6379,
    channel: 'heartbeat',
    intervalMs: 3000
  },
  ws: {
    port: 8081,
    intervalMs: 2500
  },
  tcp: {
    port: 9090,
    intervalMs: 4000,
    keepAlive: true
  }
};

// -------------------------------
// 1. UDP 广播
// -------------------------------
function startUdpInstance() {
  const socket = dgram.createSocket('udp4');

  socket.bind(CONFIG.udp.port, () => {
    socket.setBroadcast(true);
    console.log('[UDP] 实例已启动，监听端口', CONFIG.udp.port);
  });

  // 监听来自其他实例的心跳
  socket.on('message', (msg, rinfo) => {
    const text = msg.toString();
    if (text.startsWith('heartbeat:udp:')) {
      console.log(`[UDP] 收到来自 ${rinfo.address}:${rinfo.port} 的心跳: ${text}`);
    }
  });

  // 定期广播心跳
  setInterval(() => {
    const message = Buffer.from(`heartbeat:udp:${Date.now()}`);
    socket.send(message, 0, message.length, CONFIG.udp.port, CONFIG.udp.broadcastAddr, (err) => {
      if (err) console.error('[UDP] 发送错误', err);
    });
  }, CONFIG.udp.intervalMs);
}

// -------------------------------
// 2. Redis Pub/Sub
// -------------------------------
function startRedisInstance() {
  const publisher = redis.createClient({ url: `redis://${CONFIG.redis.host}:${CONFIG.redis.port}` });
  const subscriber = redis.createClient({ url: `redis://${CONFIG.redis.host}:${CONFIG.redis.port}` });

  publisher.connect();
  subscriber.connect();

  subscriber.subscribe(CONFIG.redis.channel, (message) => {
    if (message.startsWith('heartbeat:redis:')) {
      console.log(`[Redis] 收到心跳: ${message}`);
    }
  });

  console.log('[Redis] 实例已启动，订阅频道', CONFIG.redis.channel);

  setInterval(() => {
    const msg = `heartbeat:redis:${Date.now()}`;
    publisher.publish(CONFIG.redis.channel, msg).catch(console.error);
  }, CONFIG.redis.intervalMs);
}

// -------------------------------
// 3. WebSocket
// -------------------------------
function startWebSocketInstance() {
  const wss = new ws.Server({ port: CONFIG.ws.port }, () => {
    console.log('[WebSocket] 服务器已启动，监听端口', CONFIG.ws.port);
  });

  // 当有客户端连接时，启动心跳
  wss.on('connection', (socket, req) => {
    console.log(`[WebSocket] 新连接来自 ${req.socket.remoteAddress}:${req.socket.remotePort}`);

    const sendHeartbeat = setInterval(() => {
      const msg = `heartbeat:ws:${Date.now()}`;
      socket.send(msg);
    }, CONFIG.ws.intervalMs);

    socket.on('close', () => clearInterval(sendHeartbeat));
  });

  // 也可以作为客户端连接到自身（模拟多实例）
  const client = new ws(`ws://localhost:${CONFIG.ws.port}`);
  client.on('open', () => {
    console.log('[WebSocket] 作为客户端已连接到自身');
  });
  client.on('message', (data) => {
    if (data.startsWith('heartbeat:ws:')) {
      console.log(`[WebSocket] 收到心跳: ${data}`);
    }
  });
}

// -------------------------------
// 4. TCP Keep-Alive
// -------------------------------
function startTcpInstance() {
  const server = net.createServer((socket) => {
    console.log(`[TCP] 新连接来自 ${socket.remoteAddress}:${socket.remotePort}`);
    socket.setKeepAlive(CONFIG.tcp.keepAlive, 5000);

    socket.on('data', (data) => {
      const msg = data.toString();
      if (msg.startsWith('heartbeat:tcp:')) {
        console.log(`[TCP] 收到心跳: ${msg}`);
      }
    });

    socket.on('end', () => console.log('[TCP] 连接已关闭'));
  });

  server.listen(CONFIG.tcp.port, () => {
    console.log('[TCP] 服务器已启动，监听端口', CONFIG.tcp.port);
  });

  // 作为客户端定时发送心跳
  const client = new net.Socket();
  client.connect(CONFIG.tcp.port, '127.0.0.1', () => {
    console.log('[TCP] 作为客户端已连接到服务器');
    setInterval(() => {
      client.write(`heartbeat:tcp:${Date.now()}`);
    }, CONFIG.tcp.intervalMs);
  });

  client.on('error', (err) => console.error('[TCP] 客户端错误', err));
}

// -------------------------------
// 启动所有实例
// -------------------------------
startUdpInstance();
startRedisInstance();
startWebSocketInstance();
startTcpInstance();