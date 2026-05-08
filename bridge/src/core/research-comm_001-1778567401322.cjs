// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:30:01.322Z

// intercomm-demo.js
// 运行：node intercomm-demo.js
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const Redis = require('ioredis');
const zmq = require('zeromq');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// ---------------------
// 1. HTTP Ping Demo
// ---------------------
function startHttpServer(port, name) {
  const server = http.createServer((req, res) => {
    if (req.url === '/ping' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${name} OK`);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => {
    console.log(`[HTTP][${name}] listening on ${port}`);
  });
  return server;
}

function httpPing(target, port, name) {
  http.get(`http://localhost:${port}/ping`, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => console.log(`[HTTP][${name}] ping response: ${data}`));
  }).on('error', (err) => console.error(`[HTTP][${name}] ping error: ${err.message}`));
}

// ---------------------
// 2. WebSocket Demo
// ---------------------
function startWsServer(port, name) {
  const wss = new WebSocket.Server({ port }, () => {
    console.log(`[WS][${name}] listening on ${port}`);
  });
  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      console.log(`[WS][${name}] received: ${message}`);
      ws.send(`pong from ${name}`);
    });
  });
  return wss;
}

function wsPing(target, port, name) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  ws.on('open', () => {
    ws.send(`ping from ${name}`);
  });
  ws.on('message', (msg) => {
    console.log(`[WS][${name}] reply: ${msg}`);
    ws.close();
  });
  ws.on('error', (err) => console.error(`[WS][${name}] error: ${err.message}`));
}

// ---------------------
// 3. Redis Pub/Sub Demo
// ---------------------
function startRedisSubscriber(port, name) {
  const subscriber = new Redis({ port });
  subscriber.subscribe('ping_channel', (err) => {
    if (err) console.error(`[Redis][${name}] subscribe error: ${err.message}`);
    else console.log(`[Redis][${name}] subscribed to ping_channel`);
  });
  subscriber.on('message', (channel, message) => {
    console.log(`[Redis][${name}] received on ${channel}: ${message}`);
    // reply
    const publisher = new Redis({ port });
    publisher.publish('pong_channel', `pong from ${name}`);
    publisher.quit();
  });
  return subscriber;
}

function redisPing(port, name) {
  const publisher = new Redis({ port });
  publisher.publish('ping_channel', `ping from ${name}`);
  publisher.quit();
}

// ---------------------
// 4. ZeroMQ Demo
// ---------------------
async function startZmqServer(port, name) {
  const rep = new zmq.Reply();
  await rep.bind(`tcp://127.0.0.1:${port}`);
  console.log(`[ZMQ][${name}] bound to port ${port}`);
  for await (const [msg] of rep) {
    console.log(`[ZMQ][${name}] received: ${msg.toString()}`);
    await rep.send(`pong from ${name}`);
  }
}

async function zmqPing(port, name) {
  const req = new zmq.Request();
  await req.connect(`tcp://127.0.0.1:${port}`);
  console.log(`[ZMQ][${name}] connected to port ${port}`);
  await req.send(`ping from ${name}`);
  const [reply] = await req.receive();
  console.log(`[ZMQ][${name}] reply: ${reply.toString()}`);
  await req.close();
}

// ---------------------
// 5. gRPC Demo
// ---------------------
const PROTO_PATH = path.resolve(__dirname, 'ping.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const pingProto = grpc.loadPackageDefinition(packageDefinition).ping;

function startGrpcServer(port, name) {
  const server = new grpc.Server();
  server.addService(pingProto.PingService.service, {
    Ping: (call, callback) => {
      console.log(`[gRPC][${name}] received: ${call.request.message}`);
      callback(null, { message: `pong from ${name}` });
    },
  });
  server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), () => {
    console.log(`[gRPC][${name}] listening on ${port}`);
    server.start();
  });
  return server;
}

function grpcPing(port, name) {
  const client = new pingProto.PingService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  client.Ping({ message: `ping from ${name}` }, (err, response) => {
    if (err) console.error(`[gRPC][${name}] error: ${err.message}`);
    else console.log(`[gRPC][${name}] reply: ${response.message}`);
  });
}

// ---------------------
// Main Demo Flow
// ---------------------
async function main() {
  // 1. HTTP
  const httpServer = startHttpServer(3001, 'InstanceA');
  setTimeout(() => httpPing('InstanceB', 3001, 'InstanceB'), 500);

  // 2. WebSocket
  const wsServer = startWsServer(3002, 'InstanceA');
  setTimeout(() => wsPing('InstanceB', 3002, 'InstanceB'), 500);

  // 3. Redis
  const redisSub = startRedisSubscriber(6379, 'InstanceA');
  setTimeout(() => redisPing(6379, 'InstanceB'), 500);

  // 4. ZeroMQ
  startZmqServer(3003, 'InstanceA');
  setTimeout(() => zmqPing(3003, 'InstanceB'), 500);

  // 5. gRPC
  startGrpcServer(3004, 'InstanceA');
  setTimeout(() => grpcPing(3004, 'InstanceB'), 500);

  // Graceful shutdown after demo
  setTimeout(() => {
    httpServer.close();
    wsServer.close();
    redisSub.quit();
    console.log('Demo finished.');
    process.exit(0);
  }, 5000);
}

main();