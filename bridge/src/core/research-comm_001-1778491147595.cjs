// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:19:07.595Z

// file: instance-communication-demo.js
// 运行方式：node instance-communication-demo.js

// ==================== 1. TCP Socket ====================
const net = require('net');

function startTcpServer(port) {
  const server = net.createServer((socket) => {
    socket.on('data', (buf) => {
      const msg = buf.toString();
      if (msg === 'ping') {
        socket.write('pong');
      }
    });
  });
  server.listen(port, () => console.log(`[TCP] Server listening on port ${port}`));
  return server;
}

function tcpPing(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const client = net.createConnection({ host, port }, () => {
      client.write('ping');
    });
    client.setTimeout(timeout);
    client.on('data', (data) => {
      resolve(data.toString() === 'pong');
      client.end();
    });
    client.on('error', () => resolve(false));
    client.on('timeout', () => {
      resolve(false);
      client.destroy();
    });
  });
}

// ==================== 2. UDP Socket ====================
const dgram = require('dgram');

function startUdpServer(port) {
  const server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    if (msg.toString() === 'ping') {
      server.send('pong', rinfo.port, rinfo.address);
    }
  });
  server.bind(port, () => console.log(`[UDP] Server bound to ${port}`));
  return server;
}

function udpPing(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const msg = Buffer.from('ping');
    client.send(msg, port, host);
    client.on('message', (msg) => {
      resolve(msg.toString() === 'pong');
      client.close();
    });
    client.on('error', () => {
      resolve(false);
      client.close();
    });
    setTimeout(() => {
      resolve(false);
      client.close();
    }, timeout);
  });
}

// ==================== 3. WebSocket ====================
const WebSocket = require('ws');

function startWsServer(port) {
  const wss = new WebSocket.Server({ port }, () => console.log(`[WS] Server listening on ${port}`));
  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      if (msg === 'ping') ws.send('pong');
    });
  });
  return wss;
}

function wsPing(url, timeout = 2000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      resolve(false);
      ws.terminate();
    }, timeout);
    ws.on('open', () => ws.send('ping'));
    ws.on('message', (msg) => {
      clearTimeout(timer);
      resolve(msg === 'pong');
      ws.close();
    });
    ws.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// ==================== 4. Redis Pub/Sub ====================
const redis = require('redis');

async function startRedisPubSub(channel) {
  const sub = redis.createClient();
  const pub = redis.createClient();
  await sub.connect();
  await pub.connect();

  await sub.subscribe(channel, (msg) => {
    if (msg === 'ping') pub.publish(channel, 'pong');
  });

  console.log(`[Redis] Pub/Sub ready on channel "${channel}"`);
  return { sub, pub };
}

async function redisPing(pub, sub, channel, timeout = 2000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, timeout);

    const onMessage = (msg) => {
      if (msg === 'pong') {
        clearTimeout(timer);
        resolve(true);
        sub.unsubscribe(channel).then(() => sub.quit());
        pub.quit();
      }
    };

    sub.subscribe(channel, onMessage).then(() => {
      pub.publish(channel, 'ping');
    });
  });
}

// ==================== 5. gRPC ====================
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_PATH = path.join(__dirname, 'health.proto');
// health.proto 内容（放在同目录）
// syntax = "proto3";
// package health;
// service Health {
//   rpc Check (Empty) returns (Status);
// }
// message Empty {}
// message Status { bool alive = 1; }

function startGrpcServer(port) {
  const packageDef = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
  const healthProto = grpc.loadPackageDefinition(packageDef).health;

  const server = new grpc.Server();
  server.addService(healthProto.Health.service, {
    Check: (_, callback) => callback(null, { alive: true })
  });
  server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, bindPort) => {
    if (err) throw err;
    server.start();
    console.log(`[gRPC] Server started on ${bindPort}`);
  });
  return server;
}

function grpcCheck(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const packageDef = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const healthProto = grpc.loadPackageDefinition(packageDef).health;
    const client = new healthProto.Health(`${host}:${port}`, grpc.credentials.createInsecure());

    const deadline = new Date(Date.now() + timeout);
    client.Check({}, { deadline }, (err, response) => {
      if (err) {
        resolve(false);
      } else {
        resolve(response.alive === true);
      }
    });
  });
}

// ==================== 主流程 ====================
(async () => {
  // 端口/通道统一配置，方便一次性关闭
  const tcpPort = 4001;
  const udpPort = 4002;
  const wsPort = 4003;
  const redisChannel = 'instance-health';
  const grpcPort = 4004;

  // 启动各类服务
  const tcpSrv = startTcpServer(tcpPort);
  const udpSrv = startUdpServer(udpPort);
  const wsSrv = startWsServer(wsPort);
  const { sub: redisSub, pub: redisPub } = await startRedisPubSub(redisChannel);
  const grpcSrv = startGrpcServer(grpcPort);

  // 稍作等待，确保服务已就绪
  await new Promise(r => setTimeout(r, 500));

  // 逐个检测
  const results = await Promise.all([
    tcpPing('127.0.0.1', tcpPort).then(r => ({ method: 'TCP', alive: r })),
    udpPing('127.0.0.1', udpPort).then(r => ({ method: 'UDP', alive: r })),
    wsPing(`ws://127.0.0.1:${wsPort}`).then(r => ({ method: 'WebSocket', alive: r })),
    redisPing(redisPub, redisSub, redisChannel).then(r => ({ method: 'Redis Pub/Sub', alive: r })),
    grpcCheck('127.0.0.1', grpcPort).then(r => ({ method: 'gRPC', alive: r }))
  ]);

  console.log('\n=== 实例间状态检测结果 ===');
  results.forEach(r => console.log(`${r.method}: ${r.alive ? '✅ 存活' : '❌ 不可达'}`));

  // 关闭服务（演示结束后退出进程）
  tcpSrv.close();
  udpSrv.close();
  wsSrv.close();
  grpcSrv.forceShutdown();
  // Redis 连接已在 redisPing 里关闭
  // 稍等一下让所有关闭日志输出完毕
  setTimeout(() => process.exit(0), 500);
})();