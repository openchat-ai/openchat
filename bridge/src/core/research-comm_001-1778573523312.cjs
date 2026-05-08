// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:12:03.312Z

// file: sister-status.js
const net = require('net');
const fs = require('fs');
const path = require('path');
const redis = require('redis');
const zmq = require('zeromq');

// ---------- 配置 ----------
const TCP_PORT = 4000;
const UNIX_SOCKET_PATH = '/tmp/sister.sock';
const REDIS_CHANNEL = 'sister_heartbeat';
const ZMQ_ENDPOINT = 'tcp://127.0.0.1:5555';

// ---------- 结果收集 ----------
const results = {
  tcp: false,
  unix: false,
  redis: false,
  zmq: false,
};

// ---------- 1. TCP Server ----------
const tcpServer = net.createServer((socket) => {
  socket.on('data', (data) => {
    if (data.toString() === 'ping') {
      socket.write('pong');
    }
  });
});
tcpServer.listen(TCP_PORT, () => {
  console.log(`[TCP] Server listening on port ${TCP_PORT}`);
});

// ---------- 2. Unix Domain Socket Server ----------
if (fs.existsSync(UNIX_SOCKET_PATH)) {
  fs.unlinkSync(UNIX_SOCKET_PATH); // 清理残留文件
}
const unixServer = net.createServer((socket) => {
  socket.on('data', (data) => {
    if (data.toString() === 'ping') {
      socket.write('pong');
    }
  });
});
unixServer.listen(UNIX_SOCKET_PATH, () => {
  console.log(`[UNIX] Server listening on ${UNIX_SOCKET_PATH}`);
});

// ---------- 3. Redis Pub/Sub ----------
let redisClient, redisSub;
try {
  redisClient = redis.createClient(); // publish
  redisSub = redis.createClient();    // subscribe
  redisSub.subscribe(REDIS_CHANNEL);
  redisSub.on('message', (chan, msg) => {
    if (chan === REDIS_CHANNEL && msg === 'pong') {
      results.redis = true;
    }
  });
  console.log('[Redis] Pub/Sub ready');
} catch (e) {
  console.warn('[Redis] Not available, skip Redis test');
}

// ---------- 4. ZeroMQ PUSH/PULL ----------
(async () => {
  try {
    const pull = new zmq.Pull();
    const push = new zmq.Push();

    await pull.bind(ZMQ_ENDPOINT);
    await push.connect(ZMQ_ENDPOINT);

    // Pull side: reply pong
    (async () => {
      for await (const [msg] of pull) {
        if (msg.toString() === 'ping') {
          await push.send('pong');
        }
      }
    })();

    console.log(`[ZeroMQ] Bound to ${ZMQ_ENDPOINT}`);
  } catch (err) {
    console.warn('[ZeroMQ] Not available, skip ZeroMQ test');
  }
})();

// ---------- 客户端检测函数 ----------
function checkTCP() {
  const client = net.createConnection({ port: TCP_PORT }, () => {
    client.write('ping');
  });
  client.setTimeout(1000);
  client.on('data', (data) => {
    if (data.toString() === 'pong') results.tcp = true;
    client.end();
  });
  client.on('error', () => client.destroy());
  client.on('timeout', () => client.destroy());
}

function checkUnix() {
  const client = net.createConnection({ path: UNIX_SOCKET_PATH }, () => {
    client.write('ping');
  });
  client.setTimeout(1000);
  client.on('data', (data) => {
    if (data.toString() === 'pong') results.unix = true;
    client.end();
  });
  client.on('error', () => client.destroy());
  client.on('timeout', () => client.destroy());
}

function checkRedis() {
  if (!redisClient) return;
  // 先发布 ping，另一实例（如果有）会回 pong；这里自己模拟一个回 pong
  redisSub.once('message', (chan, msg) => {
    if (chan === REDIS_CHANNEL && msg === 'pong') results.redis = true;
  });
  redisClient.publish(REDIS_CHANNEL, 'ping');
  // 为演示起见，自己立刻回 pong（模拟另一个实例）
  redisClient.publish(REDIS_CHANNEL, 'pong');
}

function checkZMQ() {
  // 使用同一个端点的 PUSH/PULL 已在上面创建，这里只做一次 ping
  (async () => {
    try {
      const push = new zmq.Push();
      const pull = new zmq.Pull();
      await push.connect(ZMQ_ENDPOINT);
      await pull.connect(ZMQ_ENDPOINT);
      await push.send('ping');
      const [msg] = await pull.receive();
      if (msg.toString() === 'pong') results.zmq = true;
    } catch (e) {
      // ignore
    }
  })();
}

// ---------- 定时检测 ----------
setInterval(() => {
  // 重置
  results.tcp = results.unix = results.redis = results.zmq = false;

  checkTCP();
  checkUnix();
  checkRedis();
  checkZMQ();

  // 1 秒后输出结果（给异步操作留时间）
  setTimeout(() => {
    console.log('--- Sister status check ---');
    console.log('TCP  reachable :', results.tcp);
    console.log('Unix reachable :', results.unix);
    console.log('Redis reachable:', results.redis);
    console.log('ZeroMQ reachable:', results.zmq);
    console.log('----------------------------\n');
  }, 1200);
}, 5000);

// ---------- 程序退出时清理 ----------
function cleanup() {
  tcpServer.close();
  unixServer.close(() => {
    if (fs.existsSync(UNIX_SOCKET_PATH)) fs.unlinkSync(UNIX_SOCKET_PATH);
  });
  if (redisClient) redisClient.quit();
  if (redisSub) redisSub.quit();
  process.exit();
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);