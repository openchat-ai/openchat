// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:17:34.640Z

// file: sister-status-check.js
// 运行方式：node sister-status-check.js

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const redis = require('redis');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

// ---------------------------------------------------
// 1️⃣ 为演示准备几个“姐妹实例”服务器（同进程内启动）
// ---------------------------------------------------

// TCP 服务器（端口 7001）
const tcpServer = net.createServer(socket => {
  socket.write('TCP_OK');
  socket.end();
}).listen(7001);

// UDP 服务器（端口 7002）
const udpServer = dgram.createSocket('udp4');
udpServer.on('message', (msg, rinfo) => {
  const reply = Buffer.from('UDP_OK');
  udpServer.send(reply, rinfo.port, rinfo.address);
});
udpServer.bind(7002);

// WebSocket 服务器（端口 7003）
const wss = new WebSocket.Server({ port: 7003 });
wss.on('connection', ws => {
  ws.send('WS_OK');
  ws.close();
});

// Redis Pub/Sub 服务器（使用本地默认 6379）
const redisPub = redis.createClient();
const redisSub = redis.createClient();
redisSub.subscribe('sister_heartbeat', () => {
  redisPub.publish('sister_heartbeat', 'REDIS_OK');
});

// gRPC 服务器（端口 7005）
// 定义一个非常简单的 service：Heartbeat -> returns string
const PROTO_PATH = path.join(__dirname, 'heartbeat.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const heartbeatProto = grpc.loadPackageDefinition(packageDefinition).heartbeat;

function heartbeatImpl(call, callback) {
  callback(null, { message: 'GRPC_OK' });
}
const grpcServer = new grpc.Server();
grpcServer.addService(heartbeatProto.Heartbeat.service, { heartbeat: heartbeatImpl });
grpcServer.bindAsync('0.0.0.0:7005', grpc.ServerCredentials.createInsecure(), () => {
  grpcServer.start();
});

// ---------------------------------------------------
// 2️⃣ 检测函数集合（每种方式的“ping”实现）
// ---------------------------------------------------

// 2.1 TCP Ping
function checkTCP(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    let timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, err: 'timeout' });
    }, timeout);

    socket.once('data', data => {
      clearTimeout(timer);
      resolve({ ok: true, data: data.toString() });
      socket.end();
    });

    socket.once('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, err: err.message });
    });
  });
}

// 2.2 UDP Ping
function checkUDP(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('PING');
    let timer = setTimeout(() => {
      client.close();
      resolve({ ok: false, err: 'timeout' });
    }, timeout);

    client.once('message', (msg) => {
      clearTimeout(timer);
      resolve({ ok: true, data: msg.toString() });
      client.close();
    });

    client.send(message, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        resolve({ ok: false, err: err.message });
        client.close();
      }
    });
  });
}

// 2.3 WebSocket Ping
function checkWS(url, timeout = 2000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ ok: false, err: 'timeout' });
    }, timeout);

    ws.once('message', (msg) => {
      clearTimeout(timer);
      resolve({ ok: true, data: msg });
      ws.close();
    });

    ws.once('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, err: err.message });
    });
  });
}

// 2.4 Redis Pub/Sub Ping
function checkRedis(channel = 'sister_heartbeat', timeout = 2000) {
  return new Promise((resolve) => {
    const subscriber = redis.createClient();
    const publisher = redis.createClient();

    const timer = setTimeout(() => {
      subscriber.quit();
      publisher.quit();
      resolve({ ok: false, err: 'timeout' });
    }, timeout);

    subscriber.once('message', (chan, message) => {
      if (chan === channel) {
        clearTimeout(timer);
        resolve({ ok: true, data: message });
        subscriber.quit();
        publisher.quit();
      }
    });

    subscriber.subscribe(channel, () => {
      publisher.publish(channel, 'PING');
    });

    subscriber.once('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, err: e.message });
    });
  });
}

// 2.5 gRPC Ping
function checkGRPC(address, timeout = 2000) {
  return new Promise((resolve) => {
    const client = new heartbeatProto.Heartbeat(address, grpc.credentials.createInsecure());

    const deadline = new Date(Date.now() + timeout);
    client.heartbeat({}, { deadline }, (err, response) => {
      if (err) {
        resolve({ ok: false, err: err.message });
      } else {
        resolve({ ok: true, data: response.message });
      }
    });
  });
}

// ---------------------------------------------------
// 3️⃣ 主函数：依次尝试所有方式并打印结果
// ---------------------------------------------------
async function main() {
  console.log('--- 开始姐妹实例状态检测 ---\n');

  const results = [];

  // TCP
  results.push({
    method: 'TCP',
    result: await checkTCP('127.0.0.1', 7001),
  });

  // UDP
  results.push({
    method: 'UDP',
    result: await checkUDP('127.0.0.1', 7002),
  });

  // WebSocket
  results.push({
    method: 'WebSocket',
    result: await checkWS('ws://127.0.0.1:7003'),
  });

  // Redis Pub/Sub
  results.push({
    method: 'Redis Pub/Sub',
    result: await checkRedis(),
  });

  // gRPC
  results.push({
    method: 'gRPC',
    result: await checkGRPC('127.0.0.1:7005'),
  });

  // 打印对比结果
  console.log('\n--- 检测结果汇总 ---');
  results.forEach(r => {
    if (r.result.ok) {
      console.log(`[${r.method}] ✅ 可达，返回: ${r.result.data}`);
    } else {
      console.log(`[${r.method}] ❌ 不可达，错误: ${r.result.err}`);
    }
  });

  // 关闭所有服务器（演示结束后退出进程）
  tcpServer.close();
  udpServer.close();
  wss.close();
  redisPub.quit();
  redisSub.quit();
  grpcServer.forceShutdown();
}

main().catch(err => console.error('主函数异常：', err));