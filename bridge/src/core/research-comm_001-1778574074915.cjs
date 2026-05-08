// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:21:14.915Z

/**
 * 研究实例间通讯方式：除 HTTP Ping 之外的几种检测姐妹状态的方法
 *
 * 1. TCP 连接（使用 net 模块）  
 * 2. UDP 广播（使用 dgram 模块）  
 * 3. Redis Pub/Sub（使用 ioredis）  
 * 4. 简单的文件锁（使用 fs 模块）  
 *
 * 运行方式：
 *   node detect.js
 *
 * 需要预先安装 ioredis（npm install ioredis）
 */

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { createClient } = require('ioredis');

// ---------------------------
// 1. TCP 连接（简单的 TCP Ping）
const TCP_PORT = 9001;
const tcpServer = net.createServer((socket) => {
  console.log(`[TCP] 连接成功来自 ${socket.remoteAddress}:${socket.remotePort}`);
  socket.write('pong'); // 回复
  socket.end();
});
tcpServer.listen(TCP_PORT, () => {
  console.log(`[TCP] 服务器已在 ${TCP_PORT} 端口监听`);
  // 作为客户端尝试连接自己
  const client = net.connect({ port: TCP_PORT }, () => {
    console.log(`[TCP] 客户端已连接到服务器`);
  });
  client.on('data', (data) => {
    console.log(`[TCP] 收到数据: ${data.toString()}`);
  });
});

// ---------------------------
// 2. UDP 广播（广播检测）
const UDP_PORT = 9002;
const udpSocket = dgram.createSocket('udp4');

udpSocket.on('listening', () => {
  const address = udpSocket.address();
  console.log(`[UDP] 监听在 ${address.address}:${address.port}`);
});
udpSocket.on('message', (msg, rinfo) => {
  console.log(`[UDP] 从 ${rinfo.address}:${rinfo.port} 收到广播: ${msg}`);
});

udpSocket.bind(UDP_PORT, () => {
  // 广播消息
  const message = Buffer.from(`Hello from ${os.hostname()}`);
  udpSocket.setBroadcast(true);
  udpSocket.send(message, 0, message.length, UDP_PORT, '255.255.255.255', (err) => {
    if (err) console.error(`[UDP] 发送广播失败: ${err}`);
    else console.log(`[UDP] 广播已发送`);
  });
});

// ---------------------------
// 3. Redis Pub/Sub（基于消息队列的检测）
(async () => {
  const redis = createClient(); // 默认连接到 localhost:6379
  await redis.connect();
  const channel = 'sister-status';
  const listener = createClient();
  await listener.connect();

  listener.subscribe(channel, (message) => {
    console.log(`[Redis] 收到频道 ${channel} 的消息: ${message}`);
  });

  // 发送一条状态消息
  await redis.publish(channel, `Ping from ${os.hostname()} at ${new Date().toISOString()}`);
  console.log(`[Redis] 已向频道 ${channel} 发送状态消息`);

  // 延迟关闭以便观察
  setTimeout(() => {
    redis.disconnect();
    listener.disconnect();
  }, 2000);
})().catch(console.error);

// ---------------------------
// 4. 简单文件锁（基于文件的状态共享）
const lockFile = path.join(__dirname, 'sister.lock');
const lockWrite = async () => {
  const fd = await promisify(fs.open)(lockFile, 'w');
  const now = new Date().toISOString();
  await promisify(fs.write)(fd, now);
  await promisify(fs.close)(fd);
  console.log(`[File] 写入锁文件内容: ${now}`);
};

const lockRead = async () => {
  try {
    const data = await promisify(fs.readFile)(lockFile, 'utf8');
    console.log(`[File] 读取锁文件内容: ${data.trim()}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`[File] 锁文件不存在，可能没有其他实例写入`);
    } else {
      console.error(`[File] 读取锁文件时出错: ${err}`);
    }
  }
};

(async () => {
  await lockWrite();
  await lockRead();
})().catch(console.error);

// ---------------------------
// 输出说明
console.log('--- 检测完成，已尝试多种姐妹状态检测方式 ---');