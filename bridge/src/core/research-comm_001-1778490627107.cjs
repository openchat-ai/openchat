// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:10:27.107Z

// file: sister-status-checker.js
// 运行方式：node sister-status-checker.js

// ---------- 1️⃣ 基础配置 ----------
const CONFIG = {
  tcp: { host: '127.0.0.1', port: 4000, timeout: 2000 },
  udp: { host: '127.0.0.1', port: 4001, timeout: 2000 },
  ws:  { url: 'ws://127.0.0.1:4002', timeout: 3000 },
  redis: { host: '127.0.0.1', port: 6379, channel: 'sister-ping', timeout: 3000 },
};

// ---------- 2️⃣ TCP 检测 ----------
function checkTCP() {
  return new Promise((resolve) => {
    const socket = new require('net').Socket();
    let settled = false;

    socket.setTimeout(CONFIG.tcp.timeout);
    socket.once('connect', () => {
      settled = true;
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
    socket.once('timeout', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.connect(CONFIG.tcp.port, CONFIG.tcp.host);
  });
}

// ---------- 3️⃣ UDP 检测 ----------
function checkUDP() {
  return new Promise((resolve) => {
    const dgram = require('dgram');
    const client = dgram.createSocket('udp4');
    const msg = Buffer.from('ping');
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        client.close();
        resolve(false);
      }
    }, CONFIG.udp.timeout);

    client.once('message', (msg, rinfo) => {
      if (!settled && msg.toString() === 'pong') {
        settled = true;
        clearTimeout(timer);
        client.close();
        resolve(true);
      }
    });

    client.send(msg, 0, msg.length, CONFIG.udp.port, CONFIG.udp.host, (err) => {
      if (err) {
        clearTimeout(timer);
        settled = true;
        client.close();
        resolve(false);
      }
    });
  });
}

// ---------- 4️⃣ WebSocket 检测 ----------
function checkWebSocket() {
  return new Promise((resolve) => {
    const WebSocket = require('ws');
    const ws = new WebSocket(CONFIG.ws.url, { handshakeTimeout: CONFIG.ws.timeout });

    const timer = setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, CONFIG.ws.timeout + 500);

    ws.on('open', () => {
      ws.ping(); // 触发服务器端的 pong
    });

    ws.on('pong', () => {
      clearTimeout(timer);
      ws.terminate();
      resolve(true);
    });

    ws.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// ---------- 5️⃣ Redis Pub/Sub 检测 ----------
function checkRedis() {
  return new Promise((resolve) => {
    const redis = require('redis');
    const sub = redis.createClient({ host: CONFIG.redis.host, port: CONFIG.redis.port });
    const pub = redis.createClient({ host: CONFIG.redis.host, port: CONFIG.redis.port });

    const timeout = setTimeout(() => {
      sub.quit();
      pub.quit();
      resolve(false);
    }, CONFIG.redis.timeout);

    sub.on('message', (channel, message) => {
      if (channel === CONFIG.redis.channel && message === 'pong') {
        clearTimeout(timeout);
        sub.quit();
        pub.quit();
        resolve(true);
      }
    });

    sub.subscribe(CONFIG.redis.channel, (err) => {
      if (err) {
        clearTimeout(timeout);
        sub.quit();
        pub.quit();
        return resolve(false);
      }
      // 发送 ping，期待对端（假设有另一个进程）回复 pong
      pub.publish(CONFIG.redis.channel, 'ping');
    });

    // 为了演示，这里在同一进程里模拟一个 “姐妹” 监听并回复
    const responder = redis.createClient({ host: CONFIG.redis.host, port: CONFIG.redis.port });
    responder.subscribe(CONFIG.redis.channel);
    responder.on('message', (ch, msg) => {
      if (msg === 'ping') responder.publish(ch, 'pong');
    });
  });
}

// ---------- 6️⃣ 子进程 IPC 检测 ----------
function checkChildProcess() {
  return new Promise((resolve) => {
    const { fork } = require('child_process');
    const child = fork(__filename, ['--child']);

    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 2000);

    child.once('message', (msg) => {
      if (msg === 'alive') {
        clearTimeout(timer);
        child.kill();
        resolve(true);
      }
    });

    // 主进程发送一个 ping，子进程会回一个 alive
    child.send('ping');
  });
}

// ---------- 7️⃣ 主入口 ----------
async function runChecks() {
  console.log('--- 开始检测姐妹实例状态 ---');

  const results = await Promise.all([
    checkTCP().then(r => ({ method: 'TCP', ok: r })),
    checkUDP().then(r => ({ method: 'UDP', ok: r })),
    checkWebSocket().then(r => ({ method: 'WebSocket', ok: r })),
    checkRedis().then(r => ({ method: 'Redis Pub/Sub', ok: r })),
    checkChildProcess().then(r => ({ method: 'Child Process IPC', ok: r })),
  ]);

  results.forEach(r => {
    console.log(`[${r.method}] ${r.ok ? '✅ 可达' : '❌ 不可达'}`);
  });

  console.log('--- 检测结束 ---');
}

// ---------- 8️⃣ 子进程逻辑 ----------
if (process.argv.includes('--child')) {
  // 简单的 echo 进程，收到 ping 就回复 alive
  process.on('message', (msg) => {
    if (msg === 'ping') process.send('alive');
  });
} else {
  // 只在主进程执行检查
  runChecks().catch(err => console.error('检测过程中出现异常:', err));
}