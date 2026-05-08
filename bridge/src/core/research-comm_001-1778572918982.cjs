// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:01:58.983Z

// sibling-check.js
// Node.js (CommonJS) 示例 – 多种实例间状态检测方式
// 运行前请执行： npm i ws redis zeromq

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const redis = require('redis');
const zmq = require('zeromq');

// 统一的日志函数，方便后期统一格式
function log(tag, msg) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);
}

/* -------------------------------------------------
   1. TCP Socket
------------------------------------------------- */
function testTcp(callback) {
  const PORT = 4001;
  // --- 服务端 ---
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      if (data.toString() === 'PING') {
        socket.write('PONG');
      }
    });
  });

  server.listen(PORT, () => {
    // --- 客户端 ---
    const client = new net.Socket();
    client.setTimeout(2000);
    client.connect(PORT, '127.0.0.1', () => {
      client.write('PING');
    });

    client.on('data', (data) => {
      if (data.toString() === 'PONG') {
        log('TCP', '连接成功，收到 PONG');
      }
      cleanup();
    });

    client.on('timeout', () => {
      log('TCP', '连接超时');
      cleanup();
    });

    client.on('error', (err) => {
      log('TCP', `错误: ${err.message}`);
      cleanup();
    });

    function cleanup() {
      client.destroy();
      server.close();
      callback();
    }
  });
}

/* -------------------------------------------------
   2. UDP Socket
------------------------------------------------- */
function testUdp(callback) {
  const PORT = 4002;
  const server = dgram.createSocket('udp4');

  server.on('message', (msg, rinfo) => {
    if (msg.toString() === 'PING') {
      server.send('PONG', rinfo.port, rinfo.address);
    }
  });

  server.bind(PORT, () => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('PING');
    client.send(message, PORT, '127.0.0.1');

    const timer = setTimeout(() => {
      log('UDP', '未收到响应，可能不可达');
      cleanup();
    }, 2000);

    client.on('message', (msg) => {
      if (msg.toString() === 'PONG') {
        log('UDP', '收到 PONG');
      }
      clearTimeout(timer);
      cleanup();
    });

    function cleanup() {
      client.close();
      server.close();
      callback();
    }
  });
}

/* -------------------------------------------------
   3. WebSocket (ws)
------------------------------------------------- */
function testWebSocket(callback) {
  const PORT = 4003;
  const wss = new WebSocket.Server({ port: PORT }, () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);

    ws.on('open', () => {
      ws.send('PING');
    });

    ws.on('message', (msg) => {
      if (msg === 'PONG') {
        log('WebSocket', '收到 PONG');
      }
      cleanup();
    });

    ws.on('error', (err) => {
      log('WebSocket', `客户端错误: ${err.message}`);
      cleanup();
    });

    function cleanup() {
      ws.terminate();
      wss.close();
      callback();
    }
  });

  wss.on('connection', (socket) => {
    socket.on('message', (msg) => {
      if (msg === 'PING') {
        socket.send('PONG');
      }
    });
  });
}

/* -------------------------------------------------
   4. Redis Pub/Sub
------------------------------------------------- */
function testRedis(callback) {
  // 需要本地有可用的 Redis 实例（默认 6379）
  const CHANNEL = 'sibling_heartbeat';
  const publisher = redis.createClient(); // 默认 localhost:6379
  const subscriber = redis.createClient();

  let timeoutHandle = null;

  subscriber.on('error', (err) => log('Redis', `订阅者错误: ${err.message}`));
  publisher.on('error', (err) => log('Redis', `发布者错误: ${err.message}`));

  subscriber.subscribe(CHANNEL, (err) => {
    if (err) {
      log('Redis', `订阅失败: ${err.message}`);
      return cleanup();
    }
    // 发布一次心跳
    publisher.publish(CHANNEL, 'PING');
    // 等待响应
    timeoutHandle = setTimeout(() => {
      log('Redis', '未收到响应（可能没有其他实例监听）');
      cleanup();
    }, 2000);
  });

  subscriber.on('message', (chan, message) => {
    if (chan === CHANNEL && message === 'PONG') {
      log('Redis', '收到 PONG');
      clearTimeout(timeoutHandle);
      cleanup();
    }
  });

  // 为了演示，这里在同进程再起一个“姊妹实例”监听并回应该频道
  const responder = redis.createClient();
  responder.subscribe(CHANNEL);
  responder.on('message', (chan, msg) => {
    if (msg === 'PING') {
      responder.publish(CHANNEL, 'PONG');
    }
  });

  function cleanup() {
    subscriber.unsubscribe();
    subscriber.quit();
    publisher.quit();
    responder.unsubscribe();
    responder.quit();
    callback();
  }
}

/* -------------------------------------------------
   5. ZeroMQ REQ/REP
------------------------------------------------- */
async function testZeroMQ(callback) {
  const PORT = 4005;
  const rep = new zmq.Reply();
  const req = new zmq.Request();

  await rep.bind(`tcp://127.0.0.1:${PORT}`);

  // 启动 REP 监听（模拟姊妹实例）
  (async () => {
    for await (const [msg] of rep) {
      if (msg.toString() === 'PING') {
        await rep.send('PONG');
      }
    }
  })();

  // 客户端发送请求并等待回复
  try {
    await req.connect(`tcp://127.0.0.1:${PORT}`);
    await req.send('PING');

    const [reply] = await req.receive();
    if (reply.toString() === 'PONG') {
      log('ZeroMQ', '收到 PONG');
    } else {
      log('ZeroMQ', `收到未知响应: ${reply}`);
    }
  } catch (e) {
    log('ZeroMQ', `错误: ${e.message}`);
  } finally {
    req.close();
    rep.close();
    callback();
  }
}

/* -------------------------------------------------
   主流程：顺序执行每一种检测方式
------------------------------------------------- */
function runTests() {
  const tests = [
    testTcp,
    testUdp,
    testWebSocket,
    testRedis,
    testZeroMQ,
  ];

  // 递归顺序执行，确保 console 输出有序
  function next(i) {
    if (i >= tests.length) {
      console.log('\n=== 所有检测方式已完成 ===');
      return;
    }
    tests[i](() => {
      // 每种方式之间稍作间隔，避免端口冲突
      setTimeout(() => next(i + 1), 500);
    });
  }

  console.log('=== 开始实例间状态检测研究 ===');
  next(0);
}

runTests();