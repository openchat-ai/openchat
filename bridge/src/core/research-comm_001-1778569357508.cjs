// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:02:37.508Z

// inter_instance_communication.js
// 运行方式：node inter_instance_communication.js

const http = require('http');
const dgram = require('dgram');
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

// 如果你想使用 Redis，取消以下注释并安装 redis 模块
// const redis = require('redis');
// const REDIS_CHANNEL = 'instance_heartbeat';

const INSTANCE_COUNT = 2;
const BASE_HTTP_PORT = 3000;
const UDP_PORT = 41234;
const BROADCAST_ADDR = '255.255.255.255';
const HEARTBEAT_DIR = path.join(__dirname, 'tmp');
const HEARTBEAT_FILE = path.join(HEARTBEAT_DIR, 'heartbeat.txt');

// 创建共享文件夹
if (!fs.existsSync(HEARTBEAT_DIR)) {
  fs.mkdirSync(HEARTBEAT_DIR);
}

// ---------- 主进程 ----------
if (require.main === module) {
  console.log('=== 主进程：启动实例 ===');
  for (let i = 0; i < INSTANCE_COUNT; i++) {
    const instancePort = BASE_HTTP_PORT + i;
    const child = fork(__filename, ['--instance', i, '--port', instancePort], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });

    child.on('message', (msg) => {
      console.log(`[主进程] 收到实例 ${i} 的消息:`, msg);
    });
  }
  return;
}

// ---------- 实例代码 ----------
const args = process.argv.slice(2);
if (args.includes('--instance')) {
  const idx = parseInt(args[args.indexOf('--instance') + 1], 10);
  const port = parseInt(args[args.indexOf('--port') + 1], 10);
  const instanceId = `inst-${idx}`;

  console.log(`[${instanceId}] 启动中：HTTP ${port} | UDP ${UDP_PORT}`);

  // 1. HTTP 服务器（传统方式）
  const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('pong');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  httpServer.listen(port, () => {
    console.log(`[${instanceId}] HTTP 服务器已监听 ${port}`);
  });

  // 2. UDP 广播监听 + 发送
  const udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  udpSocket.on('listening', () => {
    const address = udpSocket.address();
    console.log(`[${instanceId}] UDP 已监听 ${address.address}:${address.port}`);
    udpSocket.setBroadcast(true);

    // 每 3 秒广播一次自己的 ID
    setInterval(() => {
      const msg = Buffer.from(`heartbeat:${instanceId}`);
      udpSocket.send(msg, 0, msg.length, UDP_PORT, BROADCAST_ADDR, (err) => {
        if (err) console.error(`[${instanceId}] UDP 发送错误:`, err);
      });
    }, 3000);
  });

  udpSocket.on('message', (msg, rinfo) => {
    const text = msg.toString();
    if (text.startsWith('heartbeat:')) {
      const otherId = text.split(':')[1];
      if (otherId !== instanceId) {
        console.log(`[${instanceId}] UDP 检测到 ${otherId} (${rinfo.address}:${rinfo.port})`);
        process.send && process.send({ method: 'udp', other: otherId, address: rinfo.address });
      }
    }
  });

  udpSocket.bind(UDP_PORT, () => {
    // 需要先 bind 才能 setBroadcast
  });

  // 3. 文件系统监视
  // 每 4 秒写一次心跳文件
  setInterval(() => {
    const now = Date.now();
    fs.writeFile(HEARTBEAT_FILE, `${instanceId}:${now}\n`, { flag: 'a' }, (err) => {
      if (err) console.error(`[${instanceId}] 写文件错误:`, err);
    });
  }, 4000);

  // 监听文件修改
  const watcher = fs.watch(HEARTBEAT_FILE, (eventType, filename) => {
    if (eventType === 'change') {
      fs.readFile(HEARTBEAT_FILE, 'utf8', (err, data) => {
        if (err) return;
        const lines = data.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const [otherId, ts] = lastLine.split(':');
        if (otherId && otherId !== instanceId) {
          console.log(`[${instanceId}] 文件监视检测到 ${otherId} 心跳 (${ts})`);
          process.send && process.send({ method: 'fs', other: otherId, ts: Number(ts) });
        }
      });
    }
  });

  // 4. （可选）Redis Pub/Sub
  // 如果你想测试 Redis，可以取消下面的注释并确保 Redis 服务器已启动
  /*
  const client = redis.createClient();
  client.on('error', (err) => console.error(`[${instanceId}] Redis 错误:`, err));
  client.subscribe(REDIS_CHANNEL);
  client.on('message', (channel, message) => {
    if (channel === REDIS_CHANNEL && message !== instanceId) {
      console.log(`[${instanceId}] Redis 频道检测到 ${message}`);
      process.send && process.send({ method: 'redis', other: message });
    }
  });

  setInterval(() => {
    client.publish(REDIS_CHANNEL, instanceId);
  }, 5000);
  */
}