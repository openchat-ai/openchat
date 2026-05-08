// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:21:39.965Z

// file: instance-communication-demo.js
// 运行方式：node instance-communication-demo.js

/**
 * 研究主题：除了 HTTP ping，还有哪些方式可以检测姐妹实例（同一机器或同一网络内的服务）状态？
 * 本示例实现并测试以下几种常用的进程/实例间通讯方式：
 *   1. TCP socket
 *   2. UDP socket
 *   3. WebSocket (基于 ws 包)
 *   4. Redis Pub/Sub（需要本地运行 Redis）
 *   5. 文件锁（基于 fs.open 的排他锁）
 *
 * 每种方式都会启动一个「服务端」和一个「客户端」模拟姐妹实例，
 * 客户端发送 “ping” 消息并等待 “pong” 响应，超时即视为不可达。
 * 最终把每种方式的检测结果打印出来。
 */

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const redis = require('redis');
const WebSocket = require('ws');

// 为了让代码结构更清晰，使用 async/await 包装每种检测方式
(async () => {
  const results = {};

  // -------------------------------------------------
  // 1. TCP socket
  // -------------------------------------------------
  async function testTCP() {
    return new Promise((resolve) => {
      const PORT = 40001;
      const server = net.createServer((socket) => {
        socket.on('data', (data) => {
          if (data.toString() === 'ping') {
            socket.write('pong');
          }
        });
      });

      server.listen(PORT, '127.0.0.1', () => {
        const client = new net.Socket();
        let responded = false;

        client.setTimeout(1000, () => {
          client.destroy();
          server.close();
          resolve(false);
        });

        client.connect(PORT, '127.0.0.1', () => {
          client.write('ping');
        });

        client.on('data', (data) => {
          if (data.toString() === 'pong') {
            responded = true;
            client.destroy();
            server.close();
            resolve(true);
          }
        });

        client.on('error', () => {
          server.close();
          resolve(false);
        });
      });
    });
  }

  // -------------------------------------------------
  // 2. UDP socket
  // -------------------------------------------------
  async function testUDP() {
    return new Promise((resolve) => {
      const PORT = 40002;
      const server = dgram.createSocket('udp4');

      server.on('message', (msg, rinfo) => {
        if (msg.toString() === 'ping') {
          server.send('pong', rinfo.port, rinfo.address);
        }
      });

      server.bind(PORT, '127.0.0.1', () => {
        const client = dgram.createSocket('udp4');
        let timeout = setTimeout(() => {
          client.close();
          server.close();
          resolve(false);
        }, 1000);

        client.on('message', (msg) => {
          if (msg.toString() === 'pong') {
            clearTimeout(timeout);
            client.close();
            server.close();
            resolve(true);
          }
        });

        client.send('ping', PORT, '127.0.0.1');
      });
    });
  }

  // -------------------------------------------------
  // 3. WebSocket (ws)
  // -------------------------------------------------
  async function testWebSocket() {
    return new Promise((resolve) => {
      const PORT = 40003;
      const wss = new WebSocket.Server({ port: PORT }, () => {
        const wsClient = new WebSocket(`ws://127.0.0.1:${PORT}`);

        wsClient.on('open', () => {
          wsClient.send('ping');
        });

        wsClient.on('message', (msg) => {
          if (msg === 'pong') {
            wsClient.terminate();
            wss.close();
            resolve(true);
          }
        });

        wsClient.on('error', () => {
          wss.close();
          resolve(false);
        });

        // Server side
        wss.on('connection', (ws) => {
          ws.on('message', (msg) => {
            if (msg === 'ping') ws.send('pong');
          });
        });
      });

      // 超时保护
      setTimeout(() => {
        wss.close();
        resolve(false);
      }, 1500);
    });
  }

  // -------------------------------------------------
  // 4. Redis Pub/Sub
  // -------------------------------------------------
  async function testRedis() {
    // 需要本地已经启动了 Redis（默认 6379 端口）
    const CHANNEL = 'sister_status_demo';
    const publisher = redis.createClient();
    const subscriber = redis.createClient();

    const timeout = 2000;
    let timer;

    return new Promise((resolve) => {
      subscriber.on('error', (err) => {
        console.error('Redis subscriber error:', err);
        cleanup(false);
      });
      publisher.on('error', (err) => {
        console.error('Redis publisher error:', err);
        cleanup(false);
      });

      subscriber.subscribe(CHANNEL, (err) => {
        if (err) return cleanup(false);
        // 发起 ping
        publisher.publish(CHANNEL, 'ping');
      });

      subscriber.on('message', (ch, message) => {
        if (ch !== CHANNEL) return;
        if (message === 'pong') {
          cleanup(true);
        }
      });

      // 模拟另一实例：收到 ping 后回复 pong
      const responder = redis.createClient();
      responder.subscribe(CHANNEL);
      responder.on('message', (ch, msg) => {
        if (msg === 'ping') {
          responder.publish(CHANNEL, 'pong');
        }
      });

      timer = setTimeout(() => cleanup(false), timeout);

      function cleanup(success) {
        clearTimeout(timer);
        subscriber.quit();
        publisher.quit();
        responder.quit();
        resolve(success);
      }
    });
  }

  // -------------------------------------------------
  // 5. 文件锁（基于 fs.open 的排他锁）
  // -------------------------------------------------
  async function testFileLock() {
    const lockFile = path.join(__dirname, 'sister.lock');

    // 先让“姐妹实例1”占用锁
    const fd1 = await promisify(fs.open)(lockFile, 'w');

    // 尝试在另一实例中获取同一锁（应当失败）
    try {
      const fd2 = await promisify(fs.open)(lockFile, 'wx'); // exclusive
      // 能打开说明锁没有被占用，状态为“可达”
      await promisify(fs.close)(fd2);
      await promisify(fs.close)(fd1);
      await promisify(fs.unlink)(lockFile);
      return true;
    } catch (e) {
      // EEXIST / EACCES 表示锁已被占用，说明姐妹实例存活
      await promisify(fs.close)(fd1);
      await promisify(fs.unlink)(lockFile);
      return false; // 对于“检测是否存活”，这里返回 false 表示对方已占用锁
    }
  }

  // 依次运行所有检测
  results.TCP = await testTCP();
  results.UDP = await testUDP();
  results.WebSocket = await testWebSocket();
  results.RedisPubSub = await testRedis();
  results.FileLock = await testFileLock();

  console.log('=== 实例间通讯方式检测结果 ===');
  console.log('TCP socket      :', results.TCP ? '可达 (pong)' : '不可达');
  console.log('UDP socket      :', results.UDP ? '可达 (pong)' : '不可达');
  console.log('WebSocket (ws)  :', results.WebSocket ? '可达 (pong)' : '不可达');
  console.log('Redis Pub/Sub   :', results.RedisPubSub ? '可达 (pong)' : '不可达 (请确认本机已启动 Redis)');
  console.log('文件锁 (lock)   :', results.FileLock ? '可达 (未被占用)' : '不可达 (已被占用)');

  console.log('\n结论：');
  console.log('1. TCP/UDP/WebSocket 适合跨机器或跨容器的实时检测。');
  console.log('2. Redis Pub/Sub 在已有 Redis 基础设施时非常轻量，天然支持广播。');
  console.log('3. 文件锁适合同一主机上进程间的“活跃性”判断，但只能检测本机。');
  console.log('4. 根据业务网络环境和部署架构，可组合使用以上方式实现容错与监控。');
})();