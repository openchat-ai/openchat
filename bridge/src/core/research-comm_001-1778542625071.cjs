// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:37:05.071Z

// file: instance-communication-study.js
// 运行方式：node instance-communication-study.js

const { execSync } = require('child_process');
const net = require('net');
const dgram = require('dgram');
const http = require('http');

// ---------- 1️⃣ 工具函数 ----------
function ensurePackage(pkg) {
  try {
    require.resolve(pkg);
  } catch (_) {
    console.log(`⚙️  安装缺失依赖: ${pkg} ...`);
    execSync(`npm install ${pkg} --silent`);
  }
}

// ---------- 2️⃣ 定义要检测的通信方式 ----------
const methods = [
  {
    name: 'TCP Socket',
    test: async () => {
      return new Promise((resolve) => {
        const server = net.createServer((socket) => {
          socket.end('ok');
        });
        server.listen(0, '127.0.0.1', () => {
          const port = server.address().port;
          const client = net.createConnection(port, '127.0.0.1', () => {
            client.on('data', (data) => {
              client.end();
              server.close();
              resolve(data.toString() === 'ok');
            });
          });
          client.on('error', () => {
            server.close();
            resolve(false);
          });
        });
        server.on('error', () => resolve(false));
      });
    },
  },
  {
    name: 'UDP Datagram',
    test: async () => {
      return new Promise((resolve) => {
        const server = dgram.createSocket('udp4');
        server.on('message', (msg, rinfo) => {
          server.send('pong', rinfo.port, rinfo.address, () => {
            server.close();
            resolve(true);
          });
        });
        server.bind(0, '127.0.0.1', () => {
          const port = server.address().port;
          const client = dgram.createSocket('udp4');
          client.send('ping', port, '127.0.0.1', (err) => {
            if (err) {
              client.close();
              server.close();
              resolve(false);
            }
          });
          client.on('message', (msg) => {
            client.close();
            resolve(msg.toString() === 'pong');
          });
          client.on('error', () => {
            client.close();
            server.close();
            resolve(false);
          });
        });
      });
    },
  },
  {
    name: 'WebSocket (ws)',
    test: async () => {
      ensurePackage('ws');
      const WebSocket = require('ws');
      return new Promise((resolve) => {
        const wss = new WebSocket.Server({ port: 0 }, () => {
          const port = wss.address().port;
          const ws = new WebSocket(`ws://127.0.0.1:${port}`);
          ws.on('open', () => ws.send('hello'));
          ws.on('message', (msg) => {
            ws.close();
            wss.close();
            resolve(msg === 'hello');
          });
          ws.on('error', () => {
            wss.close();
            resolve(false);
          });
        });
        wss.on('connection', (socket) => {
          socket.on('message', (msg) => socket.send(msg));
        });
        wss.on('error', () => resolve(false));
      });
    },
  },
  {
    name: 'Redis Pub/Sub',
    test: async () => {
      ensurePackage('redis');
      const redis = require('redis');
      return new Promise((resolve) => {
        const sub = redis.createClient();
        const pub = redis.createClient();
        sub.on('error', () => cleanup(false));
        pub.on('error', () => cleanup(false));

        sub.subscribe('test-channel', (err) => {
          if (err) return cleanup(false);
          pub.publish('test-channel', 'ping');
        });

        sub.on('message', (channel, message) => {
          cleanup(message === 'ping');
        });

        // 超时自动失败
        const timer = setTimeout(() => cleanup(false), 2000);

        function cleanup(success) {
          clearTimeout(timer);
          sub.quit();
          pub.quit();
          resolve(success);
        }
      });
    },
  },
  {
    name: 'ZeroMQ (REQ/REP)',
    test: async () => {
      ensurePackage('zeromq');
      const zmq = require('zeromq');
      return new Promise(async (resolve) => {
        const rep = new zmq.Reply();
        const req = new zmq.Request();

        try {
          await rep.bind('tcp://127.0.0.1:0');
          const addr = rep.lastEndpoint;
          await req.connect(addr);

          // 发送请求
          req.send('ping');

          // REP 端收到后回覆
          (async () => {
            const [msg] = await rep.receive();
            await rep.send(msg);
          })();

          // REQ 端收到回覆
          const [reply] = await req.receive();
          await rep.close();
          await req.close();
          resolve(reply.toString() === 'ping');
        } catch (e) {
          // 任意异常视为不可用
          try {
            await rep.close();
            await req.close();
          } catch (_) {}
          resolve(false);
        }
      });
    },
  },
];

// ---------- 3️⃣ 依次执行检测 ----------
(async () => {
  console.log('🔎 开始检测实例间可用的通讯方式（不含 HTTP ping）\n');
  const available = [];

  for (const m of methods) {
    try {
      const ok = await m.test();
      console.log(`${ok ? '✅' : '❌'} ${m.name}`);
      if (ok) available.push(m.name);
    } catch (e) {
      console.log(`❌ ${m.name} – 异常: ${e.message}`);
    }
  }

  console.log('\n📊 检测结束！当前环境可用的通讯方式有：');
  if (available.length === 0) {
    console.log('  (无)');
  } else {
    available.forEach((name) => console.log('  - ' + name));
  }
})();