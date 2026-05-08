// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:47:37.612Z

// sister_status.js
// Node.js (CommonJS) 示例：多种实例间状态检测方式
// 运行方式：node sister_status.js

const { fork } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
let redisAvailable = false;
let redis = null;

// ---------- 1. 检查 Redis 是否可用 ----------
(async () => {
  try {
    redis = require('redis');
    const client = redis.createClient();
    await client.connect();
    await client.ping();
    redisAvailable = true;
    await client.disconnect();
  } catch (e) {
    console.log('[Info] Redis not available, Redis Pub/Sub will be skipped.');
  }
  startMaster();
})();

// ---------- 2. 子进程代码（每个实例的实现） ----------
const childScript = `
  const net = require('net');
  const fs = require('fs');
  const path = require('path');
  const processId = process.argv[2]; // 0~4
  const methods = ['tcp', 'uds', 'ipc', 'redis', 'file'];
  const chosen = methods[processId];
  const HEARTBEAT = 2000; // ms

  // 统一的心跳发送函数
  function sendHeartbeat(info) {
    if (process.send) {
      // IPC (父子进程) 方式
      process.send({ id: processId, method: 'ipc', info });
    }
  }

  // 1) TCP Socket 心跳（父进程监听 4000+id 端口）
  if (chosen === 'tcp') {
    const client = new net.Socket();
    client.connect(4000 + Number(processId), '127.0.0.1', () => {
      setInterval(() => {
        client.write(JSON.stringify({ id: processId, ts: Date.now() }));
      }, HEARTBEAT);
    });
    client.on('error', err => {
      console.error('[TCP child] error', err.message);
    });
  }

  // 2) Unix Domain Socket 心跳
  else if (chosen === 'uds') {
    const socketPath = path.join(__dirname, 'uds_' + processId + '.sock');
    const client = new net.Socket();
    client.connect(socketPath, () => {
      setInterval(() => {
        client.write(JSON.stringify({ id: processId, ts: Date.now() }));
      }, HEARTBEAT);
    });
    client.on('error', err => {
      console.error('[UDS child] error', err.message);
    });
  }

  // 3) IPC 心跳（直接使用 process.send）
  else if (chosen === 'ipc') {
    setInterval(() => {
      sendHeartbeat({ ts: Date.now() });
    }, HEARTBEAT);
  }

  // 4) Redis Pub/Sub 心跳
  else if (chosen === 'redis') {
    (async () => {
      try {
        const redis = require('redis');
        const pub = redis.createClient();
        await pub.connect();
        setInterval(async () => {
          await pub.publish('sister_heartbeat', JSON.stringify({ id: processId, ts: Date.now() }));
        }, HEARTBEAT);
      } catch (e) {
        console.error('[Redis child] cannot connect', e.message);
      }
    })();
  }

  // 5) 文件锁/状态文件心跳
  else if (chosen === 'file') {
    const statusFile = path.join(__dirname, 'sister_' + processId + '.status');
    setInterval(() => {
      fs.writeFileSync(statusFile, String(Date.now()));
    }, HEARTBEAT);
  }
`;

// ---------- 3. 父进程（监控） ----------
function startMaster() {
  const sisters = {}; // {id: {method, lastSeen}}
  const HEARTBEAT_TIMEOUT = 5000; // ms

  // 1) 启动 TCP 监听端口
  for (let i = 0; i < 5; i++) {
    const port = 4000 + i;
    const server = net.createServer(socket => {
      socket.on('data', data => {
        try {
          const msg = JSON.parse(data.toString());
          updateStatus(msg.id, 'tcp');
        } catch (e) {}
      });
    });
    server.listen(port, '127.0.0.1');
  }

  // 2) 启动 UDS 监听
  for (let i = 0; i < 5; i++) {
    const udsPath = path.join(__dirname, 'uds_' + i + '.sock');
    // 删除旧的 socket 文件
    if (fs.existsSync(udsPath)) fs.unlinkSync(udsPath);
    const server = net.createServer(socket => {
      socket.on('data', data => {
        try {
          const msg = JSON.parse(data.toString());
          updateStatus(msg.id, 'uds');
        } catch (e) {}
      });
    });
    server.listen(udsPath);
  }

  // 3) 启动 IPC 监听（子进程会自动通过 process.send 发送）
  // 4) 启动 Redis 订阅（如果可用）
  let redisSub = null;
  if (redisAvailable) {
    (async () => {
      redisSub = redis.createClient();
      await redisSub.connect();
      await redisSub.subscribe('sister_heartbeat', msg => {
        try {
          const data = JSON.parse(msg);
          updateStatus(data.id, 'redis');
        } catch (e) {}
      });
    })();
  }

  // 5) 文件状态轮询
  const fileWatchers = {};
  function pollFile(id) {
    const file = path.join(__dirname, 'sister_' + id + '.status');
    fs.watchFile(file, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        updateStatus(id, 'file');
      }
    });
    fileWatchers[id] = true;
  }

  // 统一状态更新函数
  function updateStatus(id, method) {
    sisters[id] = { method, lastSeen: Date.now() };
  }

  // 启动 5 个子进程，每个使用不同的方式
  for (let i = 0; i < 5; i++) {
    const child = fork('-e', [], { execArgv: [], stdio: 'inherit', env: {} });
    // 通过 `eval` 方式运行子脚本
    child.send({ script: childScript, args: [i] });
    child.on('message', msg => {
      // IPC 消息
      if (msg && typeof msg.id === 'number') {
        updateStatus(msg.id, 'ipc');
      }
    });
    // 让子进程执行脚本
    child.on('spawn', () => {
      child.send({ run: true });
    });
  }

  // 让子进程真正执行代码（因为我们用了 fork 并通过 message 传递脚本）
  process.on('message', data => {
    if (data && data.script) {
      // eslint-disable-next-line no-eval
      eval(data.script);
    }
  });

  // 启动文件轮询（只针对 file 方法的实例）
  pollFile(4); // id=4 使用 file 方法

  // 定时打印当前状态快照
  setInterval(() => {
    console.clear();
    console.log('=== Sisters 状态快照 (每' + HEARTBEAT_TIMEOUT / 1000 + '秒刷新) ===');
    for (let i = 0; i < 5; i++) {
      const info = sisters[i];
      if (info) {
        const alive = Date.now() - info.lastSeen < HEARTBEAT_TIMEOUT ? '✅ Alive' : '❌ Timeout';
        console.log(`Sister #${i} | 方法: ${info.method.padEnd(5)} | 最后收到: ${new Date(info.lastSeen).toLocaleTimeString()} | ${alive}`);
      } else {
        console.log(`Sister #${i} | 未收到任何心跳`);
      }
    }
    console.log('\\n(提示：可以用 Ctrl+C 停止程序)');
  }, 2000);
}