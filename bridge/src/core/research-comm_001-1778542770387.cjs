// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:39:30.387Z

// filename: instance-communication-demo.js
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const Redis = require('ioredis');

// -------------------- 配置 --------------------
const CONFIG = {
  TCP_PORT: 4000,
  UDP_PORT: 4001,
  WS_PORT: 4002,
  REDIS_CHANNEL: 'sister_status',
  REDIS_TIMEOUT_MS: 2000,
};

// -------------------- 1. TCP Socket --------------------
function startTcpServer() {
  const server = net.createServer((socket) => {
    socket.write('OK');
    socket.end();
  });
  server.listen(CONFIG.TCP_PORT, () => {
    console.log(`[TCP] Server listening on port ${CONFIG.TCP_PORT}`);
  });
  return server;
}
function checkTcpStatus() {
  return new Promise((resolve) => {
    const client = net.createConnection({ port: CONFIG.TCP_PORT }, () => {
      // 连接成功
    });
    client.setTimeout(1000);
    client.on('data', (data) => {
      resolve(`TCP: ${data.toString()}`);
      client.destroy();
    });
    client.on('error', (err) => {
      resolve(`TCP: error (${err.message})`);
    });
    client.on('timeout', () => {
      resolve('TCP: timeout');
      client.destroy();
    });
  });
}

// -------------------- 2. UDP Ping --------------------
function startUdpServer() {
  const server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    // 收到 ping，回一个 pong
    const response = Buffer.from('PONG');
    server.send(response, rinfo.port, rinfo.address);
  });
  server.bind(CONFIG.UDP_PORT, () => {
    console.log(`[UDP] Server listening on port ${CONFIG.UDP_PORT}`);
  });
  return server;
}
function checkUdpStatus() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('PING');
    client.send(message, CONFIG.UDP_PORT, '127.0.0.1', (err) => {
      if (err) {
        resolve(`UDP: send error (${err.message})`);
        client.close();
        return;
      }
    });
    client.once('message', (msg) => {
      resolve(`UDP: ${msg.toString()}`);
      client.close();
    });
    setTimeout(() => {
      resolve('UDP: timeout');
      client.close();
    }, 1000);
  });
}

// -------------------- 3. WebSocket --------------------
function startWsServer() {
  const wss = new WebSocket.Server({ port: CONFIG.WS_PORT });
  wss.on('connection', (ws) => {
    ws.send('HELLO');
  });
  console.log(`[WebSocket] Server listening on port ${CONFIG.WS_PORT}`);
  return wss;
}
function checkWsStatus() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${CONFIG.WS_PORT}`);
    const timeout = setTimeout(() => {
      resolve('WebSocket: timeout');
      ws.terminate();
    }, 1500);
    ws.on('open', () => {
      // 连接成功后等待服务器消息
    });
    ws.on('message', (msg) => {
      clearTimeout(timeout);
      resolve(`WebSocket: ${msg}`);
      ws.close();
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      resolve(`WebSocket: error (${err.message})`);
    });
  });
}

// -------------------- 4. Redis Pub/Sub --------------------
function startRedisSubscriber() {
  const sub = new Redis();
  sub.subscribe(CONFIG.REDIS_CHANNEL, (err, count) => {
    if (err) {
      console.error('Redis subscribe error:', err);
      return;
    }
    console.log(`[Redis] Subscribed to ${CONFIG.REDIS_CHANNEL}`);
  });
  sub.on('message', (channel, message) => {
    // 这里仅作演示，实际业务可在此处理状态信息
    console.log(`[Redis] Received on ${channel}: ${message}`);
  });
  return sub;
}
function checkRedisStatus() {
  return new Promise((resolve) => {
    const pub = new Redis();
    const replyChannel = `${CONFIG.REDIS_CHANNEL}_reply_${Date.now()}`;
    const timeout = setTimeout(() => {
      resolve('Redis: timeout (no reply)');
      pub.disconnect();
    }, CONFIG.REDIS_TIMEOUT_MS);

    // 订阅临时回复通道
    const sub = new Redis();
    sub.subscribe(replyChannel, (err) => {
      if (err) {
        clearTimeout(timeout);
        resolve(`Redis: subscribe error (${err.message})`);
        sub.disconnect();
        pub.disconnect();
        return;
      }
      // 发送心跳请求
      const payload = JSON.stringify({ cmd: 'ping', replyTo: replyChannel });
      pub.publish(CONFIG.REDIS_CHANNEL, payload);
    });

    sub.on('message', (chan, msg) => {
      if (chan === replyChannel) {
        clearTimeout(timeout);
        resolve(`Redis: reply -> ${msg}`);
        sub.disconnect();
        pub.disconnect();
      }
    });
  });
}

// -------------------- 主流程 --------------------
async function main() {
  // 启动各类服务器
  const tcpSrv = startTcpServer();
  const udpSrv = startUdpServer();
  const wsSrv = startWsServer();
  const redisSub = startRedisSubscriber();

  // 稍作等待，确保服务器已就绪
  await new Promise((r) => setTimeout(r, 500));

  // 逐一检测
  const results = await Promise.all([
    checkTcpStatus(),
    checkUdpStatus(),
    checkWsStatus(),
    checkRedisStatus(),
  ]);

  console.log('\n=== 实例间状态检测结果 ===');
  results.forEach((r) => console.log(r));

  // 关闭资源（演示结束后退出进程）
  tcpSrv.close();
  udpSrv.close();
  wsSrv.close();
  redisSub.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});