// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:04:39.139Z

// file: instance-monitor.js
// 运行方式：
//   INSTANCE_ID=1 node instance-monitor.js
//   INSTANCE_ID=2 node instance-monitor.js
//   ...（启动多个实例）
// 需要提前在本机安装 Redis（默认端口 6379）

const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const redis = require('redis');
const os = require('os');

// ---------- 配置 ----------
const INSTANCE_ID = process.env.INSTANCE_ID || '0'; // 每个实例的唯一标识
const PORT_BASE = 3000; // 基础端口号
const HTTP_PORT = PORT_BASE + Number(INSTANCE_ID);
const WS_PORT   = HTTP_PORT + 100; // WebSocket 端口
const TCP_PORT  = HTTP_PORT + 200; // TCP 端口
const HEARTBEAT_INTERVAL = 3000; // 发送心跳的间隔（ms）
const HEARTBEAT_TIMEOUT  = 9000; // 超时未收到心跳视为离线（ms）
const ALL_INSTANCES = ['0','1','2','3']; // 预定义的实例列表（可自行增删）

// ---------- 状态记录 ----------
const status = {
  http: {}, ws: {}, tcp: {}, redis: {}
};
ALL_INSTANCES.forEach(id => {
  if (id !== INSTANCE_ID) {
    status.http[id] = 'unknown';
    status.ws[id]   = 'unknown';
    status.tcp[id]  = 'unknown';
    status.redis[id]= 'unknown';
  }
});

// ---------- 1. HTTP Ping ----------
const httpServer = http.createServer((req, res) => {
  if (req.url === '/ping') {
    res.writeHead(200);
    res.end('pong');
  } else {
    res.writeHead(404);
    res.end();
  }
});
httpServer.listen(HTTP_PORT, () => {
  console.log(`[${INSTANCE_ID}] HTTP server listening on port ${HTTP_PORT}`);
});

function httpPing(targetId) {
  const options = {
    hostname: '127.0.0.1',
    port: PORT_BASE + Number(targetId),
    path: '/ping',
    method: 'GET',
    timeout: 2000
  };
  const req = http.request(options, res => {
    if (res.statusCode === 200) {
      status.http[targetId] = 'online';
    } else {
      status.http[targetId] = 'offline';
    }
    res.resume();
  });
  req.on('error', () => {
    status.http[targetId] = 'offline';
  });
  req.on('timeout', () => {
    req.destroy();
    status.http[targetId] = 'offline';
  });
  req.end();
}

// ---------- 2. WebSocket Heartbeat ----------
const wss = new WebSocket.Server({ port: WS_PORT });
wss.on('connection', ws => {
  ws.on('message', msg => {
    const payload = JSON.parse(msg);
    if (payload.type === 'heartbeat') {
      status.ws[payload.from] = 'online';
    }
  });
});
console.log(`[${INSTANCE_ID}] WebSocket server listening on port ${WS_PORT}`);

const wsClients = {}; // key: targetId -> ws
function ensureWsClient(targetId) {
  if (wsClients[targetId] && wsClients[targetId].readyState === WebSocket.OPEN) return;
  const ws = new WebSocket(`ws://127.0.0.1:${PORT_BASE + Number(targetId) + 100}`);
  ws.on('open', () => {
    // console.log(`[${INSTANCE_ID}] WS connected to ${targetId}`);
  });
  ws.on('error', () => {
    status.ws[targetId] = 'offline';
  });
  wsClients[targetId] = ws;
}
function wsHeartbeat(targetId) {
  ensureWsClient(targetId);
  const ws = wsClients[targetId];
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'heartbeat', from: INSTANCE_ID }));
  }
}

// ---------- 3. TCP Socket Heartbeat ----------
const tcpServer = net.createServer(socket => {
  socket.on('data', data => {
    const msg = data.toString().trim();
    if (msg.startsWith('HB|')) {
      const from = msg.split('|')[1];
      status.tcp[from] = 'online';
    }
  });
});
tcpServer.listen(TCP_PORT, () => {
  console.log(`[${INSTANCE_ID}] TCP server listening on port ${TCP_PORT}`);
});
const tcpClients = {};
function ensureTcpClient(targetId) {
  if (tcpClients[targetId] && !tcpClients[targetId].destroyed) return;
  const client = net.createConnection({ port: PORT_BASE + Number(targetId) + 200, host: '127.0.0.1' });
  client.on('error', () => {
    status.tcp[targetId] = 'offline';
  });
  tcpClients[targetId] = client;
}
function tcpHeartbeat(targetId) {
  ensureTcpClient(targetId);
  const client = tcpClients[targetId];
  if (client && !client.destroyed) {
    client.write(`HB|${INSTANCE_ID}\n`);
  }
}

// ---------- 4. Redis Pub/Sub ----------
const redisPub = redis.createClient();
const redisSub = redis.createClient();

redisSub.subscribe('instance_heartbeat');
redisSub.on('message', (channel, message) => {
  if (channel !== 'instance_heartbeat') return;
  const payload = JSON.parse(message);
  if (payload.from !== INSTANCE_ID) {
    status.redis[payload.from] = 'online';
  }
});
redisPub.on('error', err => console.error('Redis pub error', err));
redisSub.on('error', err => console.error('Redis sub error', err));
console.log(`[${INSTANCE_ID}] Redis Pub/Sub ready (channel: instance_heartbeat)`);

function redisHeartbeat() {
  const msg = JSON.stringify({ from: INSTANCE_ID, ts: Date.now() });
  redisPub.publish('instance_heartbeat', msg);
}

// ---------- 心跳调度 ----------
function sendAllHeartbeats() {
  ALL_INSTANCES.forEach(id => {
    if (id === INSTANCE_ID) return;
    httpPing(id);
    wsHeartbeat(id);
    tcpHeartbeat(id);
    // Redis 为广播式，只需要一次发送
  });
  redisHeartbeat();
}

// ---------- 超时检测 ----------
function checkTimeouts() {
  const now = Date.now();
  // 对于 HTTP、WS、TCP、Redis，我们使用简单的计时器：
  // 每次收到心跳会把对应 entry 设为 'online'，这里再把它们在下次循环前恢复为 'offline'，
  // 这样如果在间隔内没有再次收到，则会显示为 'offline'。
  // 为了让日志更直观，这里直接在每轮结束后打印。
}

// ---------- 定时任务 ----------
setInterval(() => {
  sendAllHeartbeats();
}, HEARTBEAT_INTERVAL);

setInterval(() => {
  console.clear();
  console.log(`=== 实例 ${INSTANCE_ID} 状态报告 (每 ${HEARTBEAT_INTERVAL}ms) ===`);
  console.log('HTTP  :', status.http);
  console.log('WS    :', status.ws);
  console.log('TCP   :', status.tcp);
  console.log('Redis :', status.redis);
  // 将所有状态恢复为 unknown，等待本轮心跳更新
  ALL_INSTANCES.forEach(id => {
    if (id !== INSTANCE_ID) {
      status.http[id] = 'unknown';
      status.ws[id]   = 'unknown';
      status.tcp[id]  = 'unknown';
      status.redis[id]= 'unknown';
    }
  });
}, HEARTBEAT_INTERVAL + 1000);

// ---------- 程序启动提示 ----------
console.log(`实例 ${INSTANCE_ID} 已启动`);
console.log(`监控的其他实例: ${ALL_INSTANCES.filter(id=>id!==INSTANCE_ID).join(', ')}`);
console.log('按 Ctrl+C 退出');