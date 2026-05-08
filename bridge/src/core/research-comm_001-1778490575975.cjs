// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:09:35.975Z

/**
 * 实例间通讯方式研究
 * 运行方式：node sister_check.js
 * 依赖：npm i ws
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const { fork } = require('child_process');
const WebSocket = require('ws');

// ---------------------------
// 1. HTTP Ping（对比基准）
// ---------------------------
function startHttpServer(port) {
  const server = http.createServer((req, res) => {
    if (req.url === '/ping') {
      res.writeHead(200);
      res.end('pong');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => console.log(`[HTTP] server listening on ${port}`));
  return server;
}

// ---------------------------
// 2. TCP 长连接心跳
// ---------------------------
function startTcpServer(port) {
  const server = net.createServer((socket) => {
    socket.on('data', (buf) => {
      const msg = buf.toString();
      if (msg === 'ping') {
        socket.write('pong');
      }
    });
  });
  server.listen(port, () => console.log(`[TCP] server listening on ${port}`));
  return server;
}

// ---------------------------
// 3. UDP 心跳
// ---------------------------
function startUdpServer(port) {
  const server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    if (msg.toString() === 'ping') {
      server.send('pong', rinfo.port, rinfo.address);
    }
  });
  server.bind(port, () => console.log(`[UDP] server bound on ${port}`));
  return server;
}

// ---------------------------
// 4. WebSocket
// ---------------------------
function startWsServer(port) {
  const wss = new WebSocket.Server({ port }, () => {
    console.log(`[WS] server listening on ${port}`);
  });
  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      if (msg === 'ping') ws.send('pong');
    });
  });
  return wss;
}

// ---------------------------
// 5. IPC（fork 子进程）
// ---------------------------
function startIpcWorker() {
  // child.js 负责回应 ping
  const child = fork(__filename, ['--child']);
  child.on('message', (msg) => {
    // 父进程不在这里处理
  });
  return child;
}

// ---------------------------
// 子进程逻辑（仅在 fork 时运行）
// ---------------------------
if (process.argv.includes('--child')) {
  // 子进程充当 “姐妹实例”，只负责响应 ping
  process.on('message', (msg) => {
    if (msg === 'ping') {
      process.send('pong');
    }
  });
  // 为了防止子进程直接退出
  setInterval(() => {}, 1000);
  return; // 终止后续代码执行
}

// ---------------------------
// 主程序：启动服务并检测
// ---------------------------
(async () => {
  const HTTP_PORT = 3000;
  const TCP_PORT = 3001;
  const UDP_PORT = 3002;
  const WS_PORT = 3003;

  // 启动四种服务
  const httpSrv = startHttpServer(HTTP_PORT);
  const tcpSrv = startTcpServer(TCP_PORT);
  const udpSrv = startUdpServer(UDP_PORT);
  const wsSrv = startWsServer(WS_PORT);
  const ipcChild = startIpcWorker();

  // 等待服务准备好
  await new Promise((r) => setTimeout(r, 500));

  // ---------- 检测函数 ----------
  const results = {};

  // 1. HTTP Ping
  async function checkHttp() {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${HTTP_PORT}/ping`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data === 'pong'));
      });
      req.on('error', () => resolve(false));
    });
  }

  // 2. TCP Ping
  async function checkTcp() {
    return new Promise((resolve) => {
      const client = new net.Socket();
      client.setTimeout(1000);
      client.connect(TCP_PORT, '127.0.0.1', () => {
        client.write('ping');
      });
      client.on('data', (data) => {
        resolve(data.toString() === 'pong');
        client.destroy();
      });
      client.on('error', () => resolve(false));
      client.on('timeout', () => {
        resolve(false);
        client.destroy();
      });
    });
  }

  // 3. UDP Ping
  async function checkUdp() {
    return new Promise((resolve) => {
      const client = dgram.createSocket('udp4');
      const timeout = setTimeout(() => {
        client.close();
        resolve(false);
      }, 1000);
      client.on('message', (msg) => {
        clearTimeout(timeout);
        client.close();
        resolve(msg.toString() === 'pong');
      });
      client.send('ping', UDP_PORT, '127.0.0.1');
    });
  }

  // 4. WebSocket Ping
  async function checkWs() {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
      const timer = setTimeout(() => {
        ws.terminate();
        resolve(false);
      }, 1500);
      ws.on('open', () => ws.send('ping'));
      ws.on('message', (msg) => {
        clearTimeout(timer);
        resolve(msg === 'pong');
        ws.close();
      });
      ws.on('error', () => resolve(false));
    });
  }

  // 5. IPC Ping
  async function checkIpc() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 1000);
      ipcChild.once('message', (msg) => {
        clearTimeout(timeout);
        resolve(msg === 'pong');
      });
      ipcChild.send('ping');
    });
  }

  // 执行全部检查
  results.HTTP = await checkHttp();
  results.TCP = await checkTcp();
  results.UDP = await checkUdp();
  results.WebSocket = await checkWs();
  results.IPC = await checkIpc();

  console.log('\n=== 姐妹实例状态检测结果 ===');
  console.table(results);

  // 关闭所有服务（演示结束后退出进程）
  httpSrv.close();
  tcpSrv.close();
  udpSrv.close();
  wsSrv.close();
  ipcChild.kill();

  // 延迟退出，确保日志完整输出
  setTimeout(() => process.exit(0), 500);
})();