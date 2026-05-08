// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:56:08.978Z

// file: instance-communication-demo.js
// 运行方式：node instance-communication-demo.js

const http = require('http');
const net = require('net');
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');

// -------------------------------------------------
// 1️⃣ 子进程代码（模拟姐妹实例）
// -------------------------------------------------
const childScript = `
  const http = require('http');
  const net = require('net');
  const Redis = require('ioredis');
  const fs = require('fs');
  const path = require('path');

  // ---------- HTTP ----------
  const httpPort = process.argv[2];
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/ping') {
      res.end('pong');
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  httpServer.listen(httpPort, () => {
    // console.log('HTTP server listening', httpPort);
  });

  // ---------- TCP ----------
  const tcpPort = Number(process.argv[3]);
  const tcpServer = net.createServer(socket => {
    socket.on('data', data => {
      if (data.toString().trim() === 'PING') {
        socket.write('PONG');
      }
    });
  });
  tcpServer.listen(tcpPort, () => {
    // console.log('TCP server listening', tcpPort);
  });

  // ---------- Redis ----------
  const redis = new Redis();
  const sub = new Redis();
  const pub = new Redis();
  sub.subscribe('ping_channel', () => {});
  sub.on('message', (ch, msg) => {
    if (msg === 'ping') pub.publish('pong_channel', 'pong');
  });

  // ---------- 文件 ----------
  const lockFile = path.join(__dirname, 'instance_' + process.pid + '.lock');
  setInterval(() => {
    // 每秒更新一次锁文件的修改时间，表示 “我活着”
    fs.writeFileSync(lockFile, Date.now().toString());
  }, 1000);

  // ---------- IPC ----------
  process.on('message', msg => {
    if (msg === 'ping') process.send('pong');
  });
`;

const childPath = path.join(__dirname, 'sister-instance.js');
fs.writeFileSync(childPath, childScript);

// -------------------------------------------------
// 2️⃣ 启动两台“姐妹实例”
// -------------------------------------------------
const sisterA = fork(childPath, ['3001', '4001']);
const sisterB = fork(childPath, ['3002', '4002']);

// 记录实例信息
const instances = [
  { name: 'SisterA', httpPort: 3001, tcpPort: 4001, pid: sisterA.pid, proc: sisterA },
  { name: 'SisterB', httpPort: 3002, tcpPort: 4002, pid: sisterB.pid, proc: sisterB },
];

// -------------------------------------------------
// 3️⃣ 检测函数集合
// -------------------------------------------------
function httpPing(inst) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${inst.httpPort}/ping`, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve(data.trim() === 'pong'));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.abort();
      resolve(false);
    });
  });
}

function tcpPing(inst) {
  return new Promise(resolve => {
    const client = net.createConnection({ port: inst.tcpPort }, () => {
      client.write('PING');
    });
    client.setTimeout(1000);
    client.on('data', data => {
      resolve(data.toString().trim() === 'PONG');
      client.end();
    });
    client.on('error', () => resolve(false));
    client.on('timeout', () => {
      client.destroy();
      resolve(false);
    });
  });
}

function ipcPing(inst) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve(false), 1000);
    const handler = msg => {
      if (msg === 'pong') {
        clearTimeout(timeout);
        resolve(true);
      }
    };
    inst.proc.once('message', handler);
    inst.proc.send('ping');
  });
}

function redisPing(inst) {
  return new Promise(async resolve => {
    const sub = new Redis();
    const pub = new Redis();
    const timeout = setTimeout(() => {
      sub.disconnect();
      pub.disconnect();
      resolve(false);
    }, 1500);

    await sub.subscribe('pong_channel');
    sub.on('message', (ch, msg) => {
      if (msg === 'pong') {
        clearTimeout(timeout);
        sub.disconnect();
        pub.disconnect();
        resolve(true);
      }
    });

    // 触发 ping
    await pub.publish('ping_channel', 'ping');
  });
}

function filePing(inst) {
  return new Promise(resolve => {
    const lockFile = path.join(__dirname, `instance_${inst.pid}.lock`);
    fs.stat(lockFile, (err, stats) => {
      if (err) return resolve(false);
      const ageSec = (Date.now() - stats.mtimeMs) / 1000;
      resolve(ageSec < 2); // 最近 2 秒内有更新即认为存活
    });
  });
}

// -------------------------------------------------
// 4️⃣ 主流程：依次对每个实例执行所有检测方式
// -------------------------------------------------
async function runChecks() {
  console.log('=== 实例间通讯方式研究报告 ===\n');

  for (const inst of instances) {
    console.log(`-- ${inst.name} (PID=${inst.pid}) --`);
    const results = await Promise.all([
      httpPing(inst),
      tcpPing(inst),
      ipcPing(inst),
      redisPing(inst).catch(() => false), // 防止 Redis 未启动导致未捕获异常
      filePing(inst),
    ]);

    const methods = ['HTTP Ping', 'TCP Socket', 'IPC (process.send)', 'Redis Pub/Sub', '文件锁'];
    results.forEach((ok, idx) => {
      console.log(` ${methods[idx]}: ${ok ? '✅ 可用' : '❌ 不可用'}`);
    });
    console.log('');
  }

  // 结束子进程
  sisterA.kill();
  sisterB.kill();
  // 清理临时文件
  fs.unlinkSync(childPath);
  instances.forEach(inst => {
    const lockFile = path.join(__dirname, `instance_${inst.pid}.lock`);
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
  });
}

runChecks();