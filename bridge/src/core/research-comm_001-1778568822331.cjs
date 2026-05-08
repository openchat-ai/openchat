// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:53:42.331Z

/**
 * 兄妹实例状态检测演示
 * - TCP Keep‑Alive
 * - UDP Heartbeat
 * - WebSocket Ping/Pong
 * - Redis Pub/Sub
 *
 * 运行方式：
 *   node sister-status.js
 *
 * 需要依赖：
 *   npm install ws ioredis
 */
const net = require('net');
const dgram = require('dgram');
const cluster = require('cluster');
const WebSocket = require('ws');
const Redis = require('ioredis');

const TCP_PORT = 9000;
const UDP_PORT = 9001;
const WS_PORT = 9002;
const REDIS_CHANNEL = 'sister_heartbeat';

const HEARTBEAT_INTERVAL_MS = 2000; // 2 秒

// ---------- TCP Keep‑Alive ----------
function startTCPServer(id) {
  const server = net.createServer((socket) => {
    console.log(`[${id}] TCP: 接收到连接`);
    socket.setKeepAlive(true, 5000); // 每 5 秒发送一次 keep-alive
    socket.on('error', (err) => console.log(`[${id}] TCP: 错误 ${err.message}`));
  });

  server.listen(TCP_PORT, () => {
    console.log(`[${id}] TCP: 监听端口 ${TCP_PORT}`);
  });
}

function connectTCPClient(id) {
  const socket = new net.Socket();
  socket.connect(TCP_PORT, '127.0.0.1', () => {
    console.log(`[${id}] TCP: 已连接到服务器`);
  });

  socket.on('error', (err) => console.log(`[${id}] TCP: 连接错误 ${err.message}`));
  socket.on('close', () => console.log(`[${id}] TCP: 连接关闭`));
}

// ---------- UDP Heartbeat ----------
function startUDPServer(id) {
  const server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    console.log(`[${id}] UDP: 收到心跳 ${msg} 来自 ${rinfo.address}:${rinfo.port}`);
    // 回复 ACK
    server.send(Buffer.from('ACK'), rinfo.port, rinfo.address);
  });

  server.bind(UDP_PORT, () => {
    console.log(`[${id}] UDP: 监听端口 ${UDP_PORT}`);
  });
}

function startUDPClient(id) {
  const client = dgram.createSocket('udp4');
  setInterval(() => {
    const msg = Buffer.from(`HEARTBEAT-${id}`);
    client.send(msg, UDP_PORT, '127.0.0.1', (err) => {
      if (err) console.log(`[${id}] UDP: 发送错误 ${err.message}`);
    });
  }, HEARTBEAT_INTERVAL_MS);

  client.on('message', (msg) => {
    console.log(`[${id}] UDP: 收到 ACK ${msg}`);
  });
}

// ---------- WebSocket Ping/Pong ----------
function startWSServer(id) {
  const wss = new WebSocket.Server({ port: WS_PORT }, () => {
    console.log(`[${id}] WS: 服务器已启动，监听 ${WS_PORT}`);
  });

  wss.on('connection', (ws) => {
    console.log(`[${id}] WS: 接收到连接`);
    ws.on('pong', () => console.log(`[${id}] WS: 收到 pong`));
    ws.on('error', (err) => console.log(`[${id}] WS: 错误 ${err.message}`));
  });
}

function startWSClient(id) {
  const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

  ws.on('open', () => {
    console.log(`[${id}] WS: 连接已打开`);
    // 每隔 HEARTBEAT_INTERVAL_MS 发送 ping
    setInterval(() => {
      ws.ping();
      console.log(`[${id}] WS: 发送 ping`);
    }, HEARTBEAT_INTERVAL_MS);
  });

  ws.on('pong', () => console.log(`[${id}] WS: 收到 pong`));
  ws.on('error', (err) => console.log(`[${id}] WS: 错误 ${err.message}`));
}

// ---------- Redis Pub/Sub ----------
function startRedisSubscriber(id, redis) {
  redis.subscribe(REDIS_CHANNEL, () => {
    console.log(`[${id}] Redis: 订阅频道 ${REDIS_CHANNEL}`);
  });

  redis.on('message', (channel, message) => {
    console.log(`[${id}] Redis: 收到 ${channel} 消息 ${message}`);
  });
}

function startRedisPublisher(id, redis) {
  setInterval(() => {
    const msg = `HEARTBEAT-${id}`;
    redis.publish(REDIS_CHANNEL, msg);
    console.log(`[${id}] Redis: 发布 ${msg}`);
  }, HEARTBEAT_INTERVAL_MS);
}

// ---------- 主程序 ----------
if (cluster.isMaster) {
  // 创建两份 worker（模拟姐妹实例）
  for (let i = 1; i <= 2; i++) {
    cluster.fork({ INSTANCE_ID: i });
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} 退出，代码 ${code} 信号 ${signal}`);
  });
} else {
  const id = process.env.INSTANCE_ID || 'unknown';
  console.log(`实例 ${id} 启动 PID ${process.pid}`);

  // 1. TCP
  startTCPServer(id);
  connectTCPClient(id);

  // 2. UDP
  startUDPServer(id);
  startUDPClient(id);

  // 3. WebSocket
  startWSServer(id);
  startWSClient(id);

  // 4. Redis
  const redis = new Redis(); // 默认连接本地 6379
  startRedisSubscriber(id, redis);
  startRedisPublisher(id, redis);
}