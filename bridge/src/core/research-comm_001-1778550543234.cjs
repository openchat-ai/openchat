// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:49:03.234Z

/**
 * 例子：探测同类实例的可达性
 * 1. HTTP Ping (已知做法，演示用)
 * 2. TCP 端口扫描
 * 3. UDP 简单探测
 * 4. Redis Pub/Sub 通信
 * 5. ZeroMQ REQ‑REP
 * 6. gRPC 健康检查（可选）
 *
 * 运行方法：
 *   node instance-check.js
 *
 * 需要的 npm 包：
 *   npm i redis zeromq @grpc/grpc-js @grpc/proto-loader
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const redis = require('redis');
const zmq = require('zeromq');
const { grpc } = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// -------------------------------
// 1. HTTP Ping（演示用）
function httpPing(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve({ ok: true, statusCode: res.statusCode });
    });
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ ok: false, timeout: true });
    });
  });
}

// -------------------------------
// 2. TCP 端口扫描
function tcpPing(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = false; // 未连通

    socket.setTimeout(2000);
    socket.on('connect', () => {
      status = true;
      socket.destroy();
    });
    socket.on('timeout', () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('close', () => resolve(status));

    socket.connect(port, host);
  });
}

// -------------------------------
// 3. UDP 简单探测
function udpPing(host, port, message = 'ping') {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    let received = false;

    client.on('message', () => {
      received = true;
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
    }, 2000); // 2 秒等待回应
  });
}

// -------------------------------
// 4. Redis Pub/Sub
async function redisPing(host = '127.0.0.1', port = 6379) {
  const client = redis.createClient({ url: `redis://${host}:${port}` });

  try {
    await client.connect();
    const ping = await client.ping();
    await client.disconnect();
    return ping === 'PONG';
  } catch (err) {
    return false;
  }
}

// -------------------------------
// 5. ZeroMQ REQ‑REP
async function zmqPing(address = 'tcp://127.0.0.1:5555') {
  const sock = new zmq.Request();

  try {
    await sock.connect(address);
    await sock.send('ping');
    const [result] = await sock.receive();
    return result.toString() === 'pong';
  } catch (err) {
    return false;
  } finally {
    await sock.disconnect(address);
  }
}

// -------------------------------
// 6. gRPC 健康检查（可选）
async function grpcHealthCheck(protoPath, host = '127.0.0.1', port = 50051) {
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
  const health = new protoDescriptor.grpc.health.v1.Health(
    `${host}:${port}`,
    grpc.credentials.createInsecure()
  );

  return new Promise((resolve) => {
    health.check({ service: '' }, (err, response) => {
      resolve(!err && response && response.status === 'SERVING');
    });
  });
}

// -------------------------------
// 主程序
(async () => {
  console.log('--- 同类实例可达性检测（除 HTTP Ping 外）---\n');

  // 1. HTTP Ping（仅演示）
  const httpResult = await httpPing('http://127.0.0.1:8080/health');
  console.log(`[HTTP] 127.0.0.1:8080 -> ${httpResult.ok ? 'OK' : 'FAIL'}${httpResult.timeout ? ' (timeout)' : ''}${httpResult.statusCode ? ' (code: ' + httpResult.statusCode + ')' : ''}`);

  // 2. TCP
  const tcpResult = await tcpPing('127.0.0.1', 9090);
  console.log(`[TCP] 127.0.0.1:9090 -> ${tcpResult ? 'OK' : 'FAIL'}`);

  // 3. UDP
  const udpResult = await udpPing('127.0.0.1', 7070);
  console.log(`[UDP] 127.0.0.1:7070 -> ${udpResult ? 'OK' : 'FAIL'}`);

  // 4. Redis
  const redisResult = await redisPing();
  console.log(`[Redis] 127.0.0.1:6379 -> ${redisResult ? 'OK' : 'FAIL'}`);

  // 5. ZeroMQ
  const zmqResult = await zmqPing();
  console.log(`[ZeroMQ] tcp://127.0.0.1:5555 -> ${zmqResult ? 'OK' : 'FAIL'}`);

  // 6. gRPC（可选）
  // 需要在同一目录下放置 health.proto，内容示例：
  //   syntax = "proto3";
  //   package grpc.health.v1;
  //   service Health {
  //     rpc Check (HealthCheckRequest) returns (HealthCheckResponse);
  //   }
  //   message HealthCheckRequest { string service = 1; }
  //   message HealthCheckResponse { enum ServingStatus { UNKNOWN = 0; SERVING = 1; NOT_SERVING = 2; } ServingStatus status = 1; }
  const grpcProtoPath = './health.proto';
  const grpcResult = await grpcHealthCheck(grpcProtoPath);
  console.log(`[gRPC] 127.0.0.1:50051 -> ${grpcResult ? 'OK' : 'FAIL'}`);

  console.log('\n--- 检测完成 ---');
})();