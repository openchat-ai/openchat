// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:50:05.389Z

// instance-comm.js
// 运行环境：Node.js >= 12
// 依赖：npm i ws

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const { fork } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

// -------------------- 配置 --------------------
const PORTS = {
  http: 3000,
  tcp: 3001,
  udp: 3002,
  ws: 3003,
};
const TIMEOUT = 2000; // ms

// -------------------- 子进程代码 --------------------
// 为了保持单文件，这里把子进程的逻辑写成一个函数，父进程通过 fork 并传参启动同一文件
if (process.argv[2] === 'child') {
  const mode = process.argv[3]; // http|tcp|udp|ws
  switch (mode) {
    case 'http':
      http
        .createServer((req, res) => {
          if (req.method === 'GET' && req.url === '/ping') {
            res.writeHead(200);
            res.end('pong');
          } else {
            res.writeHead(404);
            res.end();
          }
        })
        .listen(PORTS.http, () => {
          console.log('[child][http] listening on', PORTS.http);
        });
      break;

    case 'tcp':
      net
        .createServer((socket) => {
          socket.on('data', (data) => {
            if (data.toString() === 'ping') {
              socket.write('pong');
            }
          });
        })
        .listen(PORTS.tcp, () => {
          console.log('[child][tcp] listening on', PORTS.tcp);
        });
      break;

    case 'udp':
      const udpServer = dgram.createSocket('udp4');
      udpServer.on('message', (msg, rinfo) => {
        if (msg.toString() === 'ping') {
          udpServer.send('pong', rinfo.port, rinfo.address);
        }
      });
      udpServer.bind(PORTS.udp, () => {
        console.log('[child][udp] listening on', PORTS.udp);
      });
      break;

    case 'ws':
      const wss = new WebSocket.Server({ port: PORTS.ws }, () => {
        console.log('[child][ws] listening on', PORTS.ws);
      });
      wss.on('connection', (ws) => {
        ws.on('message', (msg) => {
          if (msg === 'ping') ws.send('pong');
        });
      });
      break;

    default:
      console.error('unknown mode', mode);
      process.exit(1);
  }

  // 防止子进程退出
  process.on('SIGTERM', () => process.exit(0));
  return; // 子进程代码到此结束
}

// -------------------- 父进程（检测器） --------------------
async function checkHTTP() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORTS.http}/ping`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data === 'pong'));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(TIMEOUT, () => {
      req.abort();
      resolve(false);
    });
  });
}

function checkTCP() {
  return new Promise((resolve) => {
    const client = new net.Socket();
    let responded = false;

    client.setTimeout(TIMEOUT, () => {
      client.destroy();
      resolve(false);
    });

    client.connect(PORTS.tcp, '127.0.0.1', () => {
      client.write('ping');
    });

    client.on('data', (data) => {
      responded = data.toString() === 'pong';
      client.end();
    });

    client.on('close', () => resolve(responded));
    client.on('error', () => resolve(false));
  });
}

function checkUDP() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    let timeoutHandle;

    client.on('message', (msg) => {
      clearTimeout(timeoutHandle);
      client.close();
      resolve(msg.toString() === 'pong');
    });

    client.send('ping', PORTS.udp, '127.0.0.1', (err) => {
      if (err) {
        client.close();
        return resolve(false);
      }
      timeoutHandle = setTimeout(() => {
        client.close();
        resolve(false);
      }, TIMEOUT);
    });
  });
}

function checkWebSocket() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORTS.ws}`);

    const timer = setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, TIMEOUT);

    ws.on('open', () => ws.send('ping'));
    ws.on('message', (msg) => {
      clearTimeout(timer);
      ws.close();
      resolve(msg === 'pong');
    });
    ws.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// 启动四个子进程（每种协议各一个）
function launchServers() {
  const modes = ['http', 'tcp', 'udp', 'ws'];
  return modes.map((m) =>
    fork(__filename, ['child', m], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
  );
}

// 主流程
(async () => {
  console.log('=== 实例间通讯方式研究 ===\n');

  const children = launchServers();

  // 给服务器一点启动时间
  await new Promise((r) => setTimeout(r, 500));

  const results = await Promise.all([
    checkHTTP(),
    checkTCP(),
    checkUDP(),
    checkWebSocket(),
  ]);

  console.log('检测结果（true = 存活, false = 超时/错误）:');
  console.log('HTTP Ping :', results[0]);
  console.log('TCP Socket: ', results[1]);
  console.log('UDP Ping  :', results[2]);
  console.log('WebSocket :', results[3]);

  // 清理子进程
  children.forEach((cp) => cp.kill('SIGTERM'));
})();