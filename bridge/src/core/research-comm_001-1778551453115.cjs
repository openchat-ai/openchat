// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T02:04:13.115Z

// file: instance-comm-test.js
// Node.js (CommonJS) 示例 – 多种实例间通讯方式检测

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const redis = require('redis');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { performance } = require('perf_hooks');

async function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

/* ---------- 1. HTTP Ping ---------- */
function startHttpServer(port) {
  const server = http.createServer((req, res) => {
    if (req.url === '/ping') {
      res.writeHead(200);
      res.end('pong');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
async function httpPing(port) {
  const start = performance.now();
  return new Promise(resolve => {
    http.get(`http://127.0.0.1:${port}/ping`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const ok = data === 'pong';
        resolve({ ok, latency: performance.now() - start });
      });
    }).on('error', () => resolve({ ok: false, latency: performance.now() - start }));
  });
}

/* ---------- 2. TCP Socket ---------- */
function startTcpServer(port) {
  const server = net.createServer(socket => {
    // 接收到连接后直接关闭，表示“活着”
    socket.end();
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
async function tcpPing(port) {
  const start = performance.now();
  return new Promise(resolve => {
    const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
      client.end();
    });
    client.on('close', () => resolve({ ok: true, latency: performance.now() - start }));
    client.on('error', () => resolve({ ok: false, latency: performance.now() - start }));
  });
}

/* ---------- 3. UDP Ping ---------- */
function startUdpServer(port) {
  const server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    // 收到 ping，回复 pong
    server.send(Buffer.from('pong'), rinfo.port, rinfo.address);
  });
  return new Promise(resolve => server.bind(port, '127.0.0.1', () => resolve(server)));
}
async function udpPing(port) {
  const client = dgram.createSocket('udp4');
  const start = performance.now();
  return new Promise(resolve => {
    client.once('message', (msg) => {
      const ok = msg.toString() === 'pong';
      resolve({ ok, latency: performance.now() - start });
      client.close();
    });
    client.send(Buffer.from('ping'), port, '127.0.0.1', (err) => {
      if (err) {
        resolve({ ok: false, latency: performance.now() - start });
        client.close();
      }
    });
    // 超时处理
    setTimeout(() => {
      resolve({ ok: false, latency: performance.now() - start });
      client.close();
    }, 1000);
  });
}

/* ---------- 4. WebSocket ---------- */
function startWsServer(port) {
  const wss = new WebSocket.Server({ port, host: '127.0.0.1' });
  wss.on('connection', ws => {
    ws.on('message', msg => {
      if (msg === 'ping') ws.send('pong');
    });
  });
  return new Promise(resolve => wss.on('listening', () => resolve(wss)));
}
async function wsPing(port) {
  const start = performance.now();
  return new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => ws.send('ping'));
    ws.on('message', msg => {
      const ok = msg === 'pong';
      resolve({ ok, latency: performance.now() - start });
      ws.terminate();
    });
    ws.on('error', () => resolve({ ok: false, latency: performance.now() - start }));
    setTimeout(() => resolve({ ok: false, latency: performance.now() - start }), 1000);
  });
}

/* ---------- 5. Redis Pub/Sub ---------- */
async function redisPing() {
  const start = performance.now();
  try {
    const pub = redis.createClient(); // 默认 127.0.0.1:6379
    const sub = redis.createClient();

    await Promise.all([pub.connect(), sub.connect()]);

    const channel = `ping_test_${Date.now()}`;
    const result = await new Promise((resolve, reject) => {
      sub.subscribe(channel, (message) => {
        if (message === 'pong') resolve({ ok: true, latency: performance.now() - start });
        else resolve({ ok: false, latency: performance.now() - start });
        sub.unsubscribe(channel).then(() => sub.quit());
        pub.quit();
      });
      // 发送 ping
      pub.publish(channel, 'ping').catch(reject);
      // 超时
      setTimeout(() => {
        resolve({ ok: false, latency: performance.now() - start });
        sub.unsubscribe(channel).then(() => sub.quit());
        pub.quit();
      }, 1000);
    });
    return result;
  } catch (e) {
    // 可能没有本地 Redis
    return { ok: false, latency: 0, error: e.message };
  }
}

/* ---------- 6. gRPC Ping ---------- */
// 定义一个极简的 proto 内容（内嵌字符串）
const PROTO_PATH = __dirname + '/ping.proto';
const fs = require('fs');
if (!fs.existsSync(PROTO_PATH)) {
  fs.writeFileSync(PROTO_PATH, `
syntax = "proto3";
package ping;

service PingService {
  rpc Ping (PingRequest) returns (PingResponse);
}
message PingRequest {}
message PingResponse { string msg = 1; }
`);
}
function startGrpcServer(port) {
  const packageDef = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
  const proto = grpc.loadPackageDefinition(packageDef).ping;
  const server = new grpc.Server();
  server.addService(proto.PingService.service, {
    Ping: (call, callback) => callback(null, { msg: 'pong' })
  });
  server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), () => server.start());
  return server;
}
async function grpcPing(port) {
  const start = performance.now();
  const packageDef = protoLoader.loadSync(PROTO_PATH);
  const proto = grpc.loadPackageDefinition(packageDef).ping;
  const client = new proto.PingService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  return new Promise(resolve => {
    client.Ping({}, (err, response) => {
      const ok = !err && response && response.msg === 'pong';
      resolve({ ok, latency: performance.now() - start, error: err ? err.message : null });
    });
    setTimeout(() => resolve({ ok: false, latency: performance.now() - start, error: 'timeout' }), 1000);
  });
}

/* ---------- 主流程 ---------- */
(async () => {
  console.log('=== 实例间通讯方式研究 (本机模拟) ===\n');

  // 端口统一管理，防止冲突
  const ports = {
    http: 3001,
    tcp: 3002,
    udp: 3003,
    ws: 3004,
    grpc: 3005
  };

  // 启动服务
  const httpSrv = await startHttpServer(ports.http);
  const tcpSrv = await startTcpServer(ports.tcp);
  const udpSrv = await startUdpServer(ports.udp);
  const wsSrv = await startWsServer(ports.ws);
  const grpcSrv = startGrpcServer(ports.grpc);

  // 小延时确保服务器已就绪
  await delay(200);

  // 依次检测
  const results = {};

  results.http = await httpPing(ports.http);
  results.tcp = await tcpPing(ports.tcp);
  results.udp = await udpPing(ports.udp);
  results.ws = await wsPing(ports.ws);
  results.redis = await redisPing();
  results.grpc = await grpcPing(ports.grpc);

  // 关闭服务器
  httpSrv.close();
  tcpSrv.close();
  udpSrv.close();
  wsSrv.close();
  grpcSrv.forceShutdown();

  // 输出结果
  console.log('检测结果（ok = true 表示目标实例可达）:');
  for (const [method, info] of Object.entries(results)) {
    const base = `- ${method.toUpperCase()}: ${info.ok ? 'OK' : 'FAIL'}`;
    const latency = info.latency !== undefined ? `, latency=${info.latency.toFixed(2)}ms` : '';
    const extra = info.error ? `, error=${info.error}` : '';
    console.log(base + latency + extra);
  }

  console.log('\n研究结论:');
  console.log('1. HTTP Ping 是最直观、兼容性最好的方式，但受限于 HTTP 堆栈开销。');
  console.log('2. TCP Socket 只做一次握手，延迟更低，适合内部服务。');
  console.log('3. UDP Ping 更轻量，适合无连接、对丢包容忍的场景。');
  console.log('4. WebSocket 在需要保持长连接并双向推送时非常合适。');
  console.log('5. Redis Pub/Sub 适用于已经使用 Redis 做缓存/消息队列的系统，借助已有设施实现心跳。');
  console.log('6. gRPC 提供高效的二进制协议和流式特性，适合微服务间的强类型 RPC。');
  console.log('\n根据业务需求、网络环境以及已有基础设施，可选取一种或多种方式组合实现“姐妹实例”状态检测。');
})();