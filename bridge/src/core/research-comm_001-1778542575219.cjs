// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:36:15.219Z

// file: sibling-health-check.js
const { fork } = require('child_process');
const net = require('net');
const dgram = require('dgram');
const redis = require('redis');

// ---------- 1. 启动子进程（模拟姐妹实例） ----------
const sibling = fork(__filename, ['--sibling']); // 同一文件作为子进程入口

// 子进程逻辑
if (process.argv.includes('--sibling')) {
  // 1) IPC 方式
  process.on('message', (msg) => {
    if (msg.type === 'ping' && msg.channel === 'ipc') {
      process.send({ type: 'pong', channel: 'ipc' });
    }
  });

  // 2) TCP Server
  const tcpServer = net.createServer((socket) => {
    socket.on('data', (data) => {
      const msg = data.toString();
      if (msg === 'ping:tcp') {
        socket.write('pong:tcp');
      }
    });
  });
  tcpServer.listen(4000, '127.0.0.1');

  // 3) UDP Server
  const udpServer = dgram.createSocket('udp4');
  udpServer.on('message', (msg, rinfo) => {
    if (msg.toString() === 'ping:udp') {
      udpServer.send('pong:udp', rinfo.port, rinfo.address);
    }
  });
  udpServer.bind(5000, '127.0.0.1');

  // 4) Redis Pub/Sub
  const sub = redis.createClient();
  const pub = redis.createClient();
  sub.subscribe('sibling:channel');
  sub.on('message', (channel, message) => {
    if (message === 'ping:redis') {
      pub.publish('sibling:channel', 'pong:redis');
    }
  });

  // 保持子进程不退出
  setInterval(() => {}, 1 << 30);
  return; // 子进程到此结束，不执行下面的检测代码
}

// ---------- 2. 主进程：各种检测方式 ----------
const CHECK_INTERVAL = 2000; // 2 秒一次
const TIMEOUT = 1000; // 1 秒未收到响应视为离线

// 2.1 IPC
function checkIPC() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), TIMEOUT);
    sibling.once('message', (msg) => {
      if (msg.type === 'pong' && msg.channel === 'ipc') {
        clearTimeout(timeout);
        resolve(true);
      }
    });
    sibling.send({ type: 'ping', channel: 'ipc' });
  });
}

// 2.2 TCP
function checkTCP() {
  return new Promise((resolve) => {
    const client = new net.Socket();
    let responded = false;

    const timeout = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, TIMEOUT);

    client.connect(4000, '127.0.0.1', () => {
      client.write('ping:tcp');
    });

    client.on('data', (data) => {
      if (data.toString() === 'pong:tcp') {
        responded = true;
        clearTimeout(timeout);
        client.destroy();
        resolve(true);
      }
    });

    client.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

// 2.3 UDP
function checkUDP() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const timeout = setTimeout(() => {
      client.close();
      resolve(false);
    }, TIMEOUT);

    client.once('message', (msg) => {
      if (msg.toString() === 'pong:udp') {
        clearTimeout(timeout);
        client.close();
        resolve(true);
      }
    });

    client.send('ping:udp', 5000, '127.0.0.1');
  });
}

// 2.4 Redis Pub/Sub
function checkRedis() {
  return new Promise((resolve) => {
    const sub = redis.createClient();
    const pub = redis.createClient();

    const timeout = setTimeout(() => {
      sub.quit();
      pub.quit();
      resolve(false);
    }, TIMEOUT);

    sub.subscribe('sibling:channel');
    sub.on('message', (channel, message) => {
      if (message === 'pong:redis') {
        clearTimeout(timeout);
        sub.quit();
        pub.quit();
        resolve(true);
      }
    });

    // 发送 ping
    pub.publish('sibling:channel', 'ping:redis');
  });
}

// 汇总并打印结果
async function runChecks() {
  const results = await Promise.all([
    checkIPC(),
    checkTCP(),
    checkUDP(),
    checkRedis().catch(() => false), // 若 Redis 未启动则返回 false
  ]);

  const names = ['IPC', 'TCP Socket', 'UDP', 'Redis Pub/Sub'];
  console.log('\n=== 姐妹实例状态检测结果 ===');
  results.forEach((ok, idx) => {
    console.log(`${names[idx]}: ${ok ? '✅ 在线' : '❌ 离线'}`);
  });
  console.log('==============================\n');
}

// 定时循环检测
setInterval(runChecks, CHECK_INTERVAL);
runChecks(); // 首次立即执行