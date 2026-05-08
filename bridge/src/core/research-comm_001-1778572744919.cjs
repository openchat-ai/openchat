// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:59:04.919Z

/**
 * 研究实例间通讯方式（除 HTTP ping 之外）
 * 目标：尝试几种常见的跨进程/跨机器通讯手段，
 *      判断在本机（127.0.0.1）是否能成功建立连接或发送/接收数据。
 *
 * 方法：
 *  1. TCP Socket（主动连接并发送“ping”）
 *  2. UDP Socket（广播/多播发送“ping”，并尝试接收）
 *  3. Redis Pub/Sub（如果本地已安装 Redis，尝试发布/订阅）
 *  4. gRPC（使用 @grpc/grpc-js 与 grpc-tools 定义一个简单服务）
 *  5. WebSocket（使用 ws 模块，尝试连接到本地 WebSocket 服务器）
 *  6. ZeroMQ（使用 zeromq 模块，尝试连接 PUB/SUB）
 *
 * 运行前请确保已安装所需 npm 包：
 *   npm install ws zeromq redis @grpc/grpc-js @grpc/proto-loader
 *
 * 代码会在 0~5 秒内完成各项检测，并打印结果。
 */

const net = require('net');
const dgram = require('dgram');
const { promisify } = require('util');
const redis = require('redis');
const WebSocket = require('ws');
const zmq = require('zeromq');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const fs = require('fs');
const path = require('path');

// ---------- 1. TCP Ping ----------
async function tcpPing(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = 'timeout';
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      status = 'connected';
      socket.end();
    }).on('timeout', () => {
      socket.destroy();
    }).on('error', () => {
      // ignore errors
    }).on('close', () => {
      resolve(status);
    });
    socket.connect(port, host);
  });
}

// ---------- 2. UDP Ping ----------
async function udpPing(host, port, message = 'PING', timeout = 2000) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    let received = false;
    client.on('message', (msg) => {
      if (msg.toString() === message) {
        received = true;
        client.close();
      }
    });
    client.send(Buffer.from(message), port, host, (err) => {
      if (err) {
        client.close();
        return resolve(false);
      }
    });
    setTimeout(() => {
      client.close();
      resolve(received);
    }, timeout);
  });
}

// ---------- 3. Redis Pub/Sub ----------
async function redisPing() {
  try {
    const client = redis.createClient();
    await client.connect();
    const pub = client.duplicate();
    const sub = client.duplicate();
    await sub.connect();
    await pub.connect();

    const channel = 'ping-channel';
    const reply = new Promise((res) => {
      sub.subscribe(channel, (msg) => {
        if (msg === 'PING') res(true);
      });
    });

    await pub.publish(channel, 'PING');
    const success = await reply;
    await client.quit();
    return success;
  } catch (e) {
    return false;
  }
}

// ---------- 4. gRPC ----------
async function grpcPing() {
  // Define a minimal proto in memory
  const protoPath = path.join(__dirname, 'ping.proto');
  const protoContent = `
    syntax = "proto3";
    package ping;
    service PingService {
      rpc Ping (PingRequest) returns (PingResponse);
    }
    message PingRequest {}
    message PingResponse {
      string message = 1;
    }
  `;
  fs.writeFileSync(protoPath, protoContent);

  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    arrays: true,
  });
  const pingProto = grpc.loadPackageDefinition(packageDefinition).ping;

  // Server
  const server = new grpc.Server();
  server.addService(pingProto.PingService.service, {
    Ping: (call, callback) => {
      callback(null, { message: 'PONG' });
    },
  });
  const address = '127.0.0.1:50051';
  server.bindAsync(address, grpc.ServerCredentials.createInsecure(), () => {
    server.start();
  });

  // Client
  const client = new pingProto.PingService(
    address,
    grpc.credentials.createInsecure()
  );

  const ping = promisify(client.Ping.bind(client));
  try {
    const res = await ping({});
    server.forceShutdown();
    return res.message === 'PONG';
  } catch (e) {
    server.forceShutdown();
    return false;
  }
}

// ---------- 5. WebSocket ----------
async function websocketPing() {
  // Simple server
  const wss = new WebSocket.Server({ port: 8080 });
  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      if (msg === 'PING') ws.send('PONG');
    });
  });

  // Client
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:8080');
    ws.on('open', () => {
      ws.send('PING');
    });
    ws.on('message', (msg) => {
      if (msg === 'PONG') {
        ws.close();
        wss.close();
        resolve(true);
      }
    });
    ws.on('error', () => {
      wss.close();
      resolve(false);
    });
  });
}

// ---------- 6. ZeroMQ ----------
async function zmqPing() {
  try {
    const sub = new zmq.Subscriber();
    const pub = new zmq.Publisher();

    await sub.connect('tcp://127.0.0.1:5560');
    await pub.bind('tcp://127.0.0.1:5560');

    sub.subscribe('PING');

    const send = async () => {
      await pub.send(['PING', 'PING']);
    };

    const receive = async () => {
      const [topic, msg] = await sub.receive();
      return msg.toString() === 'PING';
    };

    await send();
    const success = await receive();
    await sub.close();
    await pub.close();
    return success;
  } catch (e) {
    return false;
  }
}

// ---------- 主流程 ----------
(async () => {
  console.log('=== 开始实例间通讯方式研究 ===');

  const tcpResult = await tcpPing('127.0.0.1', 80); // 假设 HTTP 端口 80
  console.log(`TCP (port 80) 连接状态: ${tcpResult}`);

  const udpResult = await udpPing('127.0.0.1', 41234);
  console.log(`UDP (port 41234) 收到 PING: ${udpResult}`);

  const redisResult = await redisPing();
  console.log(`Redis Pub/Sub 成功: ${redisResult}`);

  const grpcResult = await grpcPing();
  console.log(`gRPC Ping/Pong 成功: ${grpcResult}`);

  const wsResult = await websocketPing();
  console.log(`WebSocket Ping/Pong 成功: ${wsResult}`);

  const zmqResult = await zmqPing();
  console.log(`ZeroMQ Ping/Pong 成功: ${zmqResult}`);

  console.log('=== 研究结束 ===');
})();