// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:47:52.979Z

// check_sisters.js
// ---------------------------------------------------
// 研究：除了 HTTP ping 之外，哪些方式可以检测姐妹实例状态？
// 实现：分别用以下几种协议/工具做“存活检测”
//   1. TCP socket (net)
//   2. UDP socket (dgram)
//   3. WebSocket (ws)
//   4. Redis Pub/Sub (redis)
//   5. ZeroMQ (zmq)
// ---------------------------------------------------

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const redis = require('redis');
const zmq = require('zeromq');

// ------------------- 配置 -------------------
const CONFIG = {
  tcp: {port: 4000, host: '127.0.0.1'},
  udp: {port: 4001, host: '127.0.0.1'},
  ws:  {port: 4002, host: '127.0.0.1'},
  redis: {channel: 'sister_heartbeat', host: '127.0.0.1', port: 6379},
  zmq: {port: 4003, host: '127.0.0.1'}
};

// ------------------- 1. TCP 心跳 -------------------
function startTcpServer() {
  const server = net.createServer(sock => {
    sock.on('data', data => {
      if (data.toString() === 'PING') sock.write('PONG');
    });
  });
  server.listen(CONFIG.tcp.port, CONFIG.tcp.host);
}
function checkTcpAlive() {
  return new Promise(resolve => {
    const client = net.createConnection(CONFIG.tcp, () => {
      client.write('PING');
    });
    client.setTimeout(1000, () => {
      client.destroy();
      resolve(false);
    });
    client.on('data', data => {
      client.end();
      resolve(data.toString() === 'PONG');
    });
    client.on('error', () => resolve(false));
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
  server.bind(CONFIG.udp.port, CONFIG.udp.host);
}
function checkUdpAlive() {
  return new Promise(resolve => {
    const client = dgram.createSocket('udp4');
    const timeout = setTimeout(() => {
      client.close();
      resolve(false);
    }, 1000);
    client.on('message', msg => {
      clearTimeout(timeout);
      client.close();
      resolve(msg.toString() === 'PONG');
    });
    client.send('PING', CONFIG.udp.port, CONFIG.udp.host);
  });
}

// ------------------- 3. WebSocket 心跳 -------------------
function startWsServer() {
  const wss = new WebSocket.Server({port: CONFIG.ws.port});
  wss.on('connection', ws => {
    ws.on('message', msg => {
      if (msg === 'PING') ws.send('PONG');
    });
  });
}
function checkWsAlive() {
  return new Promise(resolve => {
    const ws = new WebSocket(`ws://${CONFIG.ws.host}:${CONFIG.ws.port}`);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, 1200);
    ws.on('open', () => ws.send('PING'));
    ws.on('message', msg => {
      clearTimeout(timer);
      ws.close();
      resolve(msg === 'PONG');
    });
    ws.on('error', () => resolve(false));
  });
}

// ------------------- 4. Redis Pub/Sub 心跳 -------------------
// 这里使用 “发布者” 每秒广播一次心跳，订阅者检测最近一次是否在 2 秒内收到。
function startRedisPublisher() {
  const pub = redis.createClient({host: CONFIG.redis.host, port: CONFIG.redis.port});
  setInterval(() => pub.publish(CONFIG.redis.channel, Date.now()), 1000);
}
function checkRedisAlive() {
  return new Promise(resolve => {
    const sub = redis.createClient({host: CONFIG.redis.host, port: CONFIG.redis.port});
    let lastTs = null;
    const timer = setTimeout(() => {
      sub.unsubscribe();
      sub.quit();
      resolve(false);
    }, 2500);
    sub.subscribe(CONFIG.redis.channel);
    sub.on('message', (ch, msg) => {
      lastTs = Number(msg);
      if (Date.now() - lastTs <= 2000) {
        clearTimeout(timer);
        sub.unsubscribe();
        sub.quit();
        resolve(true);
      }
    });
    sub.on('error', () => resolve(false));
  });
}

// ------------------- 5. ZeroMQ 心跳 -------------------
function startZmqServer() {
  const rep = new zmq.Reply();
  (async () => {
    await rep.bind(`tcp://${CONFIG.zmq.host}:${CONFIG.zmq.port}`);
    for await (const [msg] of rep) {
      if (msg.toString() === 'PING') await rep.send('PONG');
    }
  })();
}
function checkZmqAlive() {
  return new Promise(async resolve => {
    const req = new zmq.Request();
    try {
      await req.connect(`tcp://${CONFIG.zmq.host}:${CONFIG.zmq.port}`);
      await req.send('PING');
      const [reply] = await Promise.race([
        req.receive(),
        new Promise(r => setTimeout(() => r(null), 1500))
      ]);
      resolve(reply && reply.toString() === 'PONG');
    } catch (e) {
      resolve(false);
    } finally {
      req.close();
    }
  });
}

// ------------------- 启动所有服务器 -------------------
function startAllServers() {
  startTcpServer();
  startUdpServer();
  startWsServer();
  startRedisPublisher();
  startZmqServer();
}

// ------------------- 主流程 -------------------
async function main() {
  console.log('=== 启动本地「姐妹」实例的检测服务 ===');
  startAllServers();

  // 给服务器一点启动时间
  await new Promise(r => setTimeout(r, 500));

  console.log('\n--- 开始检测 ---');
  const results = await Promise.all([
    checkTcpAlive(),
    checkUdpAlive(),
    checkWsAlive(),
    checkRedisAlive(),
    checkZmqAlive()
  ]);

  const methods = ['TCP', 'UDP', 'WebSocket', 'Redis Pub/Sub', 'ZeroMQ'];
  methods.forEach((m, i) => {
    console.log(`${m.padEnd(15)} : ${results[i] ? '✅ 在线' : '❌ 离线'}`);
  });

  console.log('\n结论：');
  console.log('除了最常见的 HTTP ping，TCP、UDP、WebSocket、Redis Pub/Sub、ZeroMQ 等都能用作“存活检测”。');
  console.log('选择依据：\n  • 网络环境（防火墙、代理）\n  • 延迟容忍度\n  • 是否已有消息队列/缓存中间件\n  • 实现复杂度');
  process.exit(0);
}

main().catch(err => {
  console.error('运行时错误：', err);
  process.exit(1);
});