// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:46:56.842Z

/**
 * 例：姐妹实例状态检测
 * 1️⃣ TCP 端口探测
 * 2️⃣ WebSocket ping/pong
 * 3️⃣ Redis PING
 *
 * 运行方法：
 *   npm init -y
 *   npm install ws ioredis
 *   node instance_status_check.js
 */

const net = require('net');
const WebSocket = require('ws');
const Redis = require('ioredis');

// ---------- 配置 ----------
const config = {
  // 目标实例的 IP/域名
  host: '127.0.0.1',
  // 1️⃣ TCP 端口探测（如 8080）
  tcpPort: 8080,
  // 2️⃣ WebSocket 服务器地址（如 ws://127.0.0.1:9001）
  wsUrl: 'ws://127.0.0.1:9001',
  // 3️⃣ Redis 服务器地址
  redis: {
    host: '127.0.0.1',
    port: 6379,
    password: null // 如有密码请填写
  }
};

// ---------- 1️⃣ TCP 端口探测 ----------
function tcpPing(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let finished = false;

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      finished = true;
      socket.destroy();
      resolve({ success: true, method: 'TCP' });
    });

    socket.on('timeout', () => {
      if (!finished) {
        finished = true;
        socket.destroy();
        resolve({ success: false, method: 'TCP', error: 'timeout' });
      }
    });

    socket.on('error', (err) => {
      if (!finished) {
        finished = true;
        socket.destroy();
        resolve({ success: false, method: 'TCP', error: err.message });
      }
    });

    socket.connect(port, host);
  });
}

// ---------- 2️⃣ WebSocket ping/pong ----------
function wsPing(url, timeout = 2000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { handshakeTimeout: timeout });

    const cleanup = () => {
      ws.terminate();
    };

    ws.on('open', () => {
      // 发送 ping
      ws.ping();
    });

    ws.on('pong', () => {
      cleanup();
      resolve({ success: true, method: 'WebSocket' });
    });

    ws.on('error', (err) => {
      cleanup();
      resolve({ success: false, method: 'WebSocket', error: err.message });
    });

    ws.on('close', () => {
      // 如果在 timeout 之前就关闭了连接
      if (!ws._pingSent) {
        cleanup();
        resolve({ success: false, method: 'WebSocket', error: 'connection closed' });
      }
    });

    // 失败超时
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        cleanup();
        resolve({ success: false, method: 'WebSocket', error: 'timeout' });
      }
    }, timeout);
  });
}

// ---------- 3️⃣ Redis PING ----------
async function redisPing(redisConfig, timeout = 2000) {
  const client = new Redis({
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password,
    connectTimeout: timeout,
    retryStrategy: () => null // 不重连，直接报错
  });

  try {
    const result = await client.ping();
    client.disconnect();
    return { success: result === 'PONG', method: 'Redis' };
  } catch (err) {
    client.disconnect();
    return { success: false, method: 'Redis', error: err.message };
  }
}

// ---------- 主流程 ----------
(async () => {
  console.log('--- 姐妹实例状态检测开始 ---\n');

  // 1️⃣ TCP
  const tcpResult = await tcpPing(config.host, config.tcpPort);
  console.log(`[TCP] ${tcpResult.success ? '✅ 连接成功' : '❌ 失败'}${tcpResult.error ? ' - ' + tcpResult.error : ''}`);

  // 2️⃣ WebSocket
  const wsResult = await wsPing(config.wsUrl);
  console.log(`[WebSocket] ${wsResult.success ? '✅ ping/pong 通信正常' : '❌ 失败'}${wsResult.error ? ' - ' + wsResult.error : ''}`);

  // 3️⃣ Redis
  const redisResult = await redisPing(config.redis);
  console.log(`[Redis] ${redisResult.success ? '✅ PING/PONG 正常' : '❌ 失败'}${redisResult.error ? ' - ' + redisResult.error : ''}`);

  console.log('\n--- 姐妹实例状态检测结束 ---');
})();