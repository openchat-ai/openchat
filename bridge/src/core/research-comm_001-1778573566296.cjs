// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:12:46.296Z

// index.js
// 运行方式：node index.js
// 该文件会启动四个子进程，分别通过不同 IPC 手段提供 “heartbeat” 服务，随后主进程依次检测它们的存活状态。

const { fork } = require('child_process');
const path = require('path');
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const redis = require('redis');

// ---------------------------
// 1. 启动子进程（四种实现）
// ---------------------------
const workers = [
  { name: 'TCP', script: 'worker-tcp.js' },
  { name: 'UDP', script: 'worker-udp.js' },
  { name: 'UNIX', script: 'worker-unix.js' },
  { name: 'REDIS', script: 'worker-redis.js' },
];

const childProcs = workers.map(w => {
  const cp = fork(path.join(__dirname, w.script), [], {
    env: { WORKER_NAME: w.name },
    stdio: 'inherit',
  });
  cp.on('error', err => console.error(`[${w.name}] child error:`, err));
  return { name: w.name, proc: cp };
});

// 给子进程一点时间完成监听初始化
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// ---------------------------
// 2. 检测实现
// ---------------------------
async function checkTCP() {
  return new Promise(resolve => {
    const client = net.createConnection({ host: '127.0.0.1', port: 4000 }, () => {
      client.write('ping');
    });
    client.setTimeout(1000);
    client.once('data', data => {
      resolve(data.toString() === 'OK');
      client.end();
    });
    client.once('error', () => resolve(false));
    client.once('timeout', () => {
      client.destroy();
      resolve(false);
    });
  });
}

async function checkUDP() {
  return new Promise(resolve => {
    const client = dgram.createSocket('udp4');
    const msg = Buffer.from('ping');
    client.send(msg, 0, msg.length, 4001, '127.0.0.1', err => {
      if (err) return resolve(false);
    });
    client.on('message', (msg) => {
      resolve(msg.toString() === 'OK');
      client.close();
    });
    client.on('error', () => {
      resolve(false);
      client.close();
    });
    setTimeout(() => {
      resolve(false);
      client.close();
    }, 1000);
  });
}

async function checkUnix() {
  return new Promise(resolve => {
    const socketPath = '/tmp/sibling.sock';
    const client = net.createConnection(socketPath, () => {
      client.write('ping');
    });
    client.setTimeout(1000);
    client.once('data', data => {
      resolve(data.toString() === 'OK');
      client.end();
    });
    client.once('error', () => resolve(false));
    client.once('timeout', () => {
      client.destroy();
      resolve(false);
    });
  });
}

async function checkRedis() {
  return new Promise(resolve => {
    const sub = redis.createClient();
    const pub = redis.createClient();

    const channel = 'sibling:heartbeat';
    let responded = false;

    sub.subscribe(channel, err => {
      if (err) return resolve(false);
    });

    sub.on('message', (ch, message) => {
      if (ch === channel && message === 'pong') {
        responded = true;
        cleanup();
        resolve(true);
      }
    });

    // 发送 ping
    pub.publish(channel, 'ping');

    // 超时判定
    const timer = setTimeout(() => {
      if (!responded) {
        cleanup();
        resolve(false);
      }
    }, 1000);

    function cleanup() {
      clearTimeout(timer);
      sub.unsubscribe();
      sub.quit();
      pub.quit();
    }
  });
}

// ---------------------------
// 3. 主流程
// ---------------------------
(async () => {
  console.log('=== 实例间通讯方式研究 ===\n正在启动子进程并初始化监听...');
  await delay(1500); // 等待子进程完成监听

  const results = {};

  console.log('\n[1] 使用 TCP Socket 检测...');
  results.TCP = await checkTCP();
  console.log(`   → TCP 检测结果: ${results.TCP ? '存活' : '不可达'}`);

  console.log('\n[2] 使用 UDP Socket 检测...');
  results.UDP = await checkUDP();
  console.log(`   → UDP 检测结果: ${results.UDP ? '存活' : '不可达'}`);

  console.log('\n[3] 使用 Unix Domain Socket 检测...');
  results.UNIX = await checkUnix();
  console.log(`   → UNIX 检测结果: ${results.UNIX ? '存活' : '不可达'}`);

  console.log('\n[4] 使用 Redis Pub/Sub 检测...');
  try {
    results.REDIS = await checkRedis();
    console.log(`   → Redis 检测结果: ${results.REDIS ? '存活' : '不可达'}`);
  } catch (e) {
    console.log('   → Redis 检测异常（可能未启动 Redis）:', e.message);
    results.REDIS = false;
  }

  console.log('\n=== 检测汇总 ===');
  console.table(results);

  // 结束子进程
  childProcs.forEach(c => c.proc.kill());
  // 清理 Unix socket 文件
  try { fs.unlinkSync('/tmp/sibling.sock'); } catch (_) {}
  process.exit(0);
})();