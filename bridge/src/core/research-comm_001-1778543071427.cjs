// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:44:31.427Z

/**
 * 例子：多种实例间通讯方式的健康检查
 * 运行方式：
 *   1. npm install ws redis
 *   2. node healthCheck.js
 *
 * 代码会在本机启动 4 个服务实例（HTTP/TCP/UDP/Redis）并尝试检测它们的可达性。
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const redis = require('redis');
const { promisify } = require('util');

/* ---------- 1. HTTP 健康检查 ---------- */
const httpPort = 3000;
const httpServer = http.createServer((req, res) => {
  if (req.url === '/ping') {
    res.writeHead(200);
    res.end('pong');
  } else {
    res.writeHead(404);
    res.end();
  }
});
httpServer.listen(httpPort, () => {
  console.log(`[HTTP] 监听 http://127.0.0.1:${httpPort}/ping`);
});

/* ---------- 2. TCP 监听 ---------- */
const tcpPort = 3001;
const tcpServer = net.createServer((socket) => {
  socket.on('data', (data) => {
    socket.write(`echo: ${data}`);
  });
});
tcpServer.listen(tcpPort, () => {
  console.log(`[TCP] 监听 127.0.0.1:${tcpPort}`);
});

/* ---------- 3. UDP 监听 ---------- */
const udpPort = 3002;
const udpServer = dgram.createSocket('udp4');
udpServer.on('message', (msg, rinfo) => {
  const response = Buffer.from(`udp echo: ${msg}`);
  udpServer.send(response, 0, response.length, rinfo.port, rinfo.address);
});
udpServer.bind(udpPort, () => {
  console.log(`[UDP] 监听 127.0.0.1:${udpPort}`);
});

/* ---------- 4. Redis Pub/Sub 监听 ---------- */
const redisPort = 6379; // 默认 Redis 端口
const redisClient = redis.createClient({ port: redisPort });
redisClient.on('error', (err) => console.error('Redis error', err));
redisClient.on('connect', () => console.log(`[Redis] 已连接到 127.0.0.1:${redisPort}`));

/* ---------- 检测函数 ---------- */
async function httpPing() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${httpPort}/ping`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(`HTTP Ping: ${data}`));
    });
    req.on('error', () => resolve('HTTP Ping: 失败'));
    req.setTimeout(2000, () => {
      req.abort();
      resolve('HTTP Ping: 超时');
    });
  });
}

async function tcpPing() {
  return new Promise((resolve) => {
    const client = new net.Socket();
    client.setTimeout(2000);
    client.connect(tcpPort, '127.0.0.1', () => {
      client.write('test');
    });
    client.on('data', (data) => {
      client.destroy();
      resolve(`TCP Ping: ${data.toString()}`);
    });
    client.on('error', () => resolve('TCP Ping: 失败'));
    client.on('timeout', () => {
      client.destroy();
      resolve('TCP Ping: 超时');
    });
  });
}

async function udpPing() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('ping');
    const timer = setTimeout(() => {
      client.close();
      resolve('UDP Ping: 超时');
    }, 2000);
    client.send(message, udpPort, '127.0.0.1', (err) => {
      if (err) {
        clearTimeout(timer);
        client.close();
        return resolve('UDP Ping: 失败');
      }
    });
    client.on('message', (msg) => {
      clearTimeout(timer);
      client.close();
      resolve(`UDP Ping: ${msg.toString()}`);
    });
  });
}

async function websocketPing() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    let timeout;
    ws.on('open', () => {
      ws.ping();
      timeout = setTimeout(() => {
        ws.terminate();
        resolve('WebSocket Ping: 超时');
      }, 2000);
    });
    ws.on('pong', () => {
      clearTimeout(timeout);
      ws.terminate();
      resolve('WebSocket Ping: pong 收到');
    });
    ws.on('error', () => resolve('WebSocket Ping: 失败'));
  });
}

async function redisPing() {
  return new Promise((resolve) => {
    const sub = redis.createClient({ port: redisPort });
    const channel = 'health-check';
    const msgHandler = (channel, message) => {
      sub.unsubscribe(channel);
      sub.quit();
      resolve(`Redis Ping: 收到消息 "${message}"`);
    };
    sub.on('error', () => resolve('Redis Ping: 失败'));
    sub.subscribe(channel, (err) => {
      if (err) return resolve('Redis Ping: 订阅失败');
      // 发送一条消息，服务端会收到并返回
      setTimeout(() => {
        const pub = redis.createClient({ port: redisPort });
        pub.publish(channel, 'ping', () => pub.quit());
      }, 100);
    });
    sub.on('message', msgHandler);
    // 超时保护
    setTimeout(() => {
      sub.unsubscribe(channel);
      sub.quit();
      resolve('Redis Ping: 超时');
    }, 3000);
  });
}

/* ---------- WebSocket 服务器 ---------- */
const wsPort = 3003;
const wss = new WebSocket.Server({ port: wsPort }, () => {
  console.log(`[WebSocket] 监听 ws://127.0.0.1:${wsPort}`);
});
wss.on('connection', (ws) => {
  ws.on('ping', () => ws.pong());
});

/* ---------- 运行检测 ---------- */
(async () => {
  // 给服务一点时间启动
  await new Promise((r) => setTimeout(r, 500));

  console.log('\n===== 开始健康检查 =====\n');

  const [h1, h2, h3, h4, h5] = await Promise.all([
    httpPing(),
    tcpPing(),
    udpPing(),
    websocketPing(),
    redisPing(),
  ]);

  console.log(h1);
  console.log(h2);
  console.log(h3);
  console.log(h4);
  console.log(h5);

  console.log('\n===== 检查完成 =====');

  // 关闭服务
  httpServer.close();
  tcpServer.close();
  udpServer.close();
  wss.close();
  redisClient.quit();
})();