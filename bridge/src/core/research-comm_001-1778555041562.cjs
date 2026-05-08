// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:04:01.562Z

/**
 * 研究实例间通讯方式（非 HTTP ping）：
 * 1. UDP 广播心跳
 * 2. TCP 连接检查
 * 3. Redis PING / PUB/SUB
 * 4. 通过文件锁（可选）
 *
 * 运行方式：
 *   1. 确保已安装 redis 并启动服务（默认 127.0.0.1:6379）
 *   2. 运行 `node instance_check.js`
 *
 * 代码会在同一台机器上启动两个“实例”，分别监听 UDP 广播、TCP 端口
 * 并互相发送心跳/PING，最后打印检测结果。
 */

const net = require('net');
const dgram = require('dgram');
const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');

// ----------------- 配置 -----------------
const UDP_PORT = 41234;
const TCP_PORT = 5000;
const REDIS_CHANNEL = 'instance_heartbeat';
const INSTANCE_ID = `instance_${Math.floor(Math.random() * 1000)}`;
// ----------------- UDP 心跳 -----------------
const udpSocket = dgram.createSocket('udp4');

// 1) 监听 UDP 广播
udpSocket.on('message', (msg, rinfo) => {
  console.log(`[UDP] 接收到来自 ${rinfo.address}:${rinfo.port} 的心跳：${msg.toString()}`);
});

// 2) 发送 UDP 心跳
setInterval(() => {
  const message = Buffer.from(`${INSTANCE_ID} UDP_HEARTBEAT`);
  udpSocket.send(message, 0, message.length, UDP_PORT, '255.255.255.255', err => {
    if (err) console.error(`[UDP] 发送心跳失败：${err.message}`);
  });
}, 3000);

// 监听本地 UDP 端口
udpSocket.bind(UDP_PORT, () => {
  console.log(`[UDP] ${INSTANCE_ID} 开始监听 ${UDP_PORT} 端口`);
  udpSocket.setBroadcast(true);
});

// ----------------- TCP 心跳 -----------------
const tcpServer = net.createServer(socket => {
  console.log(`[TCP] 接收到连接来自 ${socket.remoteAddress}:${socket.remotePort}`);
  socket.on('data', data => {
    console.log(`[TCP] 收到数据：${data.toString()}`);
  });
});

tcpServer.listen(TCP_PORT, () => {
  console.log(`[TCP] ${INSTANCE_ID} 开始监听 ${TCP_PORT} 端口`);
});

// 发送 TCP 心跳（尝试连接到同一端口）
setInterval(() => {
  const client = new net.Socket();
  client.setTimeout(2000);
  client.connect(TCP_PORT, '127.0.0.1', () => {
    const msg = `${INSTANCE_ID} TCP_HEARTBEAT`;
    client.write(msg);
    client.end();
  });
  client.on('error', err => {
    console.log(`[TCP] 连接失败：${err.message}`);
  });
}, 4000);

// ----------------- Redis 心跳 -----------------
const redisClient = createClient(); // 默认 127.0.0.1:6379
redisClient.on('error', err => console.error(`Redis 错误：${err.message}`));

redisClient.connect().then(() => {
  console.log(`[Redis] ${INSTANCE_ID} 已连接到 Redis`);

  // 发布心跳
  setInterval(async () => {
    await redisClient.publish(REDIS_CHANNEL, `${INSTANCE_ID} REDIS_HEARTBEAT`);
  }, 5000);

  // 订阅心跳
  const subscriber = redisClient.duplicate();
  subscriber.connect().then(() => {
    subscriber.subscribe(REDIS_CHANNEL, message => {
      console.log(`[Redis] 收到频道 ${REDIS_CHANNEL} 的消息：${message}`);
    });
  });
});

// ----------------- 文件锁（可选） -----------------
const lockFile = path.join(__dirname, 'instance.lock');
try {
  // 尝试创建锁文件（写入实例 ID）
  fs.writeFileSync(lockFile, INSTANCE_ID, { flag: 'wx' });
  console.log(`[FileLock] 已创建锁文件，实例 ID: ${INSTANCE_ID}`);
} catch (err) {
  console.log(`[FileLock] 锁文件已存在，可能有其他实例正在运行`);
}

// ----------------- 清理 -----------------
process.on('exit', () => {
  udpSocket.close();
  tcpServer.close();
  redisClient.quit();
  try {
    fs.unlinkSync(lockFile);
  } catch (_) {}
});