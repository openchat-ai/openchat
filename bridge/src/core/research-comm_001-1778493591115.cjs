// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:59:51.115Z

/**
 * 实例间通讯方式研究示例
 *  - TCP Socket (net)
 *  - UDP Socket (dgram)
 *  - Redis Pub/Sub
 *  - 文件锁（基于 fs.watch）
 *
 * 运行方式：
 *   1. 确保本机已启动一个 TCP 服务器 (port 3001) 与一个 UDP 服务器 (port 4001)；
 *   2. 确保本机已启动 Redis（默认 127.0.0.1:6379）；
 *   3. 把本文件保存为 checkPeers.js，然后 `node checkPeers.js`
 *
 * 代码会依次尝试四种检测方法，并在 console 中打印结果。
 */

const net = require('net');
const dgram = require('dgram');
const redis = require('redis');
const fs = require('fs');
const path = require('path');

// ---------- 1. TCP Socket ----------
function checkTcp(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    socket.setTimeout(timeout);
    socket.once('connect', () => {
      settled = true;
      socket.destroy();
      resolve({ ok: true, method: 'TCP', detail: `Connected to ${host}:${port}` });
    });
    socket.once('error', (err) => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, method: 'TCP', detail: err.message });
      }
    });
    socket.once('timeout', () => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, method: 'TCP', detail: 'timeout' });
      }
    });

    socket.connect(port, host);
  });
}

// ---------- 2. UDP Socket ----------
function checkUdp(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const msg = Buffer.from('ping');
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        client.close();
        resolve({ ok: false, method: 'UDP', detail: 'timeout' });
      }
    }, timeout);

    client.once('message', (msg, rinfo) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        client.close();
        resolve({ ok: true, method: 'UDP', detail: `reply from ${rinfo.address}:${rinfo.port}` });
      }
    });

    client.send(msg, 0, msg.length, port, host, (err) => {
      if (err && !settled) {
        settled = true;
        clearTimeout(timer);
        client.close();
        resolve({ ok: false, method: 'UDP', detail: err.message });
      }
    });
  });
}

// ---------- 3. Redis Pub/Sub ----------
function checkRedis(channel = 'peer_check', timeout = 2000) {
  return new Promise((resolve) => {
    const subscriber = redis.createClient();
    const publisher = redis.createClient();

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        subscriber.quit();
        publisher.quit();
        resolve({ ok: false, method: 'Redis', detail: 'no reply' });
      }
    }, timeout);

    subscriber.on('error', (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        subscriber.quit();
        publisher.quit();
        resolve({ ok: false, method: 'Redis', detail: e.message });
      }
    });

    subscriber.subscribe(channel, () => {
      // 发送一次请求，让同一进程或其他进程的监听者回复
      publisher.publish(channel, JSON.stringify({ type: 'ping', ts: Date.now() }));
    });

    subscriber.on('message', (chan, message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'pong') {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            subscriber.quit();
            publisher.quit();
            resolve({ ok: true, method: 'Redis', detail: `pong received (${data.from})` });
          }
        }
      } catch (_) { /* ignore non‑JSON */ }
    });
  });
}

// ---------- 4. 文件锁（基于文件的修改时间） ----------
function checkFileLock(filePath = path.join(__dirname, 'peer.lock'), timeout = 2000) {
  return new Promise((resolve) => {
    // 如果文件不存在则创建，随后监视它的修改时间
    fs.closeSync(fs.openSync(filePath, 'a'));

    let lastMtime = null;
    const watcher = fs.watch(filePath, (event) => {
      if (event === 'change') {
        fs.stat(filePath, (err, stats) => {
          if (!err && stats.mtimeMs !== lastMtime) {
            lastMtime = stats.mtimeMs;
            clearTimeout(timer);
            watcher.close();
            resolve({ ok: true, method: 'FileLock', detail: `mtime changed ${new Date(stats.mtimeMs)}` });
          }
        });
      }
    });

    // 触发一次写入，模拟“姐妹实例”会定期更新这个文件
    const timer = setTimeout(() => {
      watcher.close();
      resolve({ ok: false, method: 'FileLock', detail: 'no change detected' });
    }, timeout);
  });
}

// ---------- 主流程 ----------
async function main() {
  console.log('=== 实例间通讯方式研究 ===\n');

  // 1. TCP 检测
  const tcpResult = await checkTcp('127.0.0.1', 3001);
  console.log(`[${tcpResult.method}] ${tcpResult.ok ? 'OK' : 'FAIL'} – ${tcpResult.detail}`);

  // 2. UDP 检测
  const udpResult = await checkUdp('127.0.0.1', 4001);
  console.log(`[${udpResult.method}] ${udpResult.ok ? 'OK' : 'FAIL'} – ${udpResult.detail}`);

  // 3. Redis Pub/Sub 检测
  // 为了演示，这里在同一进程里先启动一个“监听者”来回复 pong
  const redisListener = redis.createClient();
  redisListener.subscribe('peer_check');
  redisListener.on('message', (chan, msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'ping') {
        const responder = redis.createClient();
        responder.publish(chan, JSON.stringify({ type: 'pong', from: 'self' }));
        responder.quit();
      }
    } catch (_) { }
  });

  const redisResult = await checkRedis();
  console.log(`[${redisResult.method}] ${redisResult.ok ? 'OK' : 'FAIL'} – ${redisResult.detail}`);

  // 4. 文件锁检测
  // 同时启动一个定时器模拟“姐妹实例”每秒更新一次 lock 文件
  const lockFile = path.join(__dirname, 'peer.lock');
  const updater = setInterval(() => {
    fs.writeFileSync(lockFile, Date.now().toString());
  }, 1000);

  const fileResult = await checkFileLock(lockFile);
  console.log(`[${fileResult.method}] ${fileResult.ok ? 'OK' : 'FAIL'} – ${fileResult.detail}`);

  clearInterval(updater);
  // 清理
  try { fs.unlinkSync(lockFile); } catch (_) {}

  console.log('\n=== 研究结束 ===');
}

main().catch(err => console.error('Unexpected error:', err));