// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:23:57.398Z

// file: instance_comm_test.js
// 运行方式：node instance_comm_test.js

// ------------------------------------------------------------
// 1️⃣ 基础库
// ------------------------------------------------------------
const { fork } = require('child_process');
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const Redis = require('ioredis');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const fs = require('fs');

// ------------------------------------------------------------
// 2️⃣ 生成子进程代码（保存在临时文件里）
// ------------------------------------------------------------
const childCode = `
// 子进程代码（instance.js）
// 只负责响应各种协议的 “heartbeat” 请求
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const Redis = require('ioredis');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

// ---------- IPC ----------
process.on('message', (msg) => {
  if (msg && msg.type === 'ping') {
    process.send({ type: 'pong', from: process.pid });
  }
});

// ---------- TCP ----------
const tcpServer = net.createServer((socket) => {
  socket.write('pong');
  socket.end();
});
tcpServer.listen(4000, '127.0.0.1');

// ---------- UDP ----------
const udpServer = dgram.createSocket('udp4');
udpServer.on('message', (msg, rinfo) => {
  if (msg.toString() === 'ping') {
    udpServer.send('pong', rinfo.port, rinfo.address);
  }
});
udpServer.bind(4001, '127.0.0.1');

// ---------- WebSocket ----------
const wss = new WebSocket.Server({ port: 4002 });
wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    if (msg.toString() === 'ping') ws.send('pong');
  });
});

// ---------- Redis ----------
const redisSub = new Redis();
redisSub.subscribe('heartbeat', () => {});
redisSub.on('message', (channel, message) => {
  if (channel === 'heartbeat' && message === 'ping') {
    const redisPub = new Redis();
    redisPub.publish('heartbeat', 'pong');
    redisPub.disconnect();
  }
});

// ---------- gRPC ----------
const PROTO_PATH = path.join(__dirname, 'ping.proto');
const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const pingProto = grpc.loadPackageDefinition(packageDef).ping;
function ping(call, callback) {
  callback(null, { message: 'pong' });
}
const server = new grpc.Server();
server.addService(pingProto.Ping.service, { ping });
server.bindAsync('127.0.0.1:50051', grpc.ServerCredentials.createInsecure(), () => {
  server.start();
});

// Keep the process alive
setInterval(() => {}, 1 << 30);
`;
const childPath = path.join(__dirname, 'instance.js');
fs.writeFileSync(childPath, childCode);

// ------------------------------------------------------------
// 3️⃣ 启动子进程（模拟姐妹实例）
// ------------------------------------------------------------
const sister = fork(childPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
sister.on('error', (err) => console.error('Sister process error:', err));
sister.on('exit', (code, signal) => console.log(`Sister exited (code=${code}, signal=${signal})`));

// ------------------------------------------------------------
// 4️⃣ 检测函数集合
// ------------------------------------------------------------
async function checkIPC() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 1000);
    sister.once('message', (msg) => {
      clearTimeout(timeout);
      resolve(msg && msg.type === 'pong');
    });
    sister.send({ type: 'ping' });
  });
}

function checkTCP() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: 4000, host: '127.0.0.1' }, () => {
      socket.end();
    });
    socket.on('data', (data) => {
      resolve(data.toString() === 'pong');
    });
    socket.on('error', () => resolve(false));
    setTimeout(() => resolve(false), 1000);
  });
}

function checkUDP() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    client.send('ping', 4001, '127.0.0.1');
    client.on('message', (msg) => {
      client.close();
      resolve(msg.toString() === 'pong');
    });
    client.on('error', () => resolve(false));
    setTimeout(() => {
      client.close();
      resolve(false);
    }, 1000);
  });
}

function checkWebSocket() {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:4002');
    ws.on('open', () => ws.send('ping'));
    ws.on('message', (msg) => {
      ws.terminate();
      resolve(msg.toString() === 'pong');
    });
    ws.on('error', () => resolve(false));
    setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, 1000);
  });
}

async function checkRedis() {
  const redisPub = new Redis();
  const redisSub = new Redis();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      redisPub.disconnect();
      redisSub.disconnect();
      resolve(false);
    }, 1500);

    redisSub.subscribe('heartbeat', () => {
      redisPub.publish('heartbeat', 'ping');
    });

    redisSub.on('message', (channel, message) => {
      if (channel === 'heartbeat' && message === 'pong') {
        clearTimeout(timeout);
        redisPub.disconnect();
        redisSub.disconnect();
        resolve(true);
      }
    });
  }).catch(() => false);
}

function checkGRPC() {
  return new Promise((resolve) => {
    const PROTO_PATH = path.join(__dirname, 'ping.proto');
    const packageDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const pingProto = grpc.loadPackageDefinition(packageDef).ping;
    const client = new pingProto.Ping('127.0.0.1:50051', grpc.credentials.createInsecure());

    client.ping({}, (err, response) => {
      client.close();
      if (err) return resolve(false);
      resolve(response && response.message === 'pong');
    });

    setTimeout(() => resolve(false), 1200);
  });
}

// ------------------------------------------------------------
// 5️⃣ 主流程：依次执行检测并打印结果
// ------------------------------------------------------------
(async () => {
  console.log('=== 实例间通讯方式研究 ===\n');

  const results = {};

  results.IPC = await checkIPC();
  console.log(`[1] IPC (process.send)          : ${results.IPC ? '✓ 存活' : '✗ 未响应'}`);

  results.TCP = await checkTCP();
  console.log(`[2] TCP Socket (127.0.0.1:4000) : ${results.TCP ? '✓ 存活' : '✗ 未响应'}`);

  results.UDP = await checkUDP();
  console.log(`[3] UDP Ping (127.0.0.1:4001)   : ${results.UDP ? '✓ 存活' : '✗ 未响应'}`);

  results.WebSocket = await checkWebSocket();
  console.log(`[4] WebSocket (ws://127.0.0.1:4002) : ${results.WebSocket ? '✓ 存活' : '✗ 未响应'}`);

  results.Redis = await checkRedis();
  console.log(`[5] Redis Pub/Sub (heartbeat)    : ${results.Redis ? '✓ 存活' : '✗ 未响应（请确保本地有 Redis）'}`);

  results.gRPC = await checkGRPC();
  console.log(`[6] gRPC (Ping Service)          : ${results.gRPC ? '✓ 存活' : '✗ 未响应'}`);

  console.log('\n=== 结论 ===');
  console.log('以上方式均可用于检测“姐妹实例”是否在线，选择依据：');
  console.log('- 同机进程间推荐使用 IPC，开销最小。');
  console.log('- 跨机器或跨语言推荐 TCP/UDP、WebSocket、gRPC。');
  console.log('- 需要广播或多对多的场景可用 Redis Pub/Sub。');

  // 结束子进程
  sister.kill();
  // 清理临时文件
  fs.unlinkSync(childPath);
})();