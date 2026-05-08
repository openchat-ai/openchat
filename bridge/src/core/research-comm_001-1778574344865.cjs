// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:25:44.865Z

/**
 * 研究实例间通讯方式
 * 除了 HTTP ping 之外，下面演示了 4 种常见的“心跳/状态检测”实现：
 *   1. TCP socket ping
 *   2. UDP 广播 ping
 *   3. WebSocket keep‑alive
 *   4. Redis Pub/Sub 信号
 *
 * 代码会在本机启动一个监听端口（或 UDP 地址），并在主进程里以客户端方式向之发送心跳。
 * 每种方式都会在控制台打印结果，帮助你快速了解它们的工作原理和可行性。
 *
 * 运行前请确保已安装必要依赖（如果需要）：
 *   npm install ws redis
 *
 * 运行：
 *   node inter_instance_communication.js
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const { createClient } = require('redis');

// ---------- 1. HTTP Ping ----------
function httpPing() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: 8080, path: '/', method: 'GET' },
      (res) => {
        res.on('data', () => { /* consume */ });
        res.on('end', () => resolve('HTTP: OK'));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ---------- 2. TCP Socket Ping ----------
function tcpPing() {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port: 9000 }, () => {
      client.write('PING');
    });
    client.on('data', (data) => {
      resolve(`TCP: ${data.toString()}`);
      client.end();
    });
    client.on('error', (err) => reject(err));
  });
}

// ---------- 3. UDP Broadcast Ping ----------
function udpPing() {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('PING');
    const PORT = 9001;
    const HOST = '255.255.255.255';

    client.send(message, 0, message.length, PORT, HOST, (err) => {
      if (err) {
        client.close();
        return reject(err);
      }
    });

    client.on('message', (msg, rinfo) => {
      resolve(`UDP: ${msg.toString()} from ${rinfo.address}`);
      client.close();
    });

    client.on('error', (err) => {
      client.close();
      reject(err);
    });

    // timeout after 3 seconds
    setTimeout(() => {
      client.close();
      reject(new Error('UDP: No response within timeout'));
    }, 3000);
  });
}

// ---------- 4. WebSocket Keep-Alive ----------
function wsPing() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:8081');
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'PING' }));
    });
    ws.on('message', (data) => {
      resolve(`WS: ${data}`);
      ws.close();
    });
    ws.on('error', reject);
    ws.on('close', () => { /* ignore */ });

    // timeout after 3 seconds
    setTimeout(() => {
      ws.terminate();
      reject(new Error('WS: No response within timeout'));
    }, 3000);
  });
}

// ---------- 5. Redis Pub/Sub ----------
async function redisPing() {
  const client = createClient();
  await client.connect();
  const channel = 'heartbeat';
  const subscriber = client.duplicate();
  await subscriber.connect();

  return new Promise((resolve, reject) => {
    subscriber.subscribe(channel, (msg) => {
      resolve(`Redis: ${msg}`);
      subscriber.unsubscribe();
      client.quit();
    });

    // Publisher sends after a short delay
    setTimeout(() => {
      client.publish(channel, 'PING');
    }, 500);

    // timeout after 3 seconds
    setTimeout(() => {
      subscriber.unsubscribe();
      client.quit();
      reject(new Error('Redis: No response within timeout'));
    }, 3000);
  });
}

// ---------- 启动本地服务 ----------
function startHttpServer() {
  return http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
  }).listen(8080, () => console.log('HTTP server listening on :8080'));
}

function startTcpServer() {
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      if (data.toString() === 'PING') socket.write('PONG');
    });
  });
  server.listen(9000, () => console.log('TCP server listening on :9000'));
}

function startUdpServer() {
  const server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    const response = Buffer.from('PONG');
    server.send(response, 0, response.length, rinfo.port, rinfo.address);
  });
  server.bind(9001, () => console.log('UDP server listening on :9001'));
}

function startWsServer() {
  const wss = new WebSocket.Server({ port: 8081 });
  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      if (JSON.parse(message).type === 'PING') {
        ws.send('PONG');
      }
    });
  });
  console.log('WebSocket server listening on :8081');
}

// ---------- 主程序 ----------
(async () => {
  // 启动所有服务
  startHttpServer();
  startTcpServer();
  startUdpServer();
  startWsServer();

  // 给服务一点时间启动
  await new Promise((r) => setTimeout(r, 500));

  // 逐个测试
  console.log('\n--- 开始测试实例间通讯方式 ---');

  try {
    const httpRes = await httpPing();
    console.log(httpRes);
  } catch (err) {
    console.error('HTTP ping 失败:', err.message);
  }

  try {
    const tcpRes = await tcpPing();
    console.log(tcpRes);
  } catch (err) {
    console.error('TCP ping 失败:', err.message);
  }

  try {
    const udpRes = await udpPing();
    console.log(udpRes);
  } catch (err) {
    console.error('UDP ping 失败:', err.message);
  }

  try {
    const wsRes = await wsPing();
    console.log(wsRes);
  } catch (err) {
    console.error('WS ping 失败:', err.message);
  }

  try {
    const redisRes = await redisPing();
    console.log(redisRes);
  } catch (err) {
    console.error('Redis ping 失败:', err.message);
  }

  console.log('\n--- 测试完成 ---');

  // 结束进程
  process.exit(0);
})();