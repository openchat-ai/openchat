// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:09:24.655Z

// filename: sister-status-check.js
// Node.js (CommonJS) 示例 – 多种实例间通讯方式检测

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { Server: WSserver, WebSocket } = require('ws');
const Redis = require('ioredis');

// --------------------------
// 配置
// --------------------------
const CONFIG = {
  tcpPort: 4000,
  udpPort: 4001,
  wsPort: 4002,
  unixSocketPath: '/tmp/sister.sock',
  redisChannel: 'sister_heartbeat',
  timeout: 2000, // ms
};

// --------------------------
// 1. 启动“姐妹实例”服务器（模拟被监控方）
// --------------------------
function startServers() {
  // 1) TCP
  net.createServer(socket => {
    socket.on('data', data => {
      if (data.toString().trim() === 'ping') {
        socket.write('pong');
      }
    });
  }).listen(CONFIG.tcpPort, () => console.log(`[Server] TCP listening on port ${CONFIG.tcpPort}`));

  // 2) UDP
  const udpServer = dgram.createSocket('udp4');
  udpServer.on('message', (msg, rinfo) => {
    if (msg.toString().trim() === 'ping') {
      udpServer.send(Buffer.from('pong'), rinfo.port, rinfo.address);
    }
  });
  udpServer.bind(CONFIG.udpPort, () => console.log(`[Server] UDP listening on port ${CONFIG.udpPort}`));

  // 3) WebSocket
  const wss = new WSserver({ port: CONFIG.wsPort });
  wss.on('connection', ws => {
    ws.on('message', msg => {
      if (msg.toString() === 'ping') ws.send('pong');
    });
  });
  console.log(`[Server] WebSocket listening on port ${CONFIG.wsPort}`);

  // 4) Unix Domain Socket (named pipe)
  // 删除可能残留的旧文件
  try { fs.unlinkSync(CONFIG.unixSocketPath); } catch (_) {}
  const unixServer = net.createServer(socket => {
    socket.on('data', d => {
      if (d.toString().trim() === 'ping') socket.write('pong');
    });
  });
  unixServer.listen(CONFIG.unixSocketPath, () => console.log(`[Server] Unix socket listening on ${CONFIG.unixSocketPath}`));

  // 5) Redis Pub/Sub 心跳
  const redisPub = new Redis();
  setInterval(() => {
    redisPub.publish(CONFIG.redisChannel, JSON.stringify({ ts: Date.now() }));
  }, 1000);
  console.log(`[Server] Redis heartbeat publishing on channel "${CONFIG.redisChannel}"`);
}

// --------------------------
// 2. 客户端检测实现
// --------------------------
function checkTCP() {
  return new Promise((resolve) => {
    const client = net.createConnection({ port: CONFIG.tcpPort }, () => {
      client.write('ping');
    });
    client.setTimeout(CONFIG.timeout);
    client.once('data', data => {
      resolve(data.toString() === 'pong' ? 'alive' : 'unexpected');
      client.end();
    });
    client.once('timeout', () => {
      resolve('timeout');
      client.destroy();
    });
    client.once('error', err => {
      resolve(`error: ${err.message}`);
    });
  });
}

function checkUDP() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const msg = Buffer.from('ping');
    client.send(msg, CONFIG.udpPort, '127.0.0.1');
    client.once('message', (msg) => {
      resolve(msg.toString() === 'pong' ? 'alive' : 'unexpected');
      client.close();
    });
    setTimeout(() => {
      resolve('timeout');
      client.close();
    }, CONFIG.timeout);
  });
}

function checkWebSocket() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${CONFIG.wsPort}`);
    const timer = setTimeout(() => {
      resolve('timeout');
      ws.terminate();
    }, CONFIG.timeout);
    ws.on('open', () => ws.send('ping'));
    ws.on('message', data => {
      clearTimeout(timer);
      resolve(data.toString() === 'pong' ? 'alive' : 'unexpected');
      ws.close();
    });
    ws.on('error', err => {
      clearTimeout(timer);
      resolve(`error: ${err.message}`);
    });
  });
}

function checkUnixSocket() {
  return new Promise((resolve) => {
    const client = net.createConnection({ path: CONFIG.unixSocketPath }, () => {
      client.write('ping');
    });
    client.setTimeout(CONFIG.timeout);
    client.once('data', d => {
      resolve(d.toString() === 'pong' ? 'alive' : 'unexpected');
      client.end();
    });
    client.once('timeout', () => {
      resolve('timeout');
      client.destroy();
    });
    client.once('error', err => {
      resolve(`error: ${err.message}`);
    });
  });
}

function checkRedis() {
  return new Promise((resolve) => {
    const sub = new Redis();
    let timer = setTimeout(() => {
      resolve('timeout');
      sub.disconnect();
    }, CONFIG.timeout);
    sub.subscribe(CONFIG.redisChannel, (err, count) => {
      if (err) {
        clearTimeout(timer);
        resolve(`error: ${err.message}`);
        sub.disconnect();
      }
    });
    sub.on('message', (channel, message) => {
      if (channel === CONFIG.redisChannel) {
        clearTimeout(timer);
        resolve('alive');
        sub.disconnect();
      }
    });
  });
}

// --------------------------
// 3. 主流程 – 依次检测并打印结果
// --------------------------
async function runChecks() {
  console.log('\n=== 开始检测姐妹实例状态 ===\n');

  const results = await Promise.all([
    checkTCP(),
    checkUDP(),
    checkWebSocket(),
    checkUnixSocket(),
    checkRedis(),
  ]);

  console.log('检测结果:');
  console.log(`1. TCP socket      : ${results[0]}`);
  console.log(`2. UDP socket      : ${results[1]}`);
  console.log(`3. WebSocket       : ${results[2]}`);
  console.log(`4. Unix domain sock: ${results[3]}`);
  console.log(`5. Redis Pub/Sub   : ${results[4]}`);

  console.log('\n=== 结束 ===\n');
}

// --------------------------
// 4. 启动并执行
// --------------------------
startServers();

// 给服务器一点启动时间（尤其是 Redis 可能稍慢）
setTimeout(runChecks, 500);