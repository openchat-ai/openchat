// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:48:29.722Z

// sister-status-test.js
// ------------------------------------------------------------
// 研究：HTTP Ping 之外，哪些方式可以检测姐妹实例状态？
const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const redis = require('redis');
const { promisify } = require('util');

// ---------- 配置 ----------
const INSTANCE_A_PORT = 8000;
const INSTANCE_B_PORT = 8001;

// ---------- 1. HTTP Ping ----------
async function httpPing(targetPort) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${targetPort}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(`HTTP ${res.statusCode}: ${data}`));
    });
    req.on('error', () => resolve('HTTP: 连接错误'));
    req.setTimeout(2000, () => resolve('HTTP: 超时'));
  });
}

// ---------- 2. TCP Keep‑Alive ----------
async function tcpPing(targetPort) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(2000);
    socket.setKeepAlive(true, 1000);

    socket.connect(targetPort, '127.0.0.1', () => {
      resolved = true;
      socket.end();
      resolve('TCP: 连接成功 (Keep‑Alive)');
    });

    socket.on('error', () => {
      if (!resolved) resolve('TCP: 连接错误');
    });

    socket.on('timeout', () => {
      if (!resolved) resolve('TCP: 超时');
    });
  });
}

// ---------- 3. UDP Ping ----------
const dgram = require('dgram');
async function udpPing(targetPort) {
  const client = dgram.createSocket('udp4');
  const message = Buffer.from('ping');
  return new Promise((resolve) => {
    client.send(message, targetPort, '127.0.0.1', (err) => {
      if (err) return resolve('UDP: 发送错误');
    });

    client.on('message', (msg, rinfo) => {
      resolve(`UDP: 收到 "${msg.toString()}" from ${rinfo.port}`);
    });

    setTimeout(() => {
      resolve('UDP: 超时');
      client.close();
    }, 2000);
  });
}

// ---------- 4. Redis Pub/Sub ----------
async function redisPing() {
  const sub = redis.createClient();
  const pub = redis.createClient();

  const getAsync = promisify(pub.publish).bind(pub);

  return new Promise((resolve) => {
    sub.on('message', () => {
      resolve('Redis: 接收到 pong');
      sub.quit();
      pub.quit();
    });

    sub.subscribe('sister-heartbeat', (err) => {
      if (err) return resolve('Redis: 订阅错误');
      // 发送一次 ping
      getAsync('sister-heartbeat', 'pong').catch(() => {
        resolve('Redis: 发布错误');
      });
    });

    setTimeout(() => {
      resolve('Redis: 超时');
      sub.quit();
      pub.quit();
    }, 2000);
  });
}

// ---------- 5. Socket.io ----------
async function socketIoPing() {
  const io = require('socket.io-client');
  return new Promise((resolve) => {
    const socket = io(`http://localhost:${INSTANCE_B_PORT}`, {
      reconnectionAttempts: 1,
      timeout: 2000,
    });

    socket.on('connect', () => {
      socket.emit('ping', 'hello');
    });

    socket.on('pong', (msg) => {
      resolve(`Socket.io: 收到 "${msg}"`);
      socket.disconnect();
    });

    socket.on('connect_error', () => {
      resolve('Socket.io: 连接错误');
    });

    setTimeout(() => {
      resolve('Socket.io: 超时');
      socket.disconnect();
    }, 2000);
  });
}

// ---------- 实例 B ----------
function startInstanceB() {
  const app = express();
  const server = http.createServer(app);
  const io = socketIo(server);

  // HTTP health 端点
  app.get('/health', (req, res) => {
    res.send('OK');
  });

  // TCP 监听（用于 tcpPing）
  const net = require('net');
  const tcpServer = net.createServer((socket) => {
    socket.on('data', () => {
      socket.end();
    });
  }).listen(INSTANCE_B_PORT, () => {
    console.log(`Instance B: TCP 监听端口 ${INSTANCE_B_PORT}`);
  });

  // UDP 监听
  const udpServer = dgram.createSocket('udp4');
  udpServer.on('message', (msg, rinfo) => {
    udpServer.send(Buffer.from('pong'), rinfo.port, rinfo.address);
  });
  udpServer.bind(INSTANCE_B_PORT + 1, () => {
    console.log(`Instance B: UDP 监听端口 ${INSTANCE_B_PORT + 1}`);
  });

  // Redis 监听
  const sub = redis.createClient();
  sub.subscribe('sister-heartbeat');
  sub.on('message', (channel, message) => {
    if (message === 'pong') {
      // 直接返回 pong
      pub.publish('sister-heartbeat', 'pong');
    }
  });

  // Socket.io 监听
  io.on('connection', (socket) => {
    socket.on('ping', (msg) => {
      socket.emit('pong', `pong to ${msg}`);
    });
  });

  server.listen(INSTANCE_B_PORT, () => {
    console.log(`Instance B: HTTP 监听端口 ${INSTANCE_B_PORT}`);
  });
}

// ---------- 实例 A ----------
async function startInstanceA() {
  console.log('--- 开始测试姐妹实例状态检测方式 ---');

  console.log('\n1. HTTP Ping');
  console.log(await httpPing(INSTANCE_B_PORT));

  console.log('\n2. TCP Keep‑Alive');
  console.log(await tcpPing(INSTANCE_B_PORT));

  console.log('\n3. UDP Ping');
  console.log(await udpPing(INSTANCE_B_PORT + 1));

  console.log('\n4. Redis Pub/Sub');
  console.log(await redisPing());

  console.log('\n5. Socket.io');
  console.log(await socketIoPing());

  console.log('\n--- 测试完成 ---');
}

// ---------- 主流程 ----------
startInstanceB();
setTimeout(startInstanceA, 1000); // 给实例 B 时间启动