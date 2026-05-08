// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:21:22.174Z

/**
 * Sisters 状态检测示例
 * 1. TCP 端口探测
 * 2. UDP 广播/组播
 * 3. Redis Pub/Sub
 * 4. 共享文件系统
 */
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');

let redis;
try {
  redis = require('redis');
} catch (_) {
  console.warn('redis 模块未安装，Redis 检测将被跳过。');
}

/* ---------- 1. 配置 ---------- */
const TARGET_PORT = 3000;          // 假设姐妹实例监听的 TCP 端口
const UDP_PORT = 5555;             // 用于 UDP 广播的端口
const UDP_TIMEOUT = 2000;          // UDP 响应超时（ms）
const FILE_DIR = '/tmp/sisters';   // 共享文件夹路径
const FILE_NAME = 'sisters_alive.txt';
const REDIS_CHANNEL = 'sisters_alive';
const REDIS_HOST = '127.0.0.1';
const REDIS_PORT = 6379;

/* ---------- 2. TCP 端口探测 ---------- */
function tcpPing(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let finished = false;
    socket.setTimeout(timeout);
    socket.once('connect', () => {
      finished = true;
      socket.destroy();
      resolve({ host, port, status: 'alive', method: 'TCP' });
    });
    socket.once('timeout', () => {
      if (!finished) {
        socket.destroy();
        resolve({ host, port, status: 'timeout', method: 'TCP' });
      }
    });
    socket.once('error', (err) => {
      if (!finished) {
        socket.destroy();
        resolve({ host, port, status: err.code, method: 'TCP' });
      }
    });
    socket.connect(port, host);
  });
}

/* ---------- 3. UDP 广播/组播 ---------- */
function udpPing(host, port, message = 'sisters_ping', timeout = UDP_TIMEOUT) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const msg = Buffer.from(message);
    const responses = new Set();

    client.once('message', (msg, rinfo) => {
      responses.add(rinfo.address);
    });

    client.send(msg, 0, msg.length, port, host, (err) => {
      if (err) {
        client.close();
        resolve({ host, port, status: err.code, method: 'UDP' });
      }
    });

    setTimeout(() => {
      client.close();
      resolve({
        host,
        port,
        status: responses.size ? 'alive' : 'no_response',
        method: 'UDP',
      });
    }, timeout);
  });
}

/* ---------- 4. Redis Pub/Sub ---------- */
function redisPing() {
  if (!redis) return Promise.resolve(null);
  const client = redis.createClient({ host: REDIS_HOST, port: REDIS_PORT });

  return new Promise((resolve) => {
    client.on('error', (err) => {
      client.quit();
      resolve({ status: `redis_error_${err.code}`, method: 'Redis' });
    });

    client.on('ready', () => {
      // 订阅频道，等待 1 秒查看是否收到任何消息
      client.subscribe(REDIS_CHANNEL);
      const timer = setTimeout(() => {
        client.unsubscribe();
        client.quit();
        resolve({ status: 'no_peer', method: 'Redis' });
      }, 1000);

      client.on('message', (channel, message) => {
        if (channel === REDIS_CHANNEL && message !== 'self') {
          clearTimeout(timer);
          client.unsubscribe();
          client.quit();
          resolve({ status: 'alive', method: 'Redis' });
        }
      });

      // 同时发布自己的 alive 消息
      client.publish(REDIS_CHANNEL, 'self');
    });
  });
}

/* ---------- 5. 共享文件系统 ---------- */
function filePing() {
  const filePath = path.join(FILE_DIR, FILE_NAME);
  try {
    const stats = fs.statSync(filePath);
    const mtime = new Date(stats.mtime);
    const now = new Date();
    if (now - mtime < 2000) {
      return { status: 'alive', method: 'File' };
    }
  } catch (_) {
    // 文件不存在
  }
  return { status: 'no_peer', method: 'File' };
}

function fileWrite() {
  if (!fs.existsSync(FILE_DIR)) fs.mkdirSync(FILE_DIR, { recursive: true });
  const filePath = path.join(FILE_DIR, FILE_NAME);
  fs.writeFileSync(filePath, `Alive at ${new Date().toISOString()}\n`);
}

/* ---------- 6. 主流程 ---------- */
async function main() {
  console.log('=== Sisters 状态检测开始 ===');

  // 1. 写入自身状态文件（共享文件法）
  fileWrite();

  // 2. TCP Ping
  const localIP = Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => !iface.internal && iface.family === 'IPv4')
    .map((iface) => iface.address)[0];

  const tcpResult = await tcpPing(localIP, TARGET_PORT);
  console.log('TCP 结果:', tcpResult);

  // 3. UDP Ping
  const udpResult = await udpPing(localIP, UDP_PORT);
  console.log('UDP 结果:', udpResult);

  // 4. Redis Ping
  const redisResult = await redisPing();
  if (redisResult) console.log('Redis 结果:', redisResult);
  else console.log('Redis 未配置，跳过。');

  // 5. 文件系统检查
  const fileResult = filePing();
  console.log('文件系统结果:', fileResult);

  console.log('=== 检测完成 ===');
}

main().catch((err) => console.error('检测过程中出现错误:', err));