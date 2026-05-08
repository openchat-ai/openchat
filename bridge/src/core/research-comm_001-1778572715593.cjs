// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:58:35.593Z

// file: sibling_detection.js
// Node.js CommonJS demo – 3 常见实例间通讯方式探测姐妹状态

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const PORT_TCP = 4001;
const PORT_UDP = 4002;
const PORT_WS = 4003;
const BROADCAST_ADDR = '255.255.255.255';
const INTERVAL_MS = 2000;

// ====================== 1. TCP 心跳 ======================
function startTcpServer() {
  const server = net.createServer((socket) => {
    console.log('[TCP] 子实例已连接：', socket.remoteAddress, socket.remotePort);
    socket.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg === 'PING') {
        console.log('[TCP] 收到 PING，回应 PONG');
        socket.write('PONG\n');
      }
    });
  });

  server.listen(PORT_TCP, () => {
    console.log(`[TCP] 服务器已启动，监听端口 ${PORT_TCP}`);
  });
}

function startTcpClient() {
  const client = net.createConnection({ port: PORT_TCP, host: '127.0.0.1' }, () => {
    console.log('[TCP] 成功连接到服务器');
    setInterval(() => {
      console.log('[TCP] 发送 PING');
      client.write('PING\n');
    }, INTERVAL_MS);
  });

  client.on('data', (data) => {
    console.log('[TCP] 收到来自服务器的', data.toString().trim());
  });

  client.on('error', (err) => console.error('[TCP] 错误：', err.message));
}

// ====================== 2. UDP 广播 ======================
function startUdpListener() {
  const socket = dgram.createSocket('udp4');

  socket.on('message', (msg, rinfo) => {
    const txt = msg.toString().trim();
    if (txt === 'PING') {
      console.log(`[UDP] 收到来自 ${rinfo.address}:${rinfo.port} 的 PING，回复 PONG`);
      const reply = Buffer.from('PONG\n');
      socket.send(reply, 0, reply.length, rinfo.port, rinfo.address);
    }
  });

  socket.bind(PORT_UDP, () => {
    socket.setBroadcast(true);
    console.log(`[UDP] 监听端口 ${PORT_UDP}，已开启广播`);
  });
}

function startUdpBroadcaster() {
  const socket = dgram.createSocket('udp4');
  socket.bind(() => {
    socket.setBroadcast(true);
    console.log('[UDP] 广播客户端已准备就绪');
    setInterval(() => {
      const msg = Buffer.from('PING\n');
      console.log('[UDP] 广播 PING');
      socket.send(msg, 0, msg.length, PORT_UDP, BROADCAST_ADDR);
    }, INTERVAL_MS);
  });

  socket.on('message', (msg, rinfo) => {
    console.log(`[UDP] 收到来自 ${rinfo.address}:${rinfo.port} 的 ${msg.toString().trim()}`);
  });
}

// ====================== 3. WebSocket 双向 ======================
function startWsServer() {
  const wss = new WebSocket.Server({ port: PORT_WS }, () => {
    console.log(`[WS] WebSocket 服务器已启动，监听端口 ${PORT_WS}`);
  });

  wss.on('connection', (ws, req) => {
    console.log('[WS] 子实例已连接：', req.socket.remoteAddress);
    ws.on('message', (message) => {
      const msg = message.toString().trim();
      if (msg === 'ping') {
        console.log('[WS] 收到 ping，回复 pong');
        ws.send('pong');
      }
    });

    // 选填：服务器主动 ping
    setInterval(() => {
      ws.send('ping');
    }, INTERVAL_MS);
  });
}

function startWsClient() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT_WS}`);

  ws.on('open', () => {
    console.log('[WS] 成功连接到服务器');
    // 客户端主动 ping
    setInterval(() => {
      console.log('[WS] 发送 ping');
      ws.send('ping');
    }, INTERVAL_MS);
  });

  ws.on('message', (data) => {
    console.log('[WS] 收到', data.toString().trim());
  });

  ws.on('error', (err) => console.error('[WS] 错误：', err.message));
}

// ====================== 主程序 ======================
function main() {
  // 1. TCP
  startTcpServer();
  setTimeout(startTcpClient, 500); // 先让服务器启动，再启动客户端

  // 2. UDP
  startUdpListener();
  setTimeout(startUdpBroadcaster, 500);

  // 3. WebSocket
  startWsServer();
  setTimeout(startWsClient, 500);
}

main();