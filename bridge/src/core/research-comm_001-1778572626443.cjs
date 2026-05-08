// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:57:06.443Z

/**
 * 研究实例间通讯方式
 * 目标：在同一局域网内，用多种协议检测“姐妹实例”是否在线
 *
 * 方案：
 * 1. HTTP GET 端点（原始方案）
 * 2. TCP 端口探测（raw TCP ping）
 * 3. UDP 广播 “心跳” 消息
 * 4. WebSocket 连接
 * 5. Redis Pub/Sub（如果 Redis 可用）
 *
 * 代码会在同一台机器上启动 2 个实例（端口 4000 和 4001），
 * 并让每个实例尝试探测另一个实例的可达性。
 *
 * 运行方式：
 *   node instance.js 4000   // 第一个实例
 *   node instance.js 4001   // 第二个实例
 *
 * 需要安装依赖：
 *   npm install ws redis
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const redis = require('redis');
const process = require('process');

const PORT = parseInt(process.argv[2], 10) || 4000;
const OTHER_PORT = PORT === 4000 ? 4001 : 4000;
const HOST = '127.0.0.1';
const UDP_PORT = 5000; // 用于 UDP 广播心跳
const WS_PATH = '/ws';
const REDIS_CHANNEL = 'instance-heartbeat';

// ---------- 1. HTTP 端点 ----------
const httpServer = http.createServer((req, res) => {
  if (req.url === '/ping') {
    res.writeHead(200);
    res.end('pong');
  } else {
    res.writeHead(404);
    res.end();
  }
});
httpServer.listen(PORT, () => {
  console.log(`[${PORT}] HTTP 服务器已启动，监听 /ping`);
});

// ---------- 2. TCP 端口探测 ----------
function tcpPing(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = null; // 'connected' | 'timeout' | 'err'
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      status = 'connected';
      socket.destroy();
    });
    socket.on('timeout', () => {
      status = 'timeout';
      socket.destroy();
    });
    socket.on('error', () => {
      status = 'err';
    });
    socket.on('close', () => {
      resolve(status);
    });
    socket.connect(port, host);
  });
}

// ---------- 3. UDP 广播 ----------
const udpClient = dgram.createSocket('udp4');
const udpServer = dgram.createSocket('udp4');

udpServer.on('message', (msg, rinfo) => {
  console.log(`[${PORT}] UDP 心跳收到来自 ${rinfo.address}:${rinfo.port} —— ${msg.toString()}`);
});

udpServer.bind(UDP_PORT, () => {
  console.log(`[${PORT}] UDP 广播监听已启动，端口 ${UDP_PORT}`);
  // 设置定时器发送心跳
  setInterval(() => {
    const msg = Buffer.from(`心跳 from ${HOST}:${PORT}`);
    udpClient.send(msg, 0, msg.length, UDP_PORT, '255.255.255.255', (err) => {
      if (err) console.error(`[${PORT}] UDP 发送错误:`, err);
    });
  }, 3000);
});

// ---------- 4. WebSocket ----------
const wsServer = new WebSocket.Server({ port: PORT + 100, path: WS_PATH });
wsServer.on('connection', (ws, req) => {
  console.log(`[${PORT}] WebSocket 连接已建立 (${req.socket.remoteAddress})`);
  ws.on('message', (message) => {
    console.log(`[${PORT}] WS 收到: ${message}`);
  });
});

const wsClient = new WebSocket(`ws://${HOST}:${OTHER_PORT + 100}${WS_PATH}`);
wsClient.on('open', () => {
  console.log(`[${PORT}] WebSocket 连接到 ${OTHER_PORT + 100} 成功`);
  wsClient.send(`Hello from ${PORT}`);
});
wsClient.on('message', (data) => {
  console.log(`[${PORT}] WS 收到: ${data}`);
});
wsClient.on('error', (err) => console.error(`[${PORT}] WS 错误:`, err));

// ---------- 5. Redis Pub/Sub ----------
let redisClient, redisSub;
try {
  redisClient = redis.createClient();
  redisSub = redisClient.duplicate();

  redisClient.on('error', (err) => console.error(`[${PORT}] Redis 主客户端错误:`, err));
  redisSub.on('error', (err) => console.error(`[${PORT}] Redis 订阅客户端错误:`, err));

  redisClient.connect();
  redisSub.connect();

  redisSub.subscribe(REDIS_CHANNEL, (message) => {
    console.log(`[${PORT}] Redis 订阅收到: ${message}`);
  });

  // 定时发布心跳
  setInterval(async () => {
    await redisClient.publish(REDIS_CHANNEL, `Heartbeat from ${PORT}`);
  }, 4000);
} catch (e) {
  console.warn(`[${PORT}] Redis 未安装或未启动，跳过 Redis 方案`);
}

// ---------- 定期探测其他实例 ----------
setInterval(async () => {
  console.log(`\n[${PORT}] 开始探测 ${OTHER_PORT}`);

  // HTTP GET
  http.get(`http://${HOST}:${OTHER_PORT}/ping`, (res) => {
    console.log(`[${PORT}] HTTP ping ${OTHER_PORT}:`, res.statusCode);
  }).on('error', (err) => {
    console.log(`[${PORT}] HTTP ping ${OTHER_PORT} 错误:`, err.code);
  });

  // TCP ping
  const tcpStatus = await tcpPing(HOST, OTHER_PORT);
  console.log(`[${PORT}] TCP ping ${OTHER_PORT}:`, tcpStatus);

  // UDP 只做发送，接收由 udpServer 处理
  const msg = Buffer.from(`Ping UDP from ${PORT}`);
  udpClient.send(msg, 0, msg.length, UDP_PORT, '255.255.255.255', (err) => {
    if (err) console.error(`[${PORT}] UDP 发送错误:`, err);
    else console.log(`[${PORT}] UDP ping ${OTHER_PORT} 发送完成`);
  });

  // WebSocket 发送消息
  if (wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(`Ping WS from ${PORT}`);
    console.log(`[${PORT}] WebSocket ping ${OTHER_PORT} 发送成功`);
  } else {
    console.log(`[${PORT}] WebSocket 未连接，无法 ping`);
  }
}, 7000);