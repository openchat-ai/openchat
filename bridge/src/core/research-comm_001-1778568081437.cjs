// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:41:21.437Z

// file: instance-health-check.js
// 运行方式：node instance-health-check.js

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const Redis = require('ioredis');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { promisify } = require('util');
const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

/**
 * 1. TCP 检测（尝试建立 TCP 连接后立即关闭）
 */
async function checkTcp(host, port, ms = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    socket.setTimeout(ms);
    socket.once('connect', () => {
      settled = true;
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
    socket.once('timeout', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.connect(port, host);
  });
}

/**
 * 2. UDP “ping”（发送一个空报文，等待任意响应）
 */
async function checkUdp(host, port, ms = 2000) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from(''); // 空报文

    const timer = setTimeout(() => {
      client.close();
      resolve(false);
    }, ms);

    client.once('message', () => {
      clearTimeout(timer);
      client.close();
      resolve(true);
    });

    client.send(message, 0, message.length, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        client.close();
        resolve(false);
      }
    });
  });
}

/**
 * 3. WebSocket 心跳（连接后发送 ping，等待 pong）
 */
async function checkWebSocket(url, ms = 3000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { handshakeTimeout: ms });

    const timer = setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, ms);

    ws.once('open', () => {
      // 发送协议层的 ping，等待 pong
      ws.ping();
    });

    ws.once('pong', () => {
      clearTimeout(timer);
      ws.terminate();
      resolve(true);
    });

    ws.once('error', () => {
      clearTimeout(timer);
      ws.terminate();
      resolve(false);
    });
  }).catch(() => false);
}

/**
 * 4. Redis PING
 */
async function checkRedis(options, ms = 2000) {
  const client = new Redis(options);
  const ping = promisify(client.ping).bind(client);
  try {
    const res = await Promise.race([ping(), timeout(ms)]);
    return res === 'PONG';
  } catch (e) {
    return false;
  } finally {
    client.disconnect();
  }
}

/**
 * 5. gRPC 健康检查（使用标准的 grpc.health.v1.Health 服务）
 *    需要提前准备好对应的 proto 文件（这里直接使用官方的 health.proto）。
 */
async function checkGrpc(address, ms = 3000) {
  // 加载官方 health.proto
  const packageDef = protoLoader.loadSync(
    // 这里使用内置的 proto；如果本地有自定义 proto，请改成相应路径
    require.resolve('@grpc/grpc-js/build/src/proto/grpc/health/v1/health.proto'),
    { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }
  );
  const healthProto = grpc.loadPackageDefinition(packageDef).grpc.health.v1;

  const client = new healthProto.Health(address, grpc.credentials.createInsecure());

  const check = () =>
    new Promise((resolve, reject) => {
      client.check({ service: '' }, (err, response) => {
        if (err) reject(err);
        else resolve(response.status === 'SERVING');
      });
    });

  try {
    const result = await Promise.race([check(), timeout(ms)]);
    return !!result;
  } catch (e) {
    return false;
  }
}

/**
 * 主函数：对同一台机器（或不同机器）上的多个端口/协议进行状态检测
 */
async function main() {
  const targets = {
    tcp: { host: '127.0.0.1', port: 3000 },
    udp: { host: '127.0.0.1', port: 4000 },
    ws:  { url: 'ws://127.0.0.1:5000' },
    redis: { host: '127.0.0.1', port: 6379 },
    grpc: { address: '127.0.0.1:6000' },
  };

  console.log('=== 开始实例间状态检测 ===');

  const results = await Promise.allSettled([
    checkTcp(targets.tcp.host, targets.tcp.port).then(r => ({method: 'TCP', ok: r})),
    checkUdp(targets.udp.host, targets.udp.port).then(r => ({method: 'UDP', ok: r})),
    checkWebSocket(targets.ws.url).then(r => ({method: 'WebSocket', ok: r})),
    checkRedis(targets.redis).then(r => ({method: 'Redis', ok: r})),
    checkGrpc(targets.grpc.address).then(r => ({method: 'gRPC', ok: r})),
  ]);

  results.forEach(res => {
    if (res.status === 'fulfilled') {
      const {method, ok} = res.value;
      console.log(`[${method}] 目标 ${method === 'WebSocket' ? targets.ws.url : method === 'Redis' ? `${targets.redis.host}:${targets.redis.port}` : method === 'gRPC' ? targets.grpc.address : `${targets[method.toLowerCase()].host}:${targets[method.toLowerCase()].port}`} => ${ok ? '可达 ✅' : '不可达 ❌'}`);
    } else {
      console.log(`[${res.reason}] 检测过程中出现异常`);
    }
  });

  console.log('=== 检测结束 ===');
}

main().catch(err => {
  console.error('运行时错误：', err);
});