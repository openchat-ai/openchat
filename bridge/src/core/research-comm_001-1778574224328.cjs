// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:23:44.328Z

// sibling_check.js
// Node.js (CommonJS) 示例：多种实例间通讯方式的存活检测

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
let Redis; // 可能不存在
try {
  Redis = require('ioredis');
} catch (_) {
  // 没装 ioredis 时忽略
}

// ---------- 1. TCP socket ----------
function startTcpServer(port) {
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      if (data.toString() === 'PING') socket.write('PONG');
    });
  });
  server.listen(port, () => console.log(`[TCP] server listening on ${port}`));
  return server;
}
function checkTcp(host, port) {
  return new Promise((resolve) => {
    const client = net.createConnection(port, host, () => {
      client.write('PING');
    });
    client.setTimeout(1000);
    client.once('data', (data) => {
      resolve(data.toString() === 'PONG');
    });
    client.once('error', () => resolve(false));
    client.once('timeout', () => {
      client.destroy();
      resolve(false);
    });
  });
}

// ---------- 2. UDP socket ----------
function startUdpServer(port) {
  const server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    if (msg.toString() === 'PING') {
      server.send('PONG', rinfo.port, rinfo.address);
    }
  });
  server.bind(port, () => console.log(`[UDP] server bound on ${port}`));
  return server;
}
function checkUdp(host, port) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const timeout = setTimeout(() => {
      client.close();
      resolve(false);
    }, 1000);
    client.once('message', (msg) => {
      clearTimeout(timeout);
      client.close();
      resolve(msg.toString() === 'PONG');
    });
    client.send('PING', port, host);
  });
}

// ---------- 3. WebSocket ----------
function startWsServer(port) {
  const wss = new WebSocket.Server({ port }, () => {
    console.log(`[WS] server listening on ${port}`);
  });
  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      if (msg === 'PING') ws.send('PONG');
    });
  });
  return wss;
}
function checkWs(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, 1500);
    ws.on('open', () => ws.send('PING'));
    ws.on('message', (msg) => {
      clearTimeout(timer);
      ws.terminate();
      resolve(msg === 'PONG');
    });
    ws.on('error', () => resolve(false));
  });
}

// ---------- 4. Redis Pub/Sub ----------
async function startRedisServer() {
  if (!Redis) {
    console.log('[Redis] ioredis not installed, skipping Redis test.');
    return null;
  }
  const sub = new Redis(); // 订阅端
  const pub = new Redis(); // 发布端
  await sub.subscribe('sibling-ping');
  sub.on('message', (channel, message) => {
    if (message === 'PING') pub.publish('sibling-pong', 'PONG');
  });
  console.log('[Redis] pub/sub channels ready');
  return { sub, pub };
}
async function checkRedis() {
  if (!Redis) return false;
  const client = new Redis();
  const reply = await client.ping(); // 简单的 PING 命令
  await client.quit();
  return reply === 'PONG';
}

// ---------- 主流程 ----------
(async () => {
  // 端口/地址统一定义
  const HOST = '127.0.0.1';
  const TCP_PORT = 4000;
  const UDP_PORT = 4001;
  const WS_PORT = 4002;
  const WS_URL = `ws://${HOST}:${WS_PORT}`;

  // 启动各类服务（模拟“姐妹实例”）
  const tcpSrv = startTcpServer(TCP_PORT);
  const udpSrv = startUdpServer(UDP_PORT);
  const wsSrv = startWsServer(WS_PORT);
  const redisSrv = await startRedisServer();

  // 等待服务准备好（实际项目中可以加更健壮的 ready 检测，这里略过 200ms）
  await new Promise(r => setTimeout(r, 200));

  // 逐一检测
  const results = await Promise.all([
    checkTcp(HOST, TCP_PORT),
    checkUdp(HOST, UDP_PORT),
    checkWs(WS_URL),
    checkRedis()
  ]);

  console.log('\n=== 姐妹实例存活检测结果 ===');
  console.log(`TCP socket   : ${results[0] ? 'OK' : 'FAIL'}`);
  console.log(`UDP socket   : ${results[1] ? 'OK' : 'FAIL'}`);
  console.log(`WebSocket    : ${results[2] ? 'OK' : 'FAIL'}`);
  console.log(`Redis PING   : ${results[3] ? 'OK' : 'FAIL'}`);

  // 关闭所有服务
  tcpSrv.close();
  udpSrv.close();
  wsSrv.close();
  if (redisSrv) {
    redisSrv.sub.disconnect();
    redisSrv.pub.disconnect();
  }
})();