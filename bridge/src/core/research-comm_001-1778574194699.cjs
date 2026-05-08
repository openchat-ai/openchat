// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:23:14.699Z

// file: sister_status_check.js
// Node.js >=12 (CommonJS)

const net = require('net');
const WebSocket = require('ws');
const dgram = require('dgram');
const redis = require('redis');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const zmq = require('zeromq');

// ------------------- 配置区 -------------------
// 根据实际情况修改这些目标地址/端口
const targets = {
  tcp: { host: '127.0.0.1', port: 3000 },
  ws:  { host: '127.0.0.1', port: 8080, path: '/' },
  udp: { host: '127.0.0.1', port: 4000 },
  redis: { host: '127.0.0.1', port: 6379 },
  grpc: { host: '127.0.0.1', port: 50051, protoPath: __dirname + '/health.proto' },
  zmq: { host: 'tcp://127.0.0.1:5555' }
};

const TIMEOUT = 5000; // ms
// ------------------------------------------------

// ---- 工具函数：统一的超时包装 ----
function withTimeout(promise, name) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${name} 超时 (${TIMEOUT}ms)`)), TIMEOUT)
  );
  return Promise.race([promise, timeout]);
}

// ---- 1. TCP 端口检测 ----
function checkTCP({host, port}) {
  return withTimeout(new Promise((resolve, reject) => {
    const socket = net.createConnection({host, port}, () => {
      socket.end();
      resolve('TCP 连接成功');
    });
    socket.on('error', err => reject(err));
  }), 'TCP 检测');
}

// ---- 2. WebSocket 握手 ----
function checkWS({host, port, path}) {
  const url = `ws://${host}:${port}${path}`;
  return withTimeout(new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => {
      ws.terminate();
      resolve('WebSocket 握手成功');
    });
    ws.on('error', err => reject(err));
  }), 'WebSocket 检测');
}

// ---- 3. UDP “ping” ----
function checkUDP({host, port}) {
  return withTimeout(new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    const msg = Buffer.from('ping');
    client.send(msg, 0, msg.length, port, host, err => {
      if (err) return reject(err);
    });
    client.on('message', (msg, rinfo) => {
      client.close();
      resolve(`UDP 收到回显: ${msg.toString()}`);
    });
    client.on('error', err => {
      client.close();
      reject(err);
    });
    // 若对端不回显，5s 超时会自动触发
  }), 'UDP 检测');
}

// ---- 4. Redis PING ----
function checkRedis({host, port}) {
  return withTimeout(new Promise((resolve, reject) => {
    const client = redis.createClient({socket: {host, port}});
    client.on('error', err => {
      client.quit();
      reject(err);
    });
    client.connect()
      .then(() => client.ping())
      .then(res => {
        client.quit();
        resolve(`Redis PING: ${res}`);
      })
      .catch(reject);
  }), 'Redis 检测');
}

// ---- 5. gRPC 健康检查 ----
// 需要一个标准的 health.proto（Google 提供的示例）放在同目录
/*
syntax = "proto3";

package grpc.health.v1;

service Health {
  rpc Check (HealthCheckRequest) returns (HealthCheckResponse);
}

message HealthCheckRequest {
  string service = 1;
}
enum HealthCheckResponse_ServingStatus {
  UNKNOWN = 0;
  SERVING = 1;
  NOT_SERVING = 2;
  SERVICE_UNKNOWN = 3;
}
message HealthCheckResponse {
  HealthCheckResponse_ServingStatus status = 1;
}
*/
function checkGRPC({host, port, protoPath}) {
  return withTimeout(new Promise((resolve, reject) => {
    const packageDef = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    const healthProto = grpc.loadPackageDefinition(packageDef).grpc.health.v1;
    const client = new healthProto.Health(`${host}:${port}`, grpc.credentials.createInsecure());

    const request = {service: ''}; // 空字符串表示 “整体服务”
    client.Check(request, (err, response) => {
      if (err) return reject(err);
      resolve(`gRPC Health status: ${response.status}`);
    });
  }), 'gRPC 检测');
}

// ---- 6. ZeroMQ 心跳 ----
async function checkZMQ({host}) {
  return withTimeout(new Promise(async (resolve, reject) => {
    const sock = new zmq.Request();
    try {
      await sock.connect(host);
      await sock.send('heartbeat');
      const [reply] = await sock.receive();
      await sock.disconnect(host);
      resolve(`ZeroMQ 回复: ${reply.toString()}`);
    } catch (e) {
      reject(e);
    }
  }), 'ZeroMQ 检测');
}

// ------------------- 主流程 -------------------
(async () => {
  console.log('=== 姐妹实例状态检测开始 ===\n');

  const results = [];

  // 1. TCP
  try {
    const r = await checkTCP(targets.tcp);
    results.push({method: 'TCP', result: r});
  } catch (e) {
    results.push({method: 'TCP', error: e.message});
  }

  // 2. WebSocket
  try {
    const r = await checkWS(targets.ws);
    results.push({method: 'WebSocket', result: r});
  } catch (e) {
    results.push({method: 'WebSocket', error: e.message});
  }

  // 3. UDP
  try {
    const r = await checkUDP(targets.udp);
    results.push({method: 'UDP', result: r});
  } catch (e) {
    results.push({method: 'UDP', error: e.message});
  }

  // 4. Redis
  try {
    const r = await checkRedis(targets.redis);
    results.push({method: 'Redis', result: r});
  } catch (e) {
    results.push({method: 'Redis', error: e.message});
  }

  // 5. gRPC
  try {
    const r = await checkGRPC(targets.grpc);
    results.push({method: 'gRPC', result: r});
  } catch (e) {
    results.push({method: 'gRPC', error: e.message});
  }

  // 6. ZeroMQ
  try {
    const r = await checkZMQ(targets.zmq);
    results.push({method: 'ZeroMQ', result: r});
  } catch (e) {
    results.push({method: 'ZeroMQ', error: e.message});
  }

  console.log('\n=== 检测结果 ===');
  results.forEach(item => {
    if (item.result) {
      console.log(`[✔] ${item.method}: ${item.result}`);
    } else {
      console.log(`[✘] ${item.method}: ${item.error}`);
    }
  });

  console.log('\n=== 结束 ===');
})();