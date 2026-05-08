// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:15:53.433Z

// === node_example_health_checks.js ===
// 运行前请先执行: npm install ws
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');

// ----------------------
// 1. HTTP 服务器
// ----------------------
const httpPort = 3000;
const httpServer = http.createServer((req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: Date.now() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
httpServer.listen(httpPort, () => {
  console.log(`[HTTP] 服务器已在 http://127.0.0.1:${httpPort}/status 启动`);
});

// ----------------------
// 2. TCP 服务器
// ----------------------
const tcpPort = 4000;
const tcpServer = net.createServer((socket) => {
  socket.write('TCP_OK\n');
  socket.end();
});
tcpServer.listen(tcpPort, () => {
  console.log(`[TCP] 服务器已在 127.0.0.1:${tcpPort} 启动`);
});

// ----------------------
// 3. UDP 服务器（广播监听）
// ----------------------
const udpPort = 5000;
const udpServer = dgram.createSocket('udp4');
udpServer.on('message', (msg, rinfo) => {
  console.log(`[UDP] 收到来自 ${rinfo.address}:${rinfo.port} 的消息: ${msg}`);
  const response = Buffer.from('UDP_OK');
  udpServer.send(response, rinfo.port, rinfo.address, (err) => {
    if (err) console.error('[UDP] 发送响应失败', err);
  });
});
udpServer.bind(udpPort, () => {
  console.log(`[UDP] 服务器已在 127.0.0.1:${udpPort} 监听`);
});

// ----------------------
// 4. WebSocket 服务器
// ----------------------
const wsPort = 6000;
const wsServer = new WebSocket.Server({ port: wsPort });
wsServer.on('connection', (ws) => {
  ws.on('open', () => console.log('[WS] 连接已打开'));
  ws.on('ping', () => ws.pong()); // 自动回应 pong
  ws.send('WS_OK');
});
console.log(`[WS] 服务器已在 ws://127.0.0.1:${wsPort} 启动`);

// ----------------------
// 客户端检测逻辑
// ----------------------
const fetch = require('node-fetch'); // 需要 npm install node-fetch
const client = {
  async httpPing() {
    try {
      const res = await fetch(`http://127.0.0.1:${httpPort}/status`);
      const data = await res.json();
      console.log(`[HTTP Ping] 成功:`, data);
    } catch (e) {
      console.error(`[HTTP Ping] 失败:`, e.message);
    }
  },

  async tcpPing() {
    return new Promise((resolve) => {
      const client = new net.Socket();
      client.setTimeout(2000);
      client.connect(tcpPort, '127.0.0.1', () => {
        client.once('data', (data) => {
          console.log(`[TCP Ping] 成功:`, data.toString().trim());
          client.destroy();
          resolve();
        });
      });
      client.on('error', (err) => {
        console.error(`[TCP Ping] 失败:`, err.message);
        resolve();
      });
      client.on('timeout', () => {
        console.error(`[TCP Ping] 失败: 连接超时`);
        client.destroy();
        resolve();
      });
    });
  },

  async udpPing() {
    return new Promise((resolve) => {
      const client = dgram.createSocket('udp4');
      const msg = Buffer.from('HELLO');
      client.send(msg, udpPort, '127.0.0.1', (err) => {
        if (err) {
          console.error(`[UDP Ping] 发送失败:`, err.message);
          client.close();
          return resolve();
        }
      });

      client.on('message', (msg, rinfo) => {
        console.log(`[UDP Ping] 成功:`, msg.toString());
        client.close();
        resolve();
      });

      client.setTimeout(2000, () => {
        console.error(`[UDP Ping] 失败: 超时`);
        client.close();
        resolve();
      });
    });
  },

  async wsPing() {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      ws.on('open', () => {
        console.log('[WS Ping] 连接已打开');
        ws.ping();
      });
      ws.on('pong', () => {
        console.log('[WS Ping] 收到 pong，状态正常');
        ws.close();
        resolve();
      });
      ws.on('message', (msg) => {
        console.log('[WS Ping] 收到服务器消息:', msg);
      });
      ws.on('error', (err) => {
        console.error('[WS Ping] 连接错误:', err.message);
        resolve();
      });
      ws.on('close', () => {
        resolve();
      });
      setTimeout(() => {
        console.error('[WS Ping] 失败: 超时');
        ws.terminate();
        resolve();
      }, 2000);
    });
  },

  async runAll() {
    await this.httpPing();
    await this.tcpPing();
    await this.udpPing();
    await this.wsPing();
    console.log('所有检测完成。');
  },
};

client.runAll();