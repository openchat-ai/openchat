// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:43:06.583Z

// filename: sibling-status-check.js
// 使用 CommonJS (require) 编写，可直接 `node sibling-status-check.js` 运行

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const redis = require('redis');

// ---------- 配置 ----------
const CONFIG = {
  // 1. TCP 检测目标
  tcp: { host: '127.0.0.1', port: 3000 },

  // 2. UDP 检测目标
  udp: { host: '127.0.0.1', port: 4000, timeout: 2000 },

  // 3. Unix Domain Socket 路径
  unixSocket: path.join(__dirname, 'sibling.sock'),

  // 4. Redis 配置
  redis: { host: '127.0.0.1', port: 6379 },

  // 5. 心跳文件路径（用于文件心跳检测）
  heartbeatFile: path.join(__dirname, 'sibling.heartbeat')
};

// ---------- 1. TCP 端口探活 ----------
function checkTcp() {
  return new Promise((resolve) => {
    const socket = net.connect(CONFIG.tcp.port, CONFIG.tcp.host);
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ method: 'TCP', alive: false, reason: 'timeout' });
    }, 2000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolve({ method: 'TCP', alive: true });
    });

    socket.once('error', (err) => {
      clearTimeout(timeout);
      resolve({ method: 'TCP', alive: false, reason: err.message });
    });
  });
}

// ---------- 2. UDP 心跳 ----------
function checkUdp() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('ping');
    let responded = false;

    const timer = setTimeout(() => {
      client.close();
      if (!responded) resolve({ method: 'UDP', alive: false, reason: 'no response' });
    }, CONFIG.udp.timeout);

    client.once('message', (msg, rinfo) => {
      responded = true;
      clearTimeout(timer);
      client.close();
      resolve({ method: 'UDP', alive: true, reply: msg.toString() });
    });

    client.send(message, CONFIG.udp.port, CONFIG.udp.host, (err) => {
      if (err) {
        clearTimeout(timer);
        client.close();
        resolve({ method: 'UDP', alive: false, reason: err.message });
      }
    });
  });
}

// ---------- 3. Unix Domain Socket ----------
function checkUnixSocket() {
  return new Promise((resolve) => {
    const client = net.createConnection({ path: CONFIG.unixSocket }, () => {
      client.end();
      resolve({ method: 'UnixSocket', alive: true });
    });

    client.once('error', (err) => {
      resolve({ method: 'UnixSocket', alive: false, reason: err.message });
    });

    // 防止无限挂起
    setTimeout(() => {
      client.destroy();
      resolve({ method: 'UnixSocket', alive: false, reason: 'timeout' });
    }, 2000);
  });
}

// ---------- 4. Redis Pub/Sub ----------
function checkRedis() {
  return new Promise((resolve) => {
    const subscriber = redis.createClient(CONFIG.redis);
    const publisher = redis.createClient(CONFIG.redis);
    const channel = 'sibling:heartbeat';
    let responded = false;

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ method: 'Redis', alive: false, reason: 'no reply' });
    }, 3000);

    function cleanup() {
      subscriber.unsubscribe();
      subscriber.quit();
      publisher.quit();
      clearTimeout(timeout);
    }

    subscriber.on('message', (chan, message) => {
      if (chan === channel && message === 'pong') {
        responded = true;
        cleanup();
        resolve({ method: 'Redis', alive: true });
      }
    });

    subscriber.subscribe(channel, (err) => {
      if (err) {
        cleanup();
        resolve({ method: 'Redis', alive: false, reason: err.message });
        return;
      }
      // 发送 ping，期待其它实例监听后回 pong
      publisher.publish(channel, 'ping');
    });
  });
}

// ---------- 5. Node.js IPC (父子进程) ----------
function checkIpc() {
  return new Promise((resolve) => {
    // 创建一个子进程，子进程会在 500ms 后回复
    const child = spawn(process.execPath, [path.join(__dirname, 'ipc-child.js')], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });

    const timer = setTimeout(() => {
      child.kill();
      resolve({ method: 'IPC', alive: false, reason: 'no reply' });
    }, 2000);

    child.on('message', (msg) => {
      if (msg === 'alive') {
        clearTimeout(timer);
        child.kill();
        resolve({ method: 'IPC', alive: true });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ method: 'IPC', alive: false, reason: err.message });
    });
  });
}

// ---------- 6. 文件心跳 ----------
function checkFileHeartbeat() {
  return new Promise((resolve) => {
    fs.stat(CONFIG.heartbeatFile, (err, stats) => {
      if (err) {
        resolve({ method: 'FileHeartbeat', alive: false, reason: 'file not found' });
        return;
      }
      const mtime = new Date(stats.mtime);
      const now = new Date();
      const diffSec = (now - mtime) / 1000;
      // 认为 10 秒以内的修改表示存活
      const alive = diffSec < 10;
      resolve({
        method: 'FileHeartbeat',
        alive,
        lastModified: mtime.toISOString(),
        diffSec: diffSec.toFixed(1)
      });
    });
  });
}

// ---------- 主流程 ----------
async function runChecks() {
  console.log('=== 实例间状态检测研究 ===\n');

  // 为演示准备：启动一个临时的 Unix socket 服务器和 UDP 回显服务器
  startTempUnixServer();
  startTempUdpEcho();

  const results = await Promise.all([
    checkTcp(),
    checkUdp(),
    checkUnixSocket(),
    checkRedis(),
    checkIpc(),
    checkFileHeartbeat()
  ]);

  results.forEach(r => {
    console.log(`[${r.method}] alive: ${r.alive}` +
      (r.reason ? `, reason: ${r.reason}` : '') +
      (r.lastModified ? `, lastModified: ${r.lastModified}` : '') +
      (r.diffSec ? `, diffSec: ${r.diffSec}` : '') +
      (r.reply ? `, reply: ${r.reply}` : '')
    );
  });

  console.log('\n研究结论：');
  results.forEach(r => {
    console.log(`- ${r.method}: ${r.alive ? '✔️ 可行' : '❌ 不可行'}${r.reason ? `（${r.reason}）` : ''}`);
  });

  // 关闭临时服务器
  stopTempServers();
}

// ---------- 辅助：临时 Unix socket 服务器 ----------
let unixServer;
function startTempUnixServer() {
  // 删除残留的 socket 文件（若存在）
  try { fs.unlinkSync(CONFIG.unixSocket); } catch (_) {}
  unixServer = net.createServer(conn => {
    conn.end('pong');
  }).listen(CONFIG.unixSocket);
}

// ---------- 辅助：临时 UDP 回显服务器 ----------
let udpServer;
function startTempUdpEcho() {
  udpServer = dgram.createSocket('udp4');
  udpServer.on('message', (msg, rinfo) => {
    // 简单回显
    udpServer.send(Buffer.from('pong'), rinfo.port, rinfo.address);
  });
  udpServer.bind(CONFIG.udp.port);
}

// ---------- 辅助：关闭临时服务器 ----------
function stopTempServers() {
  if (unixServer) unixServer.close(() => { try { fs.unlinkSync(CONFIG.unixSocket); } catch (_) {} });
  if (udpServer) udpServer.close();
}

// ---------- 启动 ----------
runChecks().catch(err => console.error('运行时错误:', err));