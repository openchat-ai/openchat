// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:04:37.977Z

// sister_check.js
// Node.js (CommonJS) 示例：多种实例间状态检测方式

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// 可选：如果本机有 Redis，下面的代码会尝试使用它做 Pub/Sub 检测
let RedisClient = null;
try {
  RedisClient = require('redis');
} catch (e) {
  console.log('[Info] Redis not installed, skipping Redis Pub/Sub check.');
}

// -------------------- 配置 --------------------
const CONFIG = {
  httpPort: 3000,
  tcpPort: 3001,
  udpPort: 3002,
  wsPort: 3003,
  sharedFile: path.join(__dirname, 'sister.lock'), // 用于文件锁检测
  redisChannel: 'sister_heartbeat',
  detectionTimeout: 2000, // ms
};

// -------------------- 1. HTTP Ping --------------------
function startHttpServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'alive', timestamp: Date.now() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(CONFIG.httpPort, () => {
    console.log(`[HTTP] listening on port ${CONFIG.httpPort}`);
  });
  return server;
}

// -------------------- 2. TCP Port Probe --------------------
function startTcpServer() {
  const server = net.createServer((socket) => {
    // 简单的握手协议：收到 "PING" 回复 "PONG"
    socket.on('data', (data) => {
      if (data.toString().trim() === 'PING') {
        socket.write('PONG');
      }
    });
  });
  server.listen(CONFIG.tcpPort, () => {
    console.log(`[TCP] listening on port ${CONFIG.tcpPort}`);
  });
  return server;
}

// -------------------- 3. UDP Heartbeat --------------------
function startUdpServer() {
  const server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    if (msg.toString().trim() === 'PING') {
      const reply = Buffer.from('PONG');
      server.send(reply, 0, reply.length, rinfo.port, rinfo.address);
    }
  });
  server.bind(CONFIG.udpPort, () => {
    console.log(`[UDP] listening on port ${CONFIG.udpPort}`);
  });
  return server;
}

// -------------------- 4. WebSocket Ping --------------------
function startWsServer() {
  const wss = new WebSocket.Server({ port: CONFIG.wsPort });
  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      if (msg === 'PING') {
        ws.send('PONG');
      }
    });
  });
  console.log(`[WS] listening on port ${CONFIG.wsPort}`);
  return wss;
}

// -------------------- 5. 文件锁检测 --------------------
function touchLockFile() {
  // 每 1 秒更新一次文件的修改时间，代表“活着”
  setInterval(() => {
    const now = Date.now().toString();
    fs.writeFileSync(CONFIG.sharedFile, now);
  }, 1000);
}
function startFileWatcher() {
  // 通过轮询读取文件的时间戳来判断是否活跃
  let lastMtime = 0;
  setInterval(() => {
    try {
      const stats = fs.statSync(CONFIG.sharedFile);
      if (stats.mtimeMs !== lastMtime) {
        lastMtime = stats.mtimeMs;
        // 文件被更新，说明实例活着
      }
    } catch (e) {
      // 文件不存在时视为离线
    }
  }, 500);
}

// -------------------- 6. Redis Pub/Sub --------------------
function startRedisPublisher() {
  if (!RedisClient) return null;
  const pub = RedisClient.createClient();
  pub.on('error', (err) => console.error('[Redis PUB] error', err));
  // 每秒发布一次心跳
  setInterval(() => {
    pub.publish(CONFIG.redisChannel, JSON.stringify({ ts: Date.now() }));
  }, 1000);
  console.log('[Redis] publisher started');
  return pub;
}
function startRedisSubscriber(callback) {
  if (!RedisClient) return null;
  const sub = RedisClient.createClient();
  sub.on('error', (err) => console.error('[Redis SUB] error', err));
  sub.subscribe(CONFIG.redisChannel, () => {
    console.log('[Redis] subscriber listening on channel', CONFIG.redisChannel);
  });
  sub.on('message', (channel, message) => {
    if (channel === CONFIG.redisChannel) {
      callback(JSON.parse(message));
    }
  });
  return sub;
}

// -------------------- 检测函数 --------------------
function detectHttp() {
  return new Promise((resolve) => {
    const options = {
      hostname: '127.0.0.1',
      port: CONFIG.httpPort,
      path: '/ping',
      method: 'GET',
      timeout: CONFIG.detectionTimeout,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const obj = JSON.parse(data);
          resolve({ ok: true, data: obj });
        } catch (e) {
          resolve({ ok: false, err: e });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, err: e }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, err: new Error('timeout') });
    });
    req.end();
  });
}

function detectTcp() {
  return new Promise((resolve) => {
    const client = net.createConnection({ port: CONFIG.tcpPort }, () => {
      client.write('PING');
    });
    client.setTimeout(CONFIG.detectionTimeout);
    client.on('data', (data) => {
      if (data.toString().trim() === 'PONG') {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, err: new Error('unexpected response') });
      }
      client.end();
    });
    client.on('error', (e) => resolve({ ok: false, err: e }));
    client.on('timeout', () => {
      client.destroy();
      resolve({ ok: false, err: new Error('timeout') });
    });
  });
}

function detectUdp() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const msg = Buffer.from('PING');
    client.send(msg, 0, msg.length, CONFIG.udpPort, '127.0.0.1');
    client.setTimeout(CONFIG.detectionTimeout);
    client.on('message', (msg) => {
      if (msg.toString().trim() === 'PONG') {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, err: new Error('unexpected response') });
      }
      client.close();
    });
    client.on('error', (e) => {
      resolve({ ok: false, err: e });
      client.close();
    });
    client.on('timeout', () => {
      resolve({ ok: false, err: new Error('timeout') });
      client.close();
    });
  });
}

function detectWs() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${CONFIG.wsPort}`);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ ok: false, err: new Error('timeout') });
    }, CONFIG.detectionTimeout);
    ws.on('open', () => ws.send('PING'));
    ws.on('message', (msg) => {
      if (msg === 'PONG') {
        clearTimeout(timer);
        resolve({ ok: true });
        ws.close();
      } else {
        clearTimeout(timer);
        resolve({ ok: false, err: new Error('unexpected response') });
        ws.close();
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, err: e });
    });
  });
}

function detectFile() {
  return new Promise((resolve) => {
    try {
      const stats = fs.statSync(CONFIG.sharedFile);
      const age = Date.now() - stats.mtimeMs;
      // 若文件最近 2 秒内被更新，认为在线
      resolve({ ok: age < 2000 });
    } catch (e) {
      resolve({ ok: false, err: e });
    }
  });
}

function detectRedis() {
  return new Promise((resolve) => {
    if (!RedisClient) {
      resolve({ ok: false, err: new Error('Redis client not available') });
      return;
    }
    let timeout = setTimeout(() => {
      sub.unsubscribe();
      resolve({ ok: false, err: new Error('timeout') });
    }, CONFIG.detectionTimeout);

    const sub = startRedisSubscriber((msg) => {
      clearTimeout(timeout);
      sub.unsubscribe();
      resolve({ ok: true, data: msg });
    });
  });
}

// -------------------- 主流程 --------------------
async function main() {
  // 启动所有服务
  startHttpServer();
  startTcpServer();
  startUdpServer();
  startWsServer();
  touchLockFile(); // 写文件
  startRedisPublisher(); // 如果有 Redis

  // 给服务一点启动时间
  await new Promise((r) => setTimeout(r, 500));

  console.log('\n=== 开始检测姐妹实例状态 ===\n');

  const results = await Promise.all([
    detectHttp(),
    detectTcp(),
    detectUdp(),
    detectWs(),
    detectFile(),
    detectRedis(),
  ]);

  const methods = ['HTTP Ping', 'TCP Probe', 'UDP Ping', 'WebSocket Ping', 'File Lock', 'Redis Pub/Sub'];
  results.forEach((res, idx) => {
    const method = methods[idx];
    if (res.ok) {
      console.log(`[${method}] ✅ 在线`);
    } else {
      console.log(`[${method}] ❌ 离线 / 失败 (${res.err ? res.err.message : 'no response'})`);
    }
  });

  console.log('\n--- 研究结论 ---');
  console.log(
    '1. HTTP Ping 适合跨防火墙、跨语言；\n' +
      '2. TCP Probe 更轻量，适用于内部网络；\n' +
      '3. UDP Ping 延迟最低，但不可靠，需要自行实现重试；\n' +
      '4. WebSocket 在需要保持长连接的业务场景中天然带心跳；\n' +
      '5. 文件锁适用于同机多进程的快速共享状态；\n' +
      '6. Redis Pub/Sub 在已有 Redis 基础设施时可以实现全局广播式健康检查。'
  );

  // 让服务保持运行（演示用），5 秒后退出
  setTimeout(() => {
    console.log('\nDemo 完成，退出进程。');
    process.exit(0);
  }, 5000);
}

main().catch((e) => console.error('Unexpected error:', e));