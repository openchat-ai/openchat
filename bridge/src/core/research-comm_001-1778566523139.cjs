// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:15:23.139Z

/**
 * 1. HTTP Ping  (最常见的方案)
 * 2. TCP Keep‑Alive  (基于 TCP 的心跳，能检测底层连接状态)
 * 3. UDP 广播  (无连接，适合局域网内广播“我在线”)
 *
 * 运行方式：
 *   node instance_heartbeat.js
 *
 * 若想模拟多实例，只需在不同端口或不同机器上分别启动即可。
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');

// ---------- 配置 ----------
const HTTP_PORT = 3000;          // HTTP 服务监听端口
const TCP_PORT   = 4000;          // TCP 服务监听端口
const UDP_PORT   = 5000;          // UDP 广播端口
const UDP_BROADCAST_ADDR = '255.255.255.255';
const HEARTBEAT_INTERVAL = 3000;   // 3 秒一次
const TIMEOUT_MS = 5000;          // 5 秒无响应视为离线

// ---------- 1. HTTP Ping ----------
function startHttpServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('pong');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[HTTP] Server listening on http://localhost:${HTTP_PORT}`);
  });

  // 周期性向自己发送 HTTP Ping，模拟同一实例内的互检
  setInterval(() => {
    http.get(`http://localhost:${HTTP_PORT}/ping`, (res) => {
      if (res.statusCode === 200) {
        console.log(`[HTTP] 响应成功 (pong)`);
      } else {
        console.log(`[HTTP] 响应错误 ${res.statusCode}`);
      }
    }).on('error', (err) => {
      console.log(`[HTTP] 请求失败: ${err.message}`);
    });
  }, HEARTBEAT_INTERVAL);
}

// ---------- 2. TCP Keep‑Alive ----------
function startTcpServer() {
  const server = net.createServer((socket) => {
    console.log(`[TCP] 新连接来自 ${socket.remoteAddress}:${socket.remotePort}`);
    // 关闭 idle 连接
    socket.setKeepAlive(true, 5000);
    socket.on('close', () => console.log(`[TCP] 连接关闭`));
  });

  server.listen(TCP_PORT, () => {
    console.log(`[TCP] Server listening on port ${TCP_PORT}`);
  });

  // 周期性向自己发起 TCP 连接并立即关闭
  setInterval(() => {
    const client = new net.Socket();
    client.setTimeout(TIMEOUT_MS);
    client.connect(TCP_PORT, '127.0.0.1', () => {
      console.log(`[TCP] 连接成功`);
      client.end();
    });

    client.on('timeout', () => {
      console.log(`[TCP] 连接超时`);
      client.destroy();
    });

    client.on('error', (err) => {
      console.log(`[TCP] 连接错误: ${err.message}`);
      client.destroy();
    });
  }, HEARTBEAT_INTERVAL);
}

// ---------- 3. UDP 广播 ----------
function startUdpBroadcast() {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.bind(UDP_PORT, () => {
    socket.setBroadcast(true);
    console.log(`[UDP] 广播 socket 绑定到 ${UDP_PORT}, 开始广播`);
  });

  // 周期性广播“我在线”消息
  setInterval(() => {
    const message = Buffer.from(`Instance alive at ${new Date().toISOString()}`);
    socket.send(message, 0, message.length, UDP_PORT, UDP_BROADCAST_ADDR, (err) => {
      if (err) console.log(`[UDP] 发送错误: ${err.message}`);
    });
  }, HEARTBEAT_INTERVAL);

  // 接收同一网络中广播的“我在线”消息
  socket.on('message', (msg, rinfo) => {
    if (rinfo.address !== '127.0.0.1') { // 排除自己
      console.log(`[UDP] 收到来自 ${rinfo.address}:${rinfo.port} 的消息: ${msg.toString()}`);
    }
  });
}

// ---------- 启动 ----------
startHttpServer();
startTcpServer();
startUdpBroadcast();