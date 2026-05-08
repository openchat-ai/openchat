// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:00:06.270Z

/**
 *  inter-instance-communication.js
 *
 *  研究不同实例间通讯方式，演示如何检测“姐妹实例”状态。
 *  运行方式：node inter-instance-communication.js
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const { spawn } = require('child_process');
const redis = require('redis');

// ---------- 配置 ----------
const HTTP_PORT = 3000;
const TCP_PORT  = 4000;
const UDP_PORT  = 5000;
const UDP_BROADCAST_ADDR = '255.255.255.255';
const REDIS_CHANNEL = 'heartbeat';

// ---------- 1. HTTP Ping ----------
function startHttpServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200);
      res.end('pong');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[HTTP] 监听端口 ${HTTP_PORT}`);
  });

  // 每 5 秒向自身发送一次 ping
  setInterval(() => {
    http.get(`http://127.0.0.1:${HTTP_PORT}/ping`, (res) => {
      console.log(`[HTTP] 响应状态 ${res.statusCode}`);
    }).on('error', (e) => {
      console.error('[HTTP] 请求错误', e.message);
    });
  }, 5000);
}

// ---------- 2. TCP Ping ----------
function startTcpServer() {
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      if (data.toString() === 'ping') {
        socket.write('pong');
      }
    });
  });

  server.listen(TCP_PORT, () => {
    console.log(`[TCP] 监听端口 ${TCP_PORT}`);
  });

  // 每 5 秒向自身发送一次 ping
  setInterval(() => {
    const client = net.createConnection({ port: TCP_PORT }, () => {
      client.write('ping');
    });

    client.on('data', (data) => {
      console.log(`[TCP] 收到 ${data.toString()}`);
      client.end();
    });

    client.on('error', (err) => {
      console.error('[TCP] 连接错误', err.message);
    });
  }, 5000);
}

// ---------- 3. UDP 广播 ----------
function startUdpServer() {
  const socket = dgram.createSocket('udp4');

  socket.on('message', (msg, rinfo) => {
    console.log(`[UDP] 收到来自 ${rinfo.address}:${rinfo.port} 的 ${msg.toString()}`);
  });

  socket.bind(UDP_PORT, () => {
    socket.setBroadcast(true);
    console.log(`[UDP] 绑定端口 ${UDP_PORT} 并开启广播`);
  });

  // 每 7 秒广播一次
  setInterval(() => {
    const message = Buffer.from(`ping-${Date.now()}`);
    socket.send(message, 0, message.length, UDP_PORT, UDP_BROADCAST_ADDR, () => {
      console.log(`[UDP] 发送广播消息`);
    });
  }, 7000);
}

// ---------- 4. Redis Pub/Sub ----------
function startRedisPubSub() {
  const pubClient = redis.createClient();
  const subClient = redis.createClient();

  subClient.subscribe(REDIS_CHANNEL, (err) => {
    if (err) {
      console.error('[Redis] 订阅错误', err);
      return;
    }
    console.log(`[Redis] 已订阅频道 ${REDIS_CHANNEL}`);
  });

  subClient.on('message', (channel, message) => {
    console.log(`[Redis] 收到频道 ${channel} 的消息: ${message}`);
  });

  // 每 6 秒发布一次心跳
  setInterval(() => {
    const msg = `heartbeat-${Date.now()}`;
    pubClient.publish(REDIS_CHANNEL, msg, () => {
      console.log(`[Redis] 发布心跳 ${msg}`);
    });
  }, 6000);
}

// ---------- 5. IPC (child_process) ----------
function startIpc() {
  // 只在主进程中创建子进程
  const child = spawn(process.execPath, [__filename, '--child'], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });

  child.on('message', (msg) => {
    console.log(`[IPC] 子进程发送消息: ${msg}`);
  });

  // 每 4 秒向子进程发送一次
  setInterval(() => {
    child.send(`ping-${Date.now()}`);
  }, 4000);

  child.on('exit', (code) => {
    console.log(`[IPC] 子进程退出，退出码 ${code}`);
  });
}

// ---------- 子进程逻辑 ----------
function childProcessLogic() {
  process.on('message', (msg) => {
    console.log(`[IPC 子] 收到父进程消息: ${msg}`);
    // 对父进程回复
    process.send(`pong-${Date.now()}`);
  });
}

// ---------- 主入口 ----------
if (process.argv.includes('--child')) {
  childProcessLogic();
} else {
  console.log('=== 开始实例间通讯方式研究 ===');
  startHttpServer();
  startTcpServer();
  startUdpServer();
  startRedisPubSub();
  startIpc();
}