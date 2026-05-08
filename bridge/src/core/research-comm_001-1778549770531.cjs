// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:36:10.531Z

// sibling_status.js
// Node.js (CommonJS) 示例：多种进程间状态检测（除 HTTP ping 之外）

const { fork } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const redis = require('redis'); // 需要先 npm i redis

// ---------- 配置 ----------
const UNIX_SOCKET_PATH = path.join(__dirname, 'sister.sock');
const HEARTBEAT_INTERVAL = 2000; // ms
const HEARTBEAT_TIMEOUT = 5000;  // ms
const REDIS_CHANNEL = 'sister_heartbeat';

// ---------- 工具 ----------
function now() {
  return new Date().toISOString();
}

// ---------- 姐姐实现 ----------
function startSister() {
  console.log(`[${now()}] Sister process started (PID ${process.pid})`);

  // 1. IPC via parent-child (process.send)
  if (process.send) {
    setInterval(() => {
      process.send({ type: 'heartbeat', from: 'sister', ts: Date.now() });
    }, HEARTBEAT_INTERVAL);
  }

  // 2. Unix domain socket server
  // 删除残留的 socket 文件
  try { fs.unlinkSync(UNIX_SOCKET_PATH); } catch (_) {}
  const server = net.createServer(sock => {
    console.log(`[${now()}] Sister: socket client connected`);
    const timer = setInterval(() => {
      sock.write(`heartbeat:${Date.now()}\n`);
    }, HEARTBEAT_INTERVAL);
    sock.on('close', () => clearInterval(timer));
  });
  server.listen(UNIX_SOCKET_PATH, () => {
    console.log(`[${now()}] Sister: Unix socket listening at ${UNIX_SOCKET_PATH}`);
  });

  // 3. Shared memory via Worker + SharedArrayBuffer
  const sab = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const int32 = new Int32Array(sab);
  const worker = new Worker(__filename, {
    workerData: { role: 'shared_sister', sab }
  });
  // 主线程负责写心跳
  setInterval(() => {
    Atomics.store(int32, 0, Date.now());
    Atomics.notify(int32, 0, 1);
  }, HEARTBEAT_INTERVAL);

  // 4. Redis Pub/Sub
  const pub = redis.createClient();
  pub.connect().then(() => {
    console.log(`[${now()}] Sister: connected to Redis`);
    setInterval(() => {
      pub.publish(REDIS_CHANNEL, `${Date.now()}`);
    }, HEARTBEAT_INTERVAL);
  }).catch(err => console.error('Redis publish error', err));

  // 让进程保持运行
  process.on('SIGINT', () => {
    server.close();
    pub.quit();
    worker.terminate();
    process.exit();
  });
}

// ---------- 妹妹实现 ----------
function startBrother() {
  console.log(`[${now()}] Brother process started (PID ${process.pid})`);

  // 用于记录最近一次收到的时间戳
  const lastSeen = {
    ipc: 0,
    socket: 0,
    shared: 0,
    redis: 0,
  };

  // 1. IPC via parent-child (process.on('message'))
  process.on('message', msg => {
    if (msg.type === 'heartbeat' && msg.from === 'sister') {
      lastSeen.ipc = Date.now();
    }
  });

  // 2. Unix domain socket client
  const client = net.createConnection(UNIX_SOCKET_PATH, () => {
    console.log(`[${now()}] Brother: connected to sister's unix socket`);
  });
  client.setEncoding('utf8');
  client.on('data', data => {
    // 数据可能一次收到多行，逐行处理
    data.split('\n').forEach(line => {
      if (line.startsWith('heartbeat:')) {
        lastSeen.socket = Date.now();
      }
    });
  });
  client.on('error', err => {
    console.error(`[${now()}] Brother: socket error`, err.message);
  });

  // 3. Shared memory via Worker + SharedArrayBuffer
  const sab = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const int32 = new Int32Array(sab);
  const sharedWorker = new Worker(__filename, {
    workerData: { role: 'shared_brother', sab }
  });
  // 监听共享内存的变化
  setInterval(() => {
    const ts = Atomics.load(int32, 0);
    if (ts !== 0) lastSeen.shared = Date.now();
  }, 500);

  // 4. Redis Pub/Sub
  const sub = redis.createClient();
  sub.connect().then(() => {
    console.log(`[${now()}] Brother: connected to Redis`);
    sub.subscribe(REDIS_CHANNEL, msg => {
      // msg 为时间戳字符串
      lastSeen.redis = Date.now();
    });
  }).catch(err => console.error('Redis sub error', err));

  // 定时检查各通道的超时
  setInterval(() => {
    const nowTs = Date.now();
    function check(name, last) {
      const ok = nowTs - last <= HEARTBEAT_TIMEOUT;
      console.log(`[${now()}] ${name} status: ${ok ? 'ALIVE' : 'DEAD'} (last ${nowTs - last} ms)`);
    }
    check('IPC', lastSeen.ipc);
    check('UnixSocket', lastSeen.socket);
    check('SharedMemory', lastSeen.shared);
    check('RedisPubSub', lastSeen.redis);
    console.log('---');
  }, HEARTBEAT_INTERVAL);
}

// ---------- Worker 代码（共享内存） ----------
if (!isMainThread && (workerData.role === 'shared_sister' || workerData.role === 'shared_brother')) {
  // 这里不需要额外逻辑，父进程直接写/读 SharedArrayBuffer
  // 为了让 Worker 持续存活，阻塞在一个 never‑ending promise
  (async () => {
    await new Promise(() => {}); // keep alive
  })();
  return;
}

// ---------- 主入口 ----------
if (process.argv[2] === 'sister') {
  startSister();
} else if (process.argv[2] === 'brother') {
  startBrother();
} else {
  // 父进程：fork 两个子进程分别扮演 sister / brother
  console.log(`[${now()}] Master process (PID ${process.pid}) launching sibling processes...`);
  const sister = fork(__filename, ['sister']);
  const brother = fork(__filename, ['brother']);

  // 将 sister 的 IPC 句柄转发给 brother（模拟跨进程的 IPC）
  sister.on('message', msg => brother.send(msg));

  // 让主进程保持运行，捕获退出信号后清理
  process.on('SIGINT', () => {
    console.log('\nMaster shutting down...');
    sister.kill();
    brother.kill();
    try { fs.unlinkSync(UNIX_SOCKET_PATH); } catch (_) {}
    process.exit();
  });
}