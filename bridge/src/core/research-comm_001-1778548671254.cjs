// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:17:51.254Z

// master.js
// Node.js (CommonJS) 示例：多种进程间通讯方式检测姐妹实例状态

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

// ---------- 1. 生成姐妹脚本（sister.js） ----------
const sisterCode = `
// sister.js
const net = require('net');
const dgram = require('dgram');
// const Redis = require('ioredis'); // 如需使用 Redis，取消注释并确保已安装

// 进程间心跳间隔（ms）
const HEARTBEAT_INTERVAL = 2000;
let lastPeerHeartbeat = Date.now();

// ---------- 1) 父子 IPC ----------
process.on('message', (msg) => {
  if (msg.type === 'ping') {
    console.log('[${process.pid}] 收到父进程 ping，回复 pong');
    process.send({ type: 'pong', from: process.pid });
  } else if (msg.type === 'heartbeat') {
    // 来自兄弟进程的心跳
    lastPeerHeartbeat = Date.now();
  }
});

// ---------- 2) Unix Domain Socket ----------
const SOCKET_PATH = path.join(__dirname, 'sister.sock');
if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);

const server = net.createServer((socket) => {
  socket.on('data', (data) => {
    const msg = data.toString();
    if (msg === 'heartbeat') {
      // 收到兄弟的心跳
      lastPeerHeartbeat = Date.now();
    }
  });
});
server.listen(SOCKET_PATH, () => {
  // console.log('[${process.pid}] Unix socket listening at', SOCKET_PATH);
});

// 客户端（尝试连接同一套接字，若已被占用则说明是另一实例）
let client;
function connectSocket() {
  client = net.createConnection(SOCKET_PATH);
  client.on('error', () => {
    // 可能是自己在监听，等一会再重连
    setTimeout(connectSocket, 1000);
  });
}
connectSocket();

// ---------- 3) UDP 本地广播 ----------
const UDP_PORT = 41234;
const udp = dgram.createSocket('udp4');
udp.on('message', (msg, rinfo) => {
  if (msg.toString() === 'heartbeat') {
    lastPeerHeartbeat = Date.now();
  }
});
udp.bind(UDP_PORT, '127.0.0.1', () => {
  // console.log('[${process.pid}] UDP socket bound');
});

// ---------- 心跳发送 ----------
function sendHeartbeats() {
  // 1) 向父进程报告
  if (process.send) {
    process.send({ type: 'heartbeat', from: process.pid });
  }

  // 2) 向 Unix socket 发送
  if (client && !client.destroyed) {
    client.write('heartbeat');
  }

  // 3) UDP 广播（本地）
  const msg = Buffer.from('heartbeat');
  udp.send(msg, 0, msg.length, UDP_PORT, '127.0.0.1');

  // 4)（可选）Redis Pub/Sub
  // redisPub.publish('heartbeat', process.pid);
}
setInterval(sendHeartbeats, HEARTBEAT_INTERVAL);

// ---------- 检测对端是否失联 ----------
setInterval(() => {
  const now = Date.now();
  if (now - lastPeerHeartbeat > HEARTBEAT_INTERVAL * 2) {
    console.log('[${process.pid}] ⚠️ 检测到兄弟实例失联！最近心跳时间:', new Date(lastPeerHeartbeat).toISOString());
  }
}, HEARTBEAT_INTERVAL * 2);

// // ---------- 可选的 Redis 实现 ----------
/*
const redisPub = new Redis();
const redisSub = new Redis();
redisSub.subscribe('heartbeat', (err, count) => {
  if (!err) console.log('[${process.pid}] 订阅 Redis heartbeat 成功');
});
redisSub.on('message', (channel, message) => {
  if (channel === 'heartbeat') {
    lastPeerHeartbeat = Date.now();
  }
});
*/

process.on('SIGINT', () => {
  server.close();
  udp.close();
  if (client) client.destroy();
  process.exit();
});
`;

fs.writeFileSync(path.join(__dirname, 'sister.js'), sisterCode);
console.log('已生成 sister.js');

// ---------- 2. 启动两 个姐妹进程 ----------
const sisters = [];
for (let i = 0; i < 2; i++) {
  const proc = fork(path.join(__dirname, 'sister.js'));
  sisters.push(proc);
}

// 父进程每 3 秒向每个子进程发送 ping
setInterval(() => {
  sisters.forEach((p) => {
    p.send({ type: 'ping' });
  });
}, 3000);

// 监听子进程返回的 pong
sisters.forEach((p) => {
  p.on('message', (msg) => {
    if (msg.type === 'pong') {
      console.log(`[master] 收到子进程 ${msg.from} 的 pong`);
    } else if (msg.type === 'heartbeat') {
      // 转发给其他子进程，模拟“姐妹之间”直接交流
      sisters.forEach((other) => {
        if (other !== p) other.send({ type: 'heartbeat', from: msg.from });
      });
    }
  });
});

process.on('SIGINT', () => {
  console.log('\\n主进程退出，关闭所有子进程...');
  sisters.forEach((p) => p.kill('SIGINT'));
  process.exit();
});