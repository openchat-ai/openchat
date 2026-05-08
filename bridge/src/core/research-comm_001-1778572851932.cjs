// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:00:51.932Z

/**
 * 通过多种机制检查“姐妹实例”是否存活
 * 
 * 1. HTTP GET /health  – 传统的健康检查
 * 2. WebSocket ping/pong – 低延迟实时检测
 * 3. Redis Pub/Sub – 通过发布订阅确认
 * 4. 文件系统轮询 – 写入文件后检查时间戳
 * 5. 进程间 IPC（child_process） – 仅在同一台机器上可用
 *
 * 运行方式：
 *   1. 安装依赖：npm install express ws ioredis
 *   2. 运行两份实例：node instance.js 8000   (端口 8000)
 *                           node instance.js 8001   (端口 8001)
 *   3. 观察控制台输出，比较不同机制的响应时间和成功率
 *
 * 注意：
 *   - 需要有可访问的 Redis 服务器（默认 127.0.0.1:6379）
 *   - 文件轮询会使用 ./health.txt 作为共享文件
 *   - 只在本地机器上演示 IPC，外部机器不适用
 */

const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Server } = require('ws');
const Redis = require('ioredis');
const { fork } = require('child_process');

// ---- 参数 ----
const PORT = process.argv[2] || 8000;          // 监听端口
const REDIS_CHANNEL = 'health_check';
const HEALTH_FILE = path.join(__dirname, 'health.txt');

// ---- 1. HTTP 健康检查 ----
const app = express();
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});
const httpServer = http.createServer(app);
httpServer.listen(PORT, () => {
  console.log(`HTTP server listening on ${PORT}`);
});

// ---- 2. WebSocket 监测 ----
const wss = new Server({ server: httpServer });
wss.on('connection', ws => {
  console.log('WebSocket 连接建立');
  const pingInterval = setInterval(() => {
    ws.ping();
  }, 3000);

  ws.on('pong', () => {
    console.log(`[WS] 收到 pong (${Date.now()})`);
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    console.log('WebSocket 连接关闭');
  });
});

// ---- 3. Redis Pub/Sub ----
const redisPub = new Redis();
const redisSub = new Redis();
redisSub.subscribe(REDIS_CHANNEL, err => {
  if (err) console.error('Redis 订阅错误', err);
});

redisSub.on('message', (channel, message) => {
  console.log(`[Redis] 收到消息 ${message} (channel: ${channel})`);
});

setInterval(() => {
  const msg = `ping-${PORT}-${Date.now()}`;
  redisPub.publish(REDIS_CHANNEL, msg);
  console.log(`[Redis] 发送 ${msg}`);
}, 5000);

// ---- 4. 文件系统轮询 ----
const healthCheck = () => {
  const msg = `ping-${PORT}-${Date.now()}\n`;
  fs.writeFileSync(HEALTH_FILE, msg, { encoding: 'utf8' });
  console.log(`[FS] 写入 ${msg.trim()}`);
};

fs.watchFile(HEALTH_FILE, { interval: 2000 }, (curr, prev) => {
  if (curr.mtimeMs !== prev.mtimeMs) {
    console.log(`[FS] 文件更新，时间戳 ${curr.mtime}`);
  }
});

setInterval(healthCheck, 7000);

// ---- 5. IPC 进程间通信（仅演示） ----
if (process.argv[3] === 'child') {
  // 子进程逻辑
  setInterval(() => {
    console.log(`[IPC] 子进程 ping (${Date.now()})`);
    process.send({ type: 'ping', time: Date.now() });
  }, 4000);

  process.on('message', msg => {
    if (msg.type === 'pong') {
      console.log(`[IPC] 子进程收到 pong (${msg.time})`);
    }
  });
} else {
  // 父进程逻辑
  const child = fork(__filename, [PORT, 'child']);
  child.on('message', msg => {
    if (msg.type === 'ping') {
      console.log(`[IPC] 父进程收到 ping (${msg.time})`);
      child.send({ type: 'pong', time: Date.now() });
    }
  });
}