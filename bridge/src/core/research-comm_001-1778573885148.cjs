// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:18:05.148Z

// instance-check.js
// 运行环境：Node.js >=12
// 说明：演示除了 HTTP ping 之外的几种实例间状态检测手段
//        - TCP 连接探测
//        - UDP “ping” (基于 dgram)
//        - WebSocket 心跳
//        - 子进程 IPC (process.send / process.on('message'))
//        - Redis Pub/Sub（需要本地运行的 Redis 实例）
// 每种方式都会尝试连接到本机的「姐妹实例」并在 2 秒内给出成功/失败的日志。

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const { fork } = require('child_process');
const redis = require('redis');

// ------------------- 配置 -------------------
const CONFIG = {
  // 这里假设「姐妹实例」分别监听以下端口
  tcpPort: 4000,
  udpPort: 4001,
  wsPort: 4002,
  redisChannel: 'instance-status',
  // 超时时间（毫秒）
  timeout: 2000,
};
// ------------------------------------------------

// 1. TCP 连接探测 -------------------------------------------------
function checkTCP() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    socket.setTimeout(CONFIG.timeout);
    socket.once('connect', () => {
      settled = true;
      console.log('[TCP] 连接成功，实例在线');
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (err) => {
      if (!settled) {
        settled = true;
        console.log('[TCP] 连接错误:', err.message);
        resolve(false);
      }
    });
    socket.once('timeout', () => {
      if (!settled) {
        settled = true;
        console.log('[TCP] 连接超时');
        resolve(false);
      }
    });

    socket.connect(CONFIG.tcpPort, '127.0.0.1');
  });
}

// 2. UDP “ping”（发送一个小包并等待回包） -------------------------
function checkUDP() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('ping');

    const timer = setTimeout(() => {
      console.log('[UDP] 超时未收到响应');
      client.close();
      resolve(false);
    }, CONFIG.timeout);

    client.once('message', (msg, rinfo) => {
      clearTimeout(timer);
      console.log(`[UDP] 收到响应 (${rinfo.address}:${rinfo.port}) -> ${msg}`);
      client.close();
      resolve(true);
    });

    client.send(message, 0, message.length, CONFIG.udpPort, '127.0.0.1', (err) => {
      if (err) {
        clearTimeout(timer);
        console.log('[UDP] 发送错误:', err.message);
        client.close();
        resolve(false);
      }
    });
  });
}

// 3. WebSocket 心跳 ------------------------------------------------
function checkWebSocket() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${CONFIG.wsPort}`);

    const timer = setTimeout(() => {
      console.log('[WebSocket] 超时未连接');
      ws.terminate();
      resolve(false);
    }, CONFIG.timeout);

    ws.on('open', () => {
      clearTimeout(timer);
      console.log('[WebSocket] 连接成功，发送心跳');
      ws.send('heartbeat');
    });

    ws.on('message', (data) => {
      console.log('[WebSocket] 收到回复:', data.toString());
      ws.close();
      resolve(true);
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      console.log('[WebSocket] 连接错误:', err.message);
      resolve(false);
    });
  });
}

// 4. 子进程 IPC（fork + message） -----------------------------------
function checkChildProcess() {
  return new Promise((resolve) => {
    const child = fork(__filename, ['--child']);
    const timer = setTimeout(() => {
      console.log('[IPC] 子进程超时未响应');
      child.kill();
      resolve(false);
    }, CONFIG.timeout);

    child.once('message', (msg) => {
      clearTimeout(timer);
      console.log('[IPC] 收到子进程回复:', msg);
      child.kill();
      resolve(msg === 'alive');
    });
  });
}

// 5. Redis Pub/Sub -------------------------------------------------
function checkRedis() {
  return new Promise((resolve) => {
    const publisher = redis.createClient();
    const subscriber = redis.createClient();

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.log('[Redis] 超时未收到响应');
        publisher.quit();
        subscriber.quit();
        resolve(false);
      }
    }, CONFIG.timeout);

    subscriber.on('error', (e) => console.error('[Redis] Sub error', e));
    publisher.on('error', (e) => console.error('[Redis] Pub error', e));

    subscriber.subscribe(CONFIG.redisChannel, (err) => {
      if (err) {
        clearTimeout(timer);
        console.log('[Redis] 订阅错误:', err.message);
        resolve(false);
      }
    });

    subscriber.on('message', (channel, message) => {
      if (channel === CONFIG.redisChannel && message === 'pong') {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          console.log('[Redis] 收到 pong 响应');
          publisher.quit();
          subscriber.quit();
          resolve(true);
        }
      }
    });

    // 发送 ping，等待对端（手动或另一个进程）回 pong
    publisher.publish(CONFIG.redisChannel, 'ping');
  });
}

// ---------------------------------------------------------------
// 主体流程：依次执行所有检测方式并打印结果
async function main() {
  console.log('=== 实例间通讯方式研究（除 HTTP ping） ===');
  const results = {};

  results.tcp = await checkTCP();
  results.udp = await checkUDP();
  results.ws = await checkWebSocket();
  results.ipc = await checkChildProcess();
  results.redis = await checkRedis();

  console.log('\n--- 检测汇总 ---');
  console.table(results);
}

// ---------------------------------------------------------------
// 当以子进程模式运行时（用于 IPC 示例），只做最简回复
if (process.argv.includes('--child')) {
  // 子进程收到父进程的消息后直接回复
  process.on('message', () => {
    process.send('alive');
  });
  // 为了让父进程能立即收到消息，主动发送一次
  process.send('alive');
} else {
  // 直接执行主流程
  main().catch((e) => console.error('运行出错:', e));
}