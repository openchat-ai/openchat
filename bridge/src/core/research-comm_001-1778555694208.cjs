// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:14:54.208Z

/**
 * 方案： 通过两种方式检测“姐妹实例”是否存活
 * 1. HTTP 健康检查（传统的 /health 端点）
 * 2. UDP 广播“ping‑pong”机制（比 HTTP 更轻量，适合同一网络内的实例）
 *
 * 代码思路：
 * - 先用 Express 开启一个 /health 端点，返回 200 OK 表示实例在线
 * - 同时，使用 dgram 创建一个 UDP socket，监听 9999 端口
 *   当收到 "PING" 时回复 "PONG"（示例对方实例也需要运行同样代码）
 * - 每隔 5 秒向 255.255.255.255:9999 广播 "PING"，并等待 2 秒响应，
 *   若收到 "PONG" 则认为相邻实例存活
 * - 通过 console.log 打印检测结果
 */

const http = require('http');
const express = require('express');
const dgram = require('dgram');
const os = require('os');

const PORT = 3000;          // HTTP 监听端口
const UDP_PORT = 9999;      // UDP 监听端口
const BROADCAST_ADDR = '255.255.255.255';
const PING_INTERVAL_MS = 5000;
const PONG_TIMEOUT_MS = 2000;

// --------------------------------------------------
// 1. HTTP 健康检查
// --------------------------------------------------
const app = express();

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`HTTP health check running on http://localhost:${PORT}/health`);
});

// --------------------------------------------------
// 2. UDP ping‑pong
// --------------------------------------------------
const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });

udpServer.on('error', (err) => {
  console.error(`UDP socket error:\n${err.stack}`);
  udpServer.close();
});

udpServer.on('message', (msg, rinfo) => {
  const text = msg.toString().trim();
  if (text === 'PING') {
    // 对方来 ping，回复 pong
    const response = Buffer.from('PONG');
    udpServer.send(response, 0, response.length, rinfo.port, rinfo.address, (err) => {
      if (err) console.error('Failed to send PONG:', err);
    });
  } else if (text === 'PONG') {
    // 收到 pong，记录响应
    const key = `${rinfo.address}:${rinfo.port}`;
    pendingPongs.set(key, true);
  }
});

udpServer.bind(UDP_PORT, () => {
  udpServer.setBroadcast(true);
  console.log(`UDP ping‑pong listening on port ${UDP_PORT}`);
});

// --------------------------------------------------
// 3. 定期广播 PING
// --------------------------------------------------
const pendingPongs = new Map(); // key: "ip:port" -> boolean

function broadcastPing() {
  const message = Buffer.from('PING');
  udpServer.send(message, 0, message.length, UDP_PORT, BROADCAST_ADDR, (err) => {
    if (err) console.error('Failed to broadcast PING:', err);
  });
  // 清空上一次的记录
  pendingPongs.clear();
  console.log(`[${new Date().toISOString()}] 广播 PING 到 ${BROADCAST_ADDR}:${UDP_PORT}`);
}

function checkPongs() {
  setTimeout(() => {
    if (pendingPongs.size === 0) {
      console.log(`[${new Date().toISOString()}] 未收到任何 PONG，姐妹实例可能离线`);
    } else {
      console.log(`[${new Date().toISOString()}] 收到 ${pendingPongs.size} 个 PONG，姐妹实例在线`);
    }
  }, PONG_TIMEOUT_MS);
}

// 周期性执行
setInterval(() => {
  broadcastPing();
  checkPongs();
}, PING_INTERVAL_MS);