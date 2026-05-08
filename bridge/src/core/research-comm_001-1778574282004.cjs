// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:24:42.004Z

// filename: instance-communication-demo.js
// ---------------------------------------------------------------
// 研究：除了 HTTP ping，还有哪些方式可以检测姐妹实例状态？
// ---------------------------------------------------------------

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const Redis = require('ioredis');

// ------------------- 配置 -------------------
const config = {
  // 实例 A
  A: {
    name: 'InstanceA',
    tcpPort: 4001,
    udpPort: 5001,
    wsPort: 6001,
  },
  // 实例 B
  B: {
    name: 'InstanceB',
    tcpPort: 4002,
    udpPort: 5002,
    wsPort: 6002,
  },
  // Redis（可选）
  redis: {
    host: '127.0.0.1',
    port: 6379,
    channel: 'heartbeat',
  },
  timeout: 2000, // ms
};

// ------------------- 工具函数 -------------------
function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// ------------------- 实例实现 -------------------
// 每个实例同时启动 TCP、UDP、WebSocket 服务
function startInstance(id, cfg) {
  // ---- TCP ----
  const tcpServer = net.createServer((socket) => {
    socket.write('OK');
    socket.end();
  });
  tcpServer.listen(cfg.tcpPort, () => {
    console.log(`[${cfg.name}] TCP server listening on port ${cfg.tcpPort}`);
  });

  // ---- UDP ----
  const udpServer = dgram.createSocket('udp4');
  udpServer.on('message', (msg, rinfo) => {
    // 收到 ping，直接回 pong
    const response = Buffer.from('PONG');
    udpServer.send(response, rinfo.port, rinfo.address);
  });
  udpServer.bind(cfg.udpPort, () => {
    console.log(`[${cfg.name}] UDP server listening on port ${cfg.udpPort}`);
  });

  // ---- WebSocket ----
  const wss = new WebSocket.Server({ port: cfg.wsPort });
  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      if (msg === 'ping') ws.send('pong');
    });
  });
  wss.on('listening', () => {
    console.log(`[${cfg.name}] WebSocket server listening on port ${cfg.wsPort}`);
  });
}

// ------------------- 检测实现 -------------------
// 1. TCP 检测
function checkTcp(target) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: target.tcpPort }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(config.timeout, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

// 2. UDP 检测（发送 ping，等待 pong）
function checkUdp(target) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('PING');
    let responded = false;

    const timeout = setTimeout(() => {
      client.close();
      resolve(false);
    }, config.timeout);

    client.on('message', (msg) => {
      if (msg.toString() === 'PONG') {
        responded = true;
        clearTimeout(timeout);
        client.close();
        resolve(true);
      }
    });

    client.send(message, target.udpPort, '127.0.0.1', (err) => {
      if (err) {
        clearTimeout(timeout);
        client.close();
        resolve(false);
      }
    });
  });
}

// 3. WebSocket 检测（发送 ping，等待 pong）
function checkWs(target) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${target.wsPort}`);

    const timer = setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, config.timeout);

    ws.on('open', () => {
      ws.send('ping');
    });

    ws.on('message', (msg) => {
      if (msg === 'pong') {
        clearTimeout(timer);
        ws.terminate();
        resolve(true);
      }
    });

    ws.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// 4. Redis Pub/Sub 心跳（发布后等待同一实例的回显）
async function checkRedisHeartbeat() {
  try {
    const pub = new Redis(config.redis);
    const sub = new Redis(config.redis);

    return new Promise((resolve) => {
      const id = `hb-${Date.now()}`;
      const timeout = setTimeout(() => {
        sub.disconnect();
        pub.disconnect();
        resolve(false);
      }, config.timeout);

      sub.subscribe(config.redis.channel, (err, count) => {
        if (err) {
          clearTimeout(timeout);
          resolve(false);
        }
      });

      sub.on('message', (channel, message) => {
        if (channel === config.redis.channel && message === id) {
          clearTimeout(timeout);
          sub.disconnect();
          pub.disconnect();
          resolve(true);
        }
      });

      // 发布唯一标识
      pub.publish(config.redis.channel, id);
    });
  } catch (e) {
    console.log('Redis 检测异常（可能未启动 Redis 实例）:', e.message);
    return false;
  }
}

// ------------------- 主流程 -------------------
async function main() {
  // 启动两个实例
  startInstance('A', config.A);
  startInstance('B', config.B);

  // 给服务器一点时间完成监听
  await delay(500);

  console.log('\n=== 开始进行姐妹实例状态检测 ===\n');

  // A 检测 B
  const results = await Promise.all([
    checkTcp(config.B).then((ok) => ['TCP', ok]),
    checkUdp(config.B).then((ok) => ['UDP', ok]),
    checkWs(config.B).then((ok) => ['WebSocket', ok]),
    checkRedisHeartbeat().then((ok) => ['Redis Pub/Sub', ok]),
  ]);

  results.forEach(([method, ok]) => {
    console.log(`A → B via ${method}: ${ok ? '✔️ alive' : '❌ unreachable'}`);
  });

  console.log('\n（同理，B 也可以使用相同函数检测 A）');
}

// 直接执行
main().catch((err) => console.error('运行时错误:', err));