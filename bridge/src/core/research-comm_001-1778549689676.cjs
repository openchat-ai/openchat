// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:34:49.676Z

// file: check_sisters.js
// 运行方式：node check_sisters.js
// 依赖：npm i redis zeromq (可选)

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const { fork } = require('child_process');
const redis = require('redis');
let zmq;
try {
  zmq = require('zeromq');
} catch (e) {
  // ZeroMQ 不是必装的，只是演示用
}

// ------------------- 配置 -------------------
const HOST = '127.0.0.1';
const HTTP_PORT = 3000;
const TCP_PORT = 3001;
const UDP_PORT = 3002;
const IPC_SCRIPT = __filename; // 同文件会 fork 成子进程演示 IPC
const REDIS_URL = 'redis://127.0.0.1:6379';
const ZMQ_PORT = 3003;

// ------------------- 1. HTTP Ping（对照） -------------------
function httpPing() {
  return new Promise((resolve) => {
    const req = http.get(`http://${HOST}:${HTTP_PORT}/ping`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.abort();
      resolve(false);
    });
  });
}

// ------------------- 2. TCP Socket Ping -------------------
function tcpPing() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port: TCP_PORT }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// ------------------- 3. UDP Ping -------------------
function udpPing() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const msg = Buffer.from('ping');
    client.send(msg, UDP_PORT, HOST, (err) => {
      if (err) {
        client.close();
        return resolve(false);
      }
    });

    client.on('message', (msg) => {
      if (msg.toString() === 'pong') {
        client.close();
        resolve(true);
      }
    });

    client.on('error', () => {
      client.close();
      resolve(false);
    });

    setTimeout(() => {
      client.close();
      resolve(false);
    }, 1000);
  });
}

// ------------------- 4. IPC (fork + process.send) -------------------
function ipcPing() {
  return new Promise((resolve) => {
    const child = fork(IPC_SCRIPT, ['--child']);
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 1500);

    child.on('message', (msg) => {
      if (msg === 'alive') {
        clearTimeout(timer);
        child.kill();
        resolve(true);
      }
    });
  });
}

// ------------------- 5. Redis Pub/Sub -------------------
async function redisPing() {
  const publisher = redis.createClient({ url: REDIS_URL });
  const subscriber = redis.createClient({ url: REDIS_URL });

  await publisher.connect();
  await subscriber.connect();

  const CHANNEL = 'sister:heartbeat';

  return new Promise(async (resolve) => {
    const timer = setTimeout(async () => {
      await publisher.quit();
      await subscriber.quit();
      resolve(false);
    }, 1500);

    await subscriber.subscribe(CHANNEL, (msg) => {
      if (msg === 'pong') {
        clearTimeout(timer);
        subscriber.unsubscribe(CHANNEL).then(() => {
          publisher.quit();
          subscriber.quit();
          resolve(true);
        });
      }
    });

    // 发送 ping
    await publisher.publish(CHANNEL, 'ping');
  });
}

// ------------------- 6. ZeroMQ REQ/REP (可选) -------------------
async function zmqPing() {
  if (!zmq) return false; // 没装库则直接返回 false
  const sock = new zmq.Request();

  try {
    await sock.connect(`tcp://${HOST}:${ZMQ_PORT}`);
    await sock.send('ping');

    const [reply] = await sock.receive();
    return reply.toString() === 'pong';
  } catch (e) {
    return false;
  } finally {
    await sock.close();
  }
}

// ------------------- 主体：启动模拟服务 -------------------
function startMockServers() {
  // 1) HTTP
  http.createServer((req, res) => {
    if (req.url === '/ping') {
      res.writeHead(200);
      res.end('ok');
    } else {
      res.writeHead(404);
      res.end();
    }
  }).listen(HTTP_PORT, HOST);

  // 2) TCP
  net.createServer((socket) => {
    socket.end();
  }).listen(TCP_PORT, HOST);

  // 3) UDP
  const udpSrv = dgram.createSocket('udp4');
  udpSrv.on('message', (msg, rinfo) => {
    if (msg.toString() === 'ping') {
      udpSrv.send('pong', rinfo.port, rinfo.address);
    }
  });
  udpSrv.bind(UDP_PORT, HOST);

  // 4) IPC 子进程逻辑（当本文件以 --child 参数启动时执行）
  if (process.argv.includes('--child')) {
    // 子进程只负责接收父进程的 ping 并回报 alive
    process.on('message', (msg) => {
      if (msg === 'ping') {
        process.send('alive');
      }
    });
    // 为了防止子进程立即退出，保持一个空定时器
    setInterval(() => {}, 1000);
    return; // 子进程不继续往下执行
  }

  // 5) Redis 心跳响应
  const sub = redis.createClient({ url: REDIS_URL });
  const pub = redis.createClient({ url: REDIS_URL });
  (async () => {
    await sub.connect();
    await pub.connect();
    const CHANNEL = 'sister:heartbeat';
    await sub.subscribe(CHANNEL, async (msg) => {
      if (msg === 'ping') {
        await pub.publish(CHANNEL, 'pong');
      }
    });
  })();

  // 6) ZeroMQ REP
  if (zmq) {
    (async () => {
      const rep = new zmq.Reply();
      await rep.bind(`tcp://${HOST}:${ZMQ_PORT}`);
      for await (const [msg] of rep) {
        if (msg.toString() === 'ping') {
          await rep.send('pong');
        }
      }
    })();
  }
}

// ------------------- 执行检查并打印结果 -------------------
async function runChecks() {
  startMockServers(); // 先把模拟服务跑起来

  // 等待服务启动（简易延迟）
  await new Promise((r) => setTimeout(r, 500));

  const results = await Promise.all([
    httpPing(),
    tcpPing(),
    udpPing(),
    ipcPing(),
    redisPing(),
    zmqPing(),
  ]);

  console.log('=== 姐妹实例状态检测结果 ===');
  console.log(`1. HTTP Ping          : ${results[0] ? 'OK' : 'FAIL'}`);
  console.log(`2. TCP Socket Ping    : ${results[1] ? 'OK' : 'FAIL'}`);
  console.log(`3. UDP Ping           : ${results[2] ? 'OK' : 'FAIL'}`);
  console.log(`4. IPC (fork) Ping    : ${results[3] ? 'OK' : 'FAIL'}`);
  console.log(`5. Redis Pub/Sub Ping: ${results[4] ? 'OK' : 'FAIL'}`);
  console.log(`6. ZeroMQ REQ/REP Ping: ${results[5] ? 'OK' : 'FAIL'}`);
  console.log('===============================');
  process.exit(0);
}

runChecks();