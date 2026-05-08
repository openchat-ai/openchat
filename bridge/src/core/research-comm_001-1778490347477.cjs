// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:05:47.477Z

/**
 * 运行方式：
 *   node instance_heartbeat.js
 *
 * 需要安装依赖：
 *   npm install ws
 *
 * 说明：
 *   - 代码会在同一进程中启动服务器和客户端，演示四种健康检查方式。
 *   - 结果会打印到 console，展示每种方式的检测结果。
 */

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

// ---------- 1. TCP 服务器 ----------
const TCP_PORT = 9001;
const tcpServer = net.createServer((socket) => {
  socket.on('data', (msg) => {
    if (msg.toString() === 'ping') {
      socket.write('pong');
    }
  });
});
tcpServer.listen(TCP_PORT, () => {
  console.log(`✅ TCP 服务器已启动，监听 ${TCP_PORT} 端口`);
});

// ---------- 2. WebSocket 服务器 ----------
const WS_PORT = 9002;
const wss = new WebSocketServer({ port: WS_PORT });
wss.on('connection', (ws) => {
  ws.on('ping', () => {
    ws.pong();
  });
});
console.log(`✅ WebSocket 服务器已启动，监听 ${WS_PORT} 端口`);

// ---------- 3. UDP “心跳” ----------
const UDP_PORT = 9003;
const udpSocket = dgram.createSocket('udp4');
udpSocket.on('message', (msg, rinfo) => {
  if (msg.toString() === 'heartbeat') {
    const reply = Buffer.from('alive');
    udpSocket.send(reply, rinfo.port, rinfo.address);
  }
});
udpSocket.bind(UDP_PORT, () => {
  console.log(`✅ UDP 服务器已启动，监听 ${UDP_PORT} 端口`);
});

// ---------- 4. 本地文件健康标记 ----------
const HEALTH_FILE = path.join(__dirname, 'instance_health.txt');
fs.writeFileSync(HEALTH_FILE, 'OK', 'utf8');

// ---------- 客户端检测逻辑 ----------
(async () => {
  // 1) TCP ping
  const tcpClient = new net.Socket();
  const tcpResult = await new Promise((resolve) => {
    tcpClient.setTimeout(2000);
    tcpClient.once('error', () => resolve('❌ 连接失败'));
    tcpClient.once('timeout', () => resolve('❌ 超时'));
    tcpClient.connect(TCP_PORT, '127.0.0.1', () => {
      tcpClient.write('ping');
    });
    tcpClient.once('data', (data) => {
      resolve(data.toString() === 'pong' ? '✅ 成功' : '❌ 预期响应不符');
      tcpClient.end();
    });
  });

  // 2) WebSocket ping/pong
  const wsResult = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
    ws.on('open', () => {
      ws.ping();
    });
    ws.on('pong', () => resolve('✅ 成功'));
    ws.on('error', () => resolve('❌ 连接失败'));
    setTimeout(() => resolve('❌ 超时'), 2000);
  });

  // 3) UDP heartbeat
  const udpResult = await new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const msg = Buffer.from('heartbeat');
    client.send(msg, UDP_PORT, '127.0.0.1', (err) => {
      if (err) return resolve(`❌ 发送失败: ${err.message}`);
    });
    client.on('message', (msg) => {
      resolve(msg.toString() === 'alive' ? '✅ 成功' : '❌ 预期响应不符');
      client.close();
    });
    setTimeout(() => resolve('❌ 超时'), 2000);
  });

  // 4) 文件健康标记
  const fileResult = (() => {
    try {
      const content = fs.readFileSync(HEALTH_FILE, 'utf8').trim();
      return content === 'OK' ? '✅ 成功' : '❌ 标记异常';
    } catch (err) {
      return `❌ 读取错误: ${err.message}`;
    }
  })();

  // 输出结果
  console.log('\n=== 姐妹状态检测结果 ===');
  console.log(`1) TCP ping: ${tcpResult}`);
  console.log(`2) WebSocket ping/pong: ${wsResult}`);
  console.log(`3) UDP heartbeat: ${udpResult}`);
  console.log(`4) 本地文件健康标记: ${fileResult}`);
  console.log('============================\n');

  // 关闭服务器（演示完成后退出）
  tcpServer.close();
  wss.close();
  udpSocket.close();
  fs.unlinkSync(HEALTH_FILE); // 清理
})();