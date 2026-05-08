// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:33:54.188Z

// file: sister-status-check.js
// 运行方式：node sister-status-check.js

// 1️⃣ 依赖 --------------------------------------------------------------
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const redis = require('redis');
const zmq = require('zeromq');

// 2️⃣ 配置 --------------------------------------------------------------
const PORT = 4000;
const HOST = '127.0.0.1';

// 简单的心跳消息
const HEARTBEAT = 'heartbeat';

// 3️⃣ 工具函数 ------------------------------------------------------------
function logResult(name, ok, err) {
  console.log(`[${name}] ${ok ? '✅ 端点可达' : '❌ 端点不可达'}${err ? ' - ' + err.message : ''}`);
}

// 4️⃣ 实现各类检查 ---------------------------------------------------------

// 4.1 TCP socket ---------------------------------------------------------
function checkTcp() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.once('data', (data) => {
        if (data.toString() === HEARTBEAT) {
          socket.write('ok');
        }
      });
    });
    server.listen(PORT, HOST, () => {
      const client = net.createConnection({ port: PORT, host: HOST }, () => {
        client.write(HEARTBEAT);
      });
      client.once('data', (data) => {
        client.end();
        server.close();
        resolve({ ok: data.toString() === 'ok' });
      });
      client.once('error', (err) => {
        server.close();
        resolve({ ok: false, err });
      });
    });
  });
}

// 4.2 UDP ---------------------------------------------------------------
function checkUdp() {
  return new Promise((resolve) => {
    const server = dgram.createSocket('udp4');
    server.on('message', (msg, rinfo) => {
      if (msg.toString() === HEARTBEAT) {
        server.send('ok', rinfo.port, rinfo.address);
      }
    });
    server.bind(PORT, HOST, () => {
      const client = dgram.createSocket('udp4');
      client.send(HEARTBEAT, PORT, HOST);
      client.once('message', (msg) => {
        client.close();
        server.close();
        resolve({ ok: msg.toString() === 'ok' });
      });
      client.once('error', (err) => {
        client.close();
        server.close();
        resolve({ ok: false, err });
      });
    });
  });
}

// 4.3 WebSocket ---------------------------------------------------------
function checkWebSocket() {
  return new Promise((resolve) => {
    const wss = new WebSocket.Server({ port: PORT }, () => {
      const ws = new WebSocket(`ws://${HOST}:${PORT}`);
      ws.on('open', () => ws.send(HEARTBEAT));
      ws.on('message', (msg) => {
        ws.close();
        wss.close();
        resolve({ ok: msg === 'ok' });
      });
      ws.on('error', (err) => {
        wss.close();
        resolve({ ok: false, err });
      });
    });
    wss.on('connection', (socket) => {
      socket.once('message', (msg) => {
        if (msg === HEARTBEAT) socket.send('ok');
      });
    });
  });
}

// 4.4 gRPC --------------------------------------------------------------
const PROTO_PATH = __dirname + '/heartbeat.proto';
/*
   // heartbeat.proto 内容（放在同目录下）
   syntax = "proto3";
   package hb;
   service Heartbeat {
     rpc Ping(Empty) returns (Pong);
   }
   message Empty {}
   message Pong { string msg = 1; }
*/
function checkGrpc() {
  return new Promise((resolve) => {
    // 加载 proto
    const packageDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const hbProto = grpc.loadPackageDefinition(packageDef).hb;

    // 服务端实现
    const server = new grpc.Server();
    server.addService(hbProto.Heartbeat.service, {
      Ping: (_, callback) => callback(null, { msg: 'ok' }),
    });
    server.bindAsync(`${HOST}:${PORT}`, grpc.ServerCredentials.createInsecure(), () => {
      server.start();

      // 客户端调用
      const client = new hbProto.Heartbeat(`${HOST}:${PORT}`, grpc.credentials.createInsecure());
      client.Ping({}, (err, response) => {
        server.forceShutdown();
        resolve({ ok: !err && response.msg === 'ok', err });
      });
    });
  });
}

// 4.5 Redis Pub/Sub ----------------------------------------------------
function checkRedis() {
  return new Promise((resolve) => {
    const pub = redis.createClient();
    const sub = redis.createClient();

    sub.on('error', (e) => resolve({ ok: false, err: e }));
    pub.on('error', (e) => resolve({ ok: false, err: e }));

    sub.subscribe('hb-channel', () => {
      // 收到心跳后回复
      sub.once('message', (channel, message) => {
        if (message === HEARTBEAT) {
          pub.publish('hb-reply', 'ok');
        }
      });
    });

    // 监听回复
    const replySub = redis.createClient();
    replySub.subscribe('hb-reply', () => {
      replySub.once('message', (ch, msg) => {
        // 清理
        pub.quit();
        sub.quit();
        replySub.quit();
        resolve({ ok: msg === 'ok' });
      });
    });

    // 发送心跳
    pub.publish('hb-channel', HEARTBEAT);
  });
}

// 4.6 ZeroMQ (REQ/REP) -------------------------------------------------
function checkZmq() {
  return new Promise(async (resolve) => {
    const rep = new zmq.Reply();
    const req = new zmq.Request();

    await rep.bind(`tcp://${HOST}:${PORT}`);
    await req.connect(`tcp://${HOST}:${PORT}`);

    // 服务器端监听
    (async () => {
      for await (const [msg] of rep) {
        if (msg.toString() === HEARTBEAT) {
          await rep.send('ok');
          break;
        }
      }
    })();

    // 客户端发送
    await req.send(HEARTBEAT);
    const [reply] = await req.receive();

    // 关闭
    rep.close();
    req.close();

    resolve({ ok: reply.toString() === 'ok' });
  });
}

// 5️⃣ 主流程 -------------------------------------------------------------
async function main() {
  console.log('--- 开始姐妹实例状态检测研究 ---\n');

  const checks = [
    { name: 'TCP Socket', fn: checkTcp },
    { name: 'UDP Datagram', fn: checkUdp },
    { name: 'WebSocket', fn: checkWebSocket },
    { name: 'gRPC', fn: checkGrpc },
    { name: 'Redis Pub/Sub', fn: checkRedis },
    { name: 'ZeroMQ REQ/REP', fn: checkZmq },
  ];

  for (const c of checks) {
    try {
      const { ok, err } = await c.fn();
      logResult(c.name, ok, err);
    } catch (e) {
      logResult(c.name, false, e);
    }
  }

  console.log('\n--- 检测结束 ---');
}

// 运行
main().catch((e) => console.error('主流程异常', e));