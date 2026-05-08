// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:43:52.446Z

/**
 * 方案 1: 传统 HTTP GET /health
 * 方案 2: TCP 端口探测（如 80/443）
 * 方案 3: UDP “ping”（自定义协议）
 * 方案 4: Redis PING 命令（只要两台机器都能连到同一 Redis 实例）
 * 方案 5: gRPC Health Check（需要 gRPC 服务）
 * 方案 6: WebSocket 心跳（如果已使用 WS）
 *
 * 下面用 1、2、3、4 四种方式示例，演示如何“检查姐妹（同类实例）是否存活”。
 * 代码会在 console 打印每种方式的结果。
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const { promisify } = require('util');
const redis = require('redis');

// ---------- 1. HTTP health check ----------
async function httpHealthCheck(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const { statusCode } = res;
      res.resume(); // discard data
      if (statusCode === 200) {
        resolve(`HTTP ${url} OK`);
      } else {
        reject(`HTTP ${url} status ${statusCode}`);
      }
    });
    req.on('error', (e) => reject(`HTTP ${url} error: ${e.message}`));
    req.setTimeout(3000, () => {
      req.destroy();
      reject(`HTTP ${url} timeout`);
    });
  });
}

// ---------- 2. TCP port probe ----------
async function tcpProbe(host, port, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.once('connect', () => {
      socket.end();
      resolve(`TCP ${host}:${port} OK`);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(`TCP ${host}:${port} timeout`);
    });
    socket.once('error', (err) => {
      socket.destroy();
      reject(`TCP ${host}:${port} error: ${err.message}`);
    });
    socket.connect(port, host);
  });
}

// ---------- 3. UDP “ping” ----------
async function udpPing(host, port, message = 'ping', timeout = 2000) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      client.close();
      reject(`UDP ${host}:${port} timeout`);
    }, timeout);

    client.on('message', (msg, rinfo) => {
      clearTimeout(timer);
      client.close();
      resolve(`UDP ${host}:${port} reply: ${msg.toString()}`);
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      client.close();
      reject(`UDP ${host}:${port} error: ${err.message}`);
    });

    client.send(Buffer.from(message), port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        client.close();
        reject(`UDP ${host}:${port} send error: ${err.message}`);
      }
    });
  });
}

// ---------- 4. Redis PING ----------
async function redisPing(redisUrl) {
  const client = redis.createClient({ url: redisUrl });
  const connect = promisify(client.connect).bind(client);
  const ping = promisify(client.ping).bind(client);
  const quit = promisify(client.quit).bind(client);

  try {
    await connect();
    const resp = await ping(); // should return 'PONG'
    await quit();
    return `Redis ${redisUrl} ping: ${resp}`;
  } catch (err) {
    return `Redis ${redisUrl} ping error: ${err.message}`;
  }
}

// ---------- 主程序 ----------
(async () => {
  const results = [];

  // 1. HTTP
  try {
    results.push(await httpHealthCheck('http://localhost:3000/health'));
  } catch (e) {
    results.push(e);
  }

  // 2. TCP
  try {
    results.push(await tcpProbe('localhost', 5432));
  } catch (e) {
    results.push(e);
  }

  // 3. UDP
  // 需要在另一端运行一个简单的 UDP echo 服务器（示例代码见下方）
  try {
    results.push(await udpPing('localhost', 41234));
  } catch (e) {
    results.push(e);
  }

  // 4. Redis
  try {
    results.push(await redisPing('redis://localhost:6379'));
  } catch (e) {
    results.push(e);
  }

  console.log('=== 姐妹实例健康检查结果 ===');
  results.forEach((r, i) => console.log(`${i + 1}. ${r}`));
})();

/**
 * ---------------------------- 下面是 UDP echo 服务器示例（单独启动）  ----------------------------
 * 
 * // udp-echo-server.js
 * const dgram = require('dgram');
 * const server = dgram.createSocket('udp4');
 * server.on('message', (msg, rinfo) => {
 *   console.log(`服务器收到: ${msg} from ${rinfo.address}:${rinfo.port}`);
 *   server.send(msg, rinfo.port, rinfo.address, (err) => {
 *     if (err) console.error('发送错误', err);
 *   });
 * });
 * server.bind(41234, () => console.log('UDP echo 服务器已启动，监听 41234 端口'));
 * 
 * ---------------------------- 用法 ----------------------------
 * 1. 先启动 UDP echo 服务器：node udp-echo-server.js
 * 2. 再启动本脚本：node health-check.js
 */