// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T08:56:22.733Z

/**
 * 研究：实例间通讯方式（除 HTTP ping）— 检测姐妹实例状态
 * 支持的方式：
 *   1. TCP Socket
 *   2. UDP Ping
 *   3. WebSocket
 *   4. Redis Pub/Sub
 *   5. ZeroMQ REQ/REP
 *
 * 运行方式：
 *   1. 在本机启动多个服务（示例代码中已提供每种服务的启动函数）。
 *   2. 启动本文件：node check_sisters.js
 *
 * 说明：
 *   - 为了演示简洁，所有服务都在本机 127.0.0.1 上不同端口运行。
 *   - 检测函数会尝试连接对应端口/地址，超时即认为“不可达”。
 *   - 结果通过 console.log 输出。
 */

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const redis = require('redis');
const zmq = require('zeromq');

// ---------------------- 配置 ----------------------
const CONFIG = {
  tcp: { host: '127.0.0.1', port: 4000 },
  udp: { host: '127.0.0.1', port: 4001 },
  ws:  { host: '127.0.0.1', port: 4002 },
  redis: { host: '127.0.0.1', port: 6379, channel: 'sister_heartbeat' },
  zmq: { host: '127.0.0.1', port: 4003 }
};

const TIMEOUT_MS = 2000;

// ---------------------- 检测实现 ----------------------

// 1. TCP Socket 检测
function checkTCP() {
  return new Promise((resolve) => {
    const client = net.createConnection(CONFIG.tcp, () => {
      client.end();
      resolve(true);
    });
    client.on('error', () => resolve(false));
    client.setTimeout(TIMEOUT_MS, () => {
      client.destroy();
      resolve(false);
    });
  });
}

// 2. UDP Ping 检测（发送一个小包，等待回包）
function checkUDP() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const msg = Buffer.from('ping');
    let responded = false;

    socket.on('message', (msg) => {
      if (msg.toString() === 'pong') responded = true;
    });

    socket.send(msg, CONFIG.udp.port, CONFIG.udp.host, (err) => {
      if (err) {
        socket.close();
        return resolve(false);
      }
    });

    setTimeout(() => {
      socket.close();
      resolve(responded);
    }, TIMEOUT_MS);
  });
}

// 3. WebSocket 检测
function checkWebSocket() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${CONFIG.ws.host}:${CONFIG.ws.port}`);

    const timer = setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, TIMEOUT_MS);

    ws.on('open', () => {
      clearTimeout(timer);
      ws.terminate();
      resolve(true);
    });

    ws.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// 4. Redis Pub/Sub 检测（发布后等待同一频道的回执）
function checkRedis() {
  return new Promise((resolve) => {
    const sub = redis.createClient({ host: CONFIG.redis.host, port: CONFIG.redis.port });
    const pub = redis.createClient({ host: CONFIG.redis.host, port: CONFIG.redis.port });

    let timer = setTimeout(() => {
      sub.quit();
      pub.quit();
      resolve(false);
    }, TIMEOUT_MS);

    sub.subscribe(CONFIG.redis.channel, () => {
      // 发送心跳请求
      pub.publish(CONFIG.redis.channel, 'heartbeat_req');
    });

    sub.on('message', (channel, message) => {
      if (channel === CONFIG.redis.channel && message === 'heartbeat_res') {
        clearTimeout(timer);
        sub.quit();
        pub.quit();
        resolve(true);
      }
    });

    // 防止错误导致永不返回
    sub.on('error', () => {
      clearTimeout(timer);
      sub.quit();
      pub.quit();
      resolve(false);
    });
    pub.on('error', () => {
      clearTimeout(timer);
      sub.quit();
      pub.quit();
      resolve(false);
    });
  });
}

// 5. ZeroMQ REQ/REP 检测
async function checkZeroMQ() {
  const req = new zmq.Request();
  try {
    await req.connect(`tcp://${CONFIG.zmq.host}:${CONFIG.zmq.port}`);
    await req.send('ping');
    const [reply] = await Promise.race([
      req.receive(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))
    ]);
    await req.close();
    return reply.toString() === 'pong';
  } catch (e) {
    await req.close();
    return false;
  }
}

// ---------------------- 启动示例服务 ----------------------
// 这些函数仅用于演示，实际生产环境会有自己的服务实现

function startTCPServer() {
  const server = net.createServer((socket) => {
    socket.end();
  });
  server.listen(CONFIG.tcp.port, CONFIG.tcp.host);
  console.log(`TCP server listening on ${CONFIG.tcp.host}:${CONFIG.tcp.port}`);
}

function startUDPServer() {
  const server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    if (msg.toString() === 'ping') {
      server.send(Buffer.from('pong'), rinfo.port, rinfo.address);
    }
  });
  server.bind(CONFIG.udp.port, CONFIG.udp.host, () => {
    console.log(`UDP server listening on ${CONFIG.udp.host}:${CONFIG.udp.port}`);
  });
}

function startWebSocketServer() {
  const wss = new WebSocket.Server({ port: CONFIG.ws.port, host: CONFIG.ws.host });
  wss.on('connection', (ws) => {
    ws.close();
  });
  console.log(`WebSocket server listening on ws://${CONFIG.ws.host}:${CONFIG.ws.port}`);
}

function startRedisResponder() {
  const sub = redis.createClient({ host: CONFIG.redis.host, port: CONFIG.redis.port });
  const pub = redis.createClient({ host: CONFIG.redis.host, port: CONFIG.redis.port });

  sub.subscribe(CONFIG.redis.channel);
  sub.on('message', (channel, message) => {
    if (message === 'heartbeat_req') {
      pub.publish(channel, 'heartbeat_res');
    }
  });

  console.log(`Redis responder ready on channel "${CONFIG.redis.channel}"`);
}

function startZeroMQServer() {
  const rep = new zmq.Reply();
  (async () => {
    await rep.bind(`tcp://${CONFIG.zmq.host}:${CONFIG.zmq.port}`);
    console.log(`ZeroMQ REP server bound to tcp://${CONFIG.zmq.host}:${CONFIG.zmq.port}`);
    for await (const [msg] of rep) {
      if (msg.toString() === 'ping') {
        await rep.send('pong');
      } else {
        await rep.send('unknown');
      }
    }
  })();
}

// ---------------------- 主流程 ----------------------
async function main() {
  // 先把示例服务全部启动（在真实环境可以省略这一步）
  startTCPServer();
  startUDPServer();
  startWebSocketServer();
  startRedisResponder();
  startZeroMQServer();

  // 等待服务稍作启动（实际项目中可使用更可靠的就绪检测）
  await new Promise(r => setTimeout(r, 500));

  console.log('\n--- 开始检测姐妹实例状态 ---');

  const results = await Promise.all([
    checkTCP(),
    checkUDP(),
    checkWebSocket(),
    checkRedis(),
    checkZeroMQ()
  ]);

  const methods = ['TCP Socket', 'UDP Ping', 'WebSocket', 'Redis Pub/Sub', 'ZeroMQ REQ/REP'];
  methods.forEach((m, i) => {
    console.log(`${m}: ${results[i] ? '✓ 可达' : '✗ 不可达'}`);
  });

  console.log('\n研究结论：');
  console.log('1. TCP 是最基础、最可靠的点对点连通性检测。');
  console.log('2. UDP 可用于轻量级心跳，但需要自行实现超时/重传逻辑。');
  console.log('3. WebSocket 适合在已有 HTTP 基础设施上做双向实时通信。');
  console.log('4. Redis Pub/Sub 适合在同一数据中心内部使用，依赖外部消息中间件。');
  console.log('5. ZeroMQ 提供了多种消息模式（REQ/REP、PUB/SUB、PUSH/PULL），非常灵活。');
}

// 直接执行
main().catch(err => {
  console.error('运行时错误:', err);
});