// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:10:17.844Z

/**
 * 1. HTTP Ping
 * 2. TCP 心跳
 * 3. WebSocket 双向通信
 * 4. Redis Pub/Sub
 * 5. ZeroMQ
 * 6. 文件锁检测
 *
 * 运行方式：
 *   node instanceHealth.js
 *
 * 需要安装依赖：
 *   npm install axios ws ioredis zeromq lockfile
 */

const http = require('http');
const net = require('net');
const fs = require('fs');
const lockfile = require('lockfile');
const axios = require('axios');
const WebSocket = require('ws');
const Redis = require('ioredis');
const zmq = require('zeromq');

// -------------------- 1. HTTP Ping --------------------
async function httpPing(url) {
  try {
    const res = await axios.get(url, { timeout: 500 });
    console.log(`[HTTP] ${url} => ${res.status}`);
  } catch (err) {
    console.log(`[HTTP] ${url} => error: ${err.code || err.message}`);
  }
}

// -------------------- 2. TCP 心跳 --------------------
function tcpPing(host, port, timeout = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      socket.destroy();
      console.log(`[TCP] ${host}:${port} => timeout`);
      resolve();
    }, timeout);

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.end();
      console.log(`[TCP] ${host}:${port} => connected`);
      resolve();
    });

    socket.on('error', (err) => {
      if (!timedOut) {
        clearTimeout(timer);
        console.log(`[TCP] ${host}:${port} => error: ${err.code || err.message}`);
        resolve();
      }
    });
  });
}

// -------------------- 3. WebSocket --------------------
function startWebSocketServer(port = 8080) {
  const wss = new WebSocket.Server({ port });
  wss.on('connection', (ws) => {
    console.log(`[WS] New client connected`);
    ws.on('message', (msg) => {
      console.log(`[WS] Received: ${msg}`);
      ws.send(`pong: ${msg}`);
    });
  });
  console.log(`[WS] Server listening on ws://localhost:${port}`);
}

function wsPing(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.terminate();
      console.log(`[WS] ${url} => timeout`);
      resolve();
    }, 1000);

    ws.on('open', () => {
      ws.send('ping');
    });

    ws.on('message', (msg) => {
      clearTimeout(timeout);
      console.log(`[WS] ${url} => ${msg}`);
      ws.close();
      resolve();
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.log(`[WS] ${url} => error: ${err.message}`);
      resolve();
    });
  });
}

// -------------------- 4. Redis Pub/Sub --------------------
async function redisHealthCheck() {
  const pub = new Redis(); // 默认 localhost:6379
  const sub = new Redis();

  return new Promise((resolve) => {
    const channel = 'health_check';
    const msg = 'ping';
    const timeout = setTimeout(() => {
      console.log(`[Redis] Pub/Sub => timeout`);
      resolve();
      pub.disconnect();
      sub.disconnect();
    }, 1000);

    sub.subscribe(channel, (err) => {
      if (err) {
        console.log(`[Redis] subscribe error: ${err.message}`);
        clearTimeout(timeout);
        resolve();
        return;
      }
      sub.on('message', (chan, message) => {
        if (chan === channel && message === msg) {
          clearTimeout(timeout);
          console.log(`[Redis] Pub/Sub => received pong`);
          resolve();
          pub.disconnect();
          sub.disconnect();
        }
      });
      pub.publish(channel, msg);
    });
  });
}

// -------------------- 5. ZeroMQ --------------------
async function zmqHealthCheck() {
  const sock = new zmq.Request();
  sock.connect('tcp://127.0.0.1:5555');

  const timeout = setTimeout(() => {
    console.log(`[ZMQ] => timeout`);
    sock.disconnect('tcp://127.0.0.1:5555');
  }, 1000);

  try {
    await sock.send('ping');
    const [result] = await sock.receive();
    clearTimeout(timeout);
    console.log(`[ZMQ] => ${result.toString()}`);
  } catch (err) {
    console.log(`[ZMQ] => error: ${err.message}`);
  } finally {
    sock.disconnect('tcp://127.0.0.1:5555');
  }
}

// -------------------- 6. 文件锁检测 --------------------
function fileLockCheck(lockPath) {
  const lockOpts = { wait: 1000, pollPeriod: 100, stale: 10000 };
  lockfile.lock(lockPath, lockOpts, (err) => {
    if (err) {
      console.log(`[FileLock] ${lockPath} => lock in use or error: ${err.message}`);
    } else {
      console.log(`[FileLock] ${lockPath} => acquired lock`);
      // 立即释放
      lockfile.unlock(lockPath, (unlockErr) => {
        if (unlockErr) console.log(`[FileLock] unlock error: ${unlockErr.message}`);
      });
    }
  });
}

// -------------------- 主程序 --------------------
async function main() {
  console.log('--- 1. HTTP Ping ---');
  await httpPing('http://localhost:3000/ping');

  console.log('\n--- 2. TCP Ping ---');
  await tcpPing('127.0.0.1', 3000);

  console.log('\n--- 3. WebSocket Ping ---');
  startWebSocketServer(8080);
  await wsPing('ws://localhost:8080');

  console.log('\n--- 4. Redis Pub/Sub Ping ---');
  await redisHealthCheck();

  console.log('\n--- 5. ZeroMQ Ping ---');
  // 需要另起一个进程做 zmq 服务器：
  // const sock = new zmq.Reply(); sock.bind('tcp://*:5555'); sock.receive().then(()=>sock.send('pong'));
  await zmqHealthCheck();

  console.log('\n--- 6. File Lock Ping ---');
  const lockPath = './instance.lock';
  // 确保文件存在
  fs.closeSync(fs.openSync(lockPath, 'w'));
  fileLockCheck(lockPath);
}

main().catch((err) => console.error(err));