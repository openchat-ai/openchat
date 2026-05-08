// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:30:12.848Z

/**
 * 研究实例间通讯方式：
 * - HTTP ping  (已知最常用)
 * - TCP ping   (直接尝试 TCP 连接)
 * - UDP ping   (发送一个无意义的 UDP 包)
 * - Redis PUB/SUB  (检查可否订阅/发布)
 * - WebSocket  (尝试打开 WebSocket 连接)
 *
 * 运行方式：node healthcheck.js
 *
 * 所有地址/端口均以 localhost 为例，实际使用时请改为你自己的实例地址。
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const redis = require('redis');

// ---------- 配置 ----------
const CONFIG = {
  HTTP:   { host: 'localhost', port: 8080, path: '/' },
  TCP:    { host: 'localhost', port: 9000, timeout: 2000 },
  UDP:    { host: 'localhost', port: 9001, timeout: 2000, message: Buffer.from('ping') },
  REDIS:  { host: '127.0.0.1', port: 6379 },
  WS:     { url: 'ws://localhost:8081' }
};

// ---------- 工具函数 ----------
function logResult(name, success, err = null) {
  if (success) {
    console.log(`[✅ ${name}] 通过`);
  } else {
    console.log(`[❌ ${name}] 失败: ${err ? err.message : '未知错误'}`);
  }
}

// ---------- HTTP ----------
function checkHttp() {
  return new Promise((resolve) => {
    const options = {
      hostname: CONFIG.HTTP.host,
      port:     CONFIG.HTTP.port,
      path:     CONFIG.HTTP.path,
      method:   'GET',
      timeout:  2000
    };

    const req = http.request(options, (res) => {
      res.on('data', () => {}); // 读取数据，避免警告
      res.on('end', () => resolve({ success: true }));
    });

    req.on('error', (e) => resolve({ success: false, err: e }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, err: new Error('timeout') });
    });

    req.end();
  });
}

// ---------- TCP ----------
function checkTcp() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer  = setTimeout(() => {
      socket.destroy();
      resolve({ success: false, err: new Error('timeout') });
    }, CONFIG.TCP.timeout);

    socket.connect(CONFIG.TCP.port, CONFIG.TCP.host, () => {
      clearTimeout(timer);
      socket.end();
      resolve({ success: true });
    });

    socket.on('error', (e) => {
      clearTimeout(timer);
      resolve({ success: false, err: e });
    });
  });
}

// ---------- UDP ----------
function checkUdp() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let timer = setTimeout(() => {
      socket.close();
      resolve({ success: false, err: new Error('timeout') });
    }, CONFIG.UDP.timeout);

    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      resolve({ success: false, err });
    });

    // 这里仅仅发送一个包，真正的“ping”需要服务端回包才能确认可达
    socket.send(CONFIG.UDP.message, CONFIG.UDP.port, CONFIG.UDP.host, (err) => {
      clearTimeout(timer);
      socket.close();
      resolve({ success: !err, err });
    });
  });
}

// ---------- Redis ----------
function checkRedis() {
  return new Promise((resolve) => {
    const client = redis.createClient({
      socket: { host: CONFIG.REDIS.host, port: CONFIG.REDIS.port, timeout: 2000 }
    });

    client.on('error', (err) => resolve({ success: false, err }));

    client.connect()
      .then(() => {
        // 简单的订阅/发布测试
        return client.subscribe('healthcheck_test', async (message) => {
          // 只要收到消息就算成功
          await client.unsubscribe('healthcheck_test');
          await client.quit();
          resolve({ success: true });
        });
      })
      .catch((err) => {
        client.quit();
        resolve({ success: false, err });
      });
  });
}

// ---------- WebSocket ----------
function checkWs() {
  return new Promise((resolve) => {
    const ws = new WebSocket(CONFIG.WS.url, { handshakeTimeout: 2000 });

    const timeout = setTimeout(() => {
      ws.terminate();
      resolve({ success: false, err: new Error('timeout') });
    }, 2000);

    ws.on('open', () => {
      clearTimeout(timeout);
      ws.close();
      resolve({ success: true });
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, err });
    });
  });
}

// ---------- 主流程 ----------
(async () => {
  console.log('=== 实例间通讯方式研究 ===\n');

  // 1. HTTP
  const httpRes = await checkHttp();
  logResult('HTTP', httpRes.success, httpRes.err);

  // 2. TCP
  const tcpRes = await checkTcp();
  logResult('TCP', tcpRes.success, tcpRes.err);

  // 3. UDP
  const udpRes = await checkUdp();
  logResult('UDP', udpRes.success, udpRes.err);

  // 4. Redis PUB/SUB
  const redisRes = await checkRedis();
  logResult('Redis PUB/SUB', redisRes.success, redisRes.err);

  // 5. WebSocket
  const wsRes = await checkWs();
  logResult('WebSocket', wsRes.success, wsRes.err);

  console.log('\n=== 研究结束 ===');
})();