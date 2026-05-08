// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:42:52.861Z

// file: sister-health-check.js
// 运行方式：node sister-health-check.js

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const Redis = require('ioredis');

// ------------------- 配置 -------------------
const SISTER_HOST = '127.0.0.1';   // 姐妹实例 IP
const TCP_PORT = 3000;            // 你的服务如果有 TCP 端口
const UDP_PORT = 4000;            // 你的服务如果有 UDP 端口
const WS_PORT = 5000;             // 你的服务如果有 WebSocket 端口
const REDIS_HOST = '127.0.0.1';
const REDIS_PORT = 6379;
const HEARTBEAT_TIMEOUT = 2000;   // ms
// ------------------------------------------------

// ---------- 1. TCP 检测 ----------
function checkTcp() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    socket.setTimeout(HEARTBEAT_TIMEOUT);
    socket.once('connect', () => {
      settled = true;
      socket.destroy();
      resolve({ method: 'TCP', alive: true });
    });
    socket.once('error', () => {
      if (!settled) {
        settled = true;
        resolve({ method: 'TCP', alive: false });
      }
    });
    socket.once('timeout', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve({ method: 'TCP', alive: false });
      }
    });

    socket.connect(TCP_PORT, SISTER_HOST);
  });
}

// ---------- 2. UDP 检测 ----------
function checkUdp() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('ping');
    let responded = false;

    const timeout = setTimeout(() => {
      if (!responded) {
        client.close();
        resolve({ method: 'UDP', alive: false });
      }
    }, HEARTBEAT_TIMEOUT);

    client.once('message', (msg, rinfo) => {
      if (msg.toString() === 'pong') {
        responded = true;
        clearTimeout(timeout);
        client.close();
        resolve({ method: 'UDP', alive: true });
      }
    });

    client.send(message, 0, message.length, UDP_PORT, SISTER_HOST, (err) => {
      if (err) {
        clearTimeout(timeout);
        client.close();
        resolve({ method: 'UDP', alive: false });
      }
    });
  });
}

// ---------- 3. WebSocket 检测 ----------
function checkWebSocket() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${SISTER_HOST}:${WS_PORT}`);

    const timeout = setTimeout(() => {
      ws.terminate();
      resolve({ method: 'WebSocket', alive: false });
    }, HEARTBEAT_TIMEOUT);

    ws.on('open', () => {
      // 发送标准的 ping 帧
      ws.ping();
    });

    ws.on('pong', () => {
      clearTimeout(timeout);
      ws.terminate();
      resolve({ method: 'WebSocket', alive: true });
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      ws.terminate();
      resolve({ method: 'WebSocket', alive: false });
    });
  });
}

// ---------- 4. Redis Pub/Sub 检测 ----------
function checkRedis() {
  return new Promise(async (resolve) => {
    const sub = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
    const pub = new Redis({ host: REDIS_HOST, port: REDIS_PORT });

    const channel = 'sister:heartbeat';
    let responded = false;

    const timeout = setTimeout(() => {
      if (!responded) {
        sub.disconnect();
        pub.disconnect();
        resolve({ method: 'RedisPubSub', alive: false });
      }
    }, HEARTBEAT_TIMEOUT);

    await sub.subscribe(channel);
    sub.on('message', (chan, msg) => {
      if (chan === channel && msg === 'pong') {
        responded = true;
        clearTimeout(timeout);
        sub.disconnect();
        pub.disconnect();
        resolve({ method: 'RedisPubSub', alive: true });
      }
    });

    // 发送一次 ping，要求对端（如果有）在同一频道回复 pong
    pub.publish(channel, 'ping');
  });
}

// ---------- 主函数 ----------
async function runChecks() {
  console.log('=== 开始姐妹实例健康检查 ===');
  console.log(`目标地址: ${SISTER_HOST}`);
  const results = await Promise.all([
    checkTcp(),
    checkUdp(),
    checkWebSocket(),
    checkRedis(),
  ]);

  results.forEach((r) => {
    console.log(`[${r.method}]  => ${r.alive ? '存活 ✅' : '不可达 ❌'}`);
  });

  console.log('=== 检查结束 ===');
}

// -------------------------------------------------
// 为了能完整演示，这里提供一个 **简易的姐妹实例模拟器**（可选）
// 启动方式：在另一个终端里 `node sister-health-check.js --mock`
// -------------------------------------------------
if (process.argv.includes('--mock')) {
  // 1. TCP server
  net.createServer((socket) => socket.end()).listen(TCP_PORT, SISTER_HOST, () => {
    console.log(`Mock TCP server listening on ${SISTER_HOST}:${TCP_PORT}`);
  });

  // 2. UDP server
  const udpSrv = dgram.createSocket('udp4');
  udpSrv.on('message', (msg, rinfo) => {
    if (msg.toString() === 'ping') {
      udpSrv.send(Buffer.from('pong'), rinfo.port, rinfo.address);
    }
  });
  udpSrv.bind(UDP_PORT, SISTER_HOST, () => {
    console.log(`Mock UDP server listening on ${SISTER_HOST}:${UDP_PORT}`);
  });

  // 3. WebSocket server
  const wss = new WebSocket.Server({ port: WS_PORT, host: SISTER_HOST }, () => {
    console.log(`Mock WebSocket server listening on ws://${SISTER_HOST}:${WS_PORT}`);
  });
  wss.on('connection', (ws) => {
    ws.on('ping', () => ws.pong());
  });

  // 4. Redis heartbeat responder
  const redisSub = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
  const redisPub = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
  const hbChannel = 'sister:heartbeat';
  redisSub.subscribe(hbChannel).then(() => {
    redisSub.on('message', (chan, msg) => {
      if (chan === hbChannel && msg === 'ping') {
        redisPub.publish(hbChannel, 'pong');
      }
    });
  });

  // 只启动模拟器，不再执行检查
} else {
  runChecks().catch((e) => {
    console.error('检查过程中出现异常:', e);
  });
}