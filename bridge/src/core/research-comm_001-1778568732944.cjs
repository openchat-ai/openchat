// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:52:12.944Z

/**
 * 实例间通讯方式研究
 * 目标：在本机上演示几种常见的“姐妹状态检测”方案
 *   1. TCP 心跳（利用 net 模块）
 *   2. UDP 广播（利用 dgram 模块）
 *   3. WebSocket ping/pong（利用 ws 模块）
 *   4. 简单的 HTTP GET（利用 http 模块）
 *
 * 运行方式：
 *   1. 确保已经安装 ws:   npm install ws
 *   2. 直接执行: node instance-health-check.js
 *
 * 说明：
 *   - 每个方案都启动一个服务器（监听本机 0.0.0.0）和一个客户端（向服务器发送心跳/广播/请求）
 *   - 通过 console.log 输出成功与否
 *   - 代码使用 CommonJS（require）语法
 */

const net = require('net');
const dgram = require('dgram');
const http = require('http');
const WebSocket = require('ws');

/* ---------- 1. TCP 心跳 ---------- */
const TCP_PORT = 3001;
const tcpServer = net.createServer((socket) => {
  socket.on('data', (data) => {
    console.log(`[TCP] 收到心跳: ${data.toString()}`);
    socket.write('ACK');
  });
});
tcpServer.listen(TCP_PORT, '0.0.0.0', () => {
  console.log(`[TCP] 服务器已启动，监听 ${TCP_PORT}`);
  const client = new net.Socket();
  client.connect(TCP_PORT, '127.0.0.1', () => {
    console.log('[TCP] 客户端已连接，发送心跳');
    client.write('HEARTBEAT');
  });
  client.on('data', (data) => {
    console.log(`[TCP] 收到 ACK: ${data.toString()}`);
    client.destroy();
  });
});

/* ---------- 2. UDP 广播 ---------- */
const UDP_PORT = 3002;
const udpServer = dgram.createSocket('udp4');

udpServer.on('message', (msg, rinfo) => {
  console.log(`[UDP] 收到广播: ${msg} 来自 ${rinfo.address}:${rinfo.port}`);
});
udpServer.bind(UDP_PORT, () => {
  console.log(`[UDP] 服务器已启动，监听 ${UDP_PORT}`);
  const client = dgram.createSocket('udp4');
  const message = Buffer.from('BROADCAST_HEARTBEAT');
  // 设置广播权限
  client.setBroadcast(true);
  client.send(message, 0, message.length, UDP_PORT, '255.255.255.255', (err) => {
    if (err) console.error(`[UDP] 发送错误: ${err}`);
    else console.log('[UDP] 广播已发送');
    client.close();
  });
});

/* ---------- 3. WebSocket ping/pong ---------- */
const WS_PORT = 3003;
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws) => {
  console.log('[WS] 客户端连接成功');
  ws.on('pong', () => {
    console.log('[WS] 收到 pong（心跳确认）');
  });

  // 每秒发送 ping
  const pingInterval = setInterval(() => {
    console.log('[WS] 发送 ping');
    ws.ping();
  }, 1000);

  ws.on('close', () => {
    clearInterval(pingInterval);
    console.log('[WS] 连接已关闭');
  });
});

console.log(`[WS] 服务器已启动，监听 ${WS_PORT}`);

// WebSocket 客户端
const wsClient = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
wsClient.on('open', () => {
  console.log('[WS] 连接已打开');
});
wsClient.on('pong', () => {
  console.log('[WS] 收到 pong（服务器响应 ping）');
});
wsClient.on('message', (data) => {
  console.log(`[WS] 收到消息: ${data}`);
});

/* ---------- 4. HTTP GET ---------- */
const HTTP_PORT = 3004;
const httpServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    console.log('[HTTP] 接收到健康检查请求');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end();
  }
});
httpServer.listen(HTTP_PORT, () => {
  console.log(`[HTTP] 服务器已启动，监听 ${HTTP_PORT}`);
  // 客户端健康检查
  http.get(`http://127.0.0.1:${HTTP_PORT}/health`, (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => {
      console.log(`[HTTP] 响应: ${body}`);
    });
  }).on('error', (err) => {
    console.error(`[HTTP] 请求错误: ${err}`);
  });
});

/* ---------- 结束 ---------- */
console.log('=== 实例间通讯方式研究已完成 ===');