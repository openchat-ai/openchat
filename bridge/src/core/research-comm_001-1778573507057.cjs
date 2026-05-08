// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:11:47.057Z

// file: instance_communication_demo.js
// ---------------------------------------------------------------
// 研究：除了 HTTP ping，还有哪些方式可以检测姐妹实例状态？
// ---------------------------------------------------------------

const net = require('net');          // TCP
const dgram = require('dgram');      // UDP
const WebSocket = require('ws');     // WebSocket (npm i ws)
const redis = require('redis');      // Redis Pub/Sub (npm i redis)

// ------------------- 配置 -------------------
const CONFIG = {
  tcpPort: 4000,
  udpPort: 4001,
  wsPort: 4002,
  redisChannel: 'instance_heartbeat',
  heartbeatInterval: 2000, // ms
  timeout: 3000,           // 检测超时
};

// ------------------- 工具函数 -------------------
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------- 1. TCP 心跳 -------------------
function startTcpServer() {
  const server = net.createServer((socket) => {
    socket.on('data', (buf) => {
      const msg = buf.toString();
      if (msg === 'PING') {
        socket.write('PONG');
      }
    });
  });

  server.listen(CONFIG.tcpPort, () => {
    console.log(`[TCP] Server listening on port ${CONFIG.tcpPort}`);
  });
  return server;
}

async function testTcpHeartbeat() {
  return new Promise((resolve) => {
    const client = new net.Socket();
    let responded = false;

    client.connect(CONFIG.tcpPort, '127.0.0.1', () => {
      client.write('PING');
    });

    client.on('data', (data) => {
      if (data.toString() === 'PONG') {
        responded = true;
        client.destroy();
        resolve(true);
      }
    });

    client.on('error', () => resolve(false));
    setTimeout(() => {
      if (!responded) {
        client.destroy();
        resolve(false);
      }
    }, CONFIG.timeout);
  });
}

// ------------------- 2. UDP 心跳 -------------------
function startUdpServer() {
  const server = dgram.createSocket('udp4');

  server.on('message', (msg, rinfo) => {
    if (msg.toString() === 'PING') {
      server.send('PONG', rinfo.port, rinfo.address);
    }
  });

  server.bind(CONFIG.udpPort, () => {
    console.log(`[UDP] Server bound to port ${CONFIG.udpPort}`);
  });
  return server;
}

async function testUdpHeartbeat() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    let responded = false;

    client.send('PING', CONFIG.udpPort, '127.0.0.1');

    client.on('message', (msg) => {
      if (msg.toString() === 'PONG') {
        responded = true;
        client.close();
        resolve(true);
      }
    });

    setTimeout(() => {
      if (!responded) {
        client.close();
        resolve(false);
      }
    }, CONFIG.timeout);
  });
}

// ------------------- 3. WebSocket 心跳 -------------------
function startWsServer() {
  const wss = new WebSocket.Server({ port: CONFIG.wsPort });
  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      if (msg === 'PING') ws.send('PONG');
    });
  });
  console.log(`[WebSocket] Server listening on ws://127.0.0.1:${CONFIG.wsPort}`);
  return wss;
}

async function testWsHeartbeat() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${CONFIG.wsPort}`);

    let responded = false;
    ws.on('open', () => ws.send('PING'));

    ws.on('message', (msg) => {
      if (msg === 'PONG') {
        responded = true;
        ws.terminate();
        resolve(true);
      }
    });

    ws.on('error', () => resolve(false));

    setTimeout(() => {
      if (!responded) {
        ws.terminate();
        resolve(false);
      }
    }, CONFIG.timeout);
  });
}

// ------------------- 4. Redis Pub/Sub 心跳 -------------------
function startRedisPublisher() {
  const pub = redis.createClient();
  const sub = redis.createClient();

  sub.subscribe(CONFIG.redisChannel);
  sub.on('message', (channel, message) => {
    if (message === 'PING') {
      pub.publish(CONFIG.redisChannel, 'PONG');
    }
  });

  console.log(`[Redis] Pub/Sub ready on channel "${CONFIG.redisChannel}"`);
  return { pub, sub };
}

async function testRedisHeartbeat() {
  return new Promise((resolve) => {
    const client = redis.createClient();
    let responded = false;

    client.subscribe(CONFIG.redisChannel);
    client.on('message', (channel, message) => {
      if (message === 'PONG') {
        responded = true;
        client.unsubscribe();
        client.quit();
        resolve(true);
      }
    });

    // 发送心跳
    client.publish(CONFIG.redisChannel, 'PING');

    setTimeout(() => {
      if (!responded) {
        client.unsubscribe();
        client.quit();
        resolve(false);
      }
    }, CONFIG.timeout);
  });
}

// ------------------- 主流程 -------------------
(async () => {
  console.log('=== 实例间通讯方式研究 ===\n');

  // 1. 启动所有服务
  const tcpSrv = startTcpServer();
  const udpSrv = startUdpServer();
  const wsSrv = startWsServer();
  const redisSrv = startRedisPublisher();

  // 给服务一点启动时间
  await delay(500);

  // 2. 依次检测
  const results = {
    TCP: await testTcpHeartbeat(),
    UDP: await testUdpHeartbeat(),
    WebSocket: await testWsHeartbeat(),
    RedisPubSub: await testRedisHeartbeat(),
  };

  // 3. 打印结果
  console.log('\n--- 检测结果（true 表示成功，false 表示超时/失败）---');
  for (const [method, ok] of Object.entries(results)) {
    console.log(`${method.padEnd(12)} : ${ok}`);
  }

  // 4. 关闭服务（优雅退出）
  tcpSrv.close();
  udpSrv.close();
  wsSrv.close();
  redisSrv.pub.quit();
  redisSrv.sub.quit();

  console.log('\n研究结束，所有临时服务已关闭。');
})();