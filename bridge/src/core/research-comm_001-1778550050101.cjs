// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:40:50.101Z

// file: instance_comm_check.js
// 使用 CommonJS (require) 编写，可直接 node 运行

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const redis = require('redis');

// 配置端口（确保这些端口在本机空闲）
const CONFIG = {
  TCP_PORT: 4001,
  UDP_PORT: 4002,
  WS_PORT: 4003,
  REDIS_CHANNEL: 'instance_heartbeat',
  TIMEOUT_MS: 2000,
};

// ---------- 1. TCP Server & Client ----------
function startTcpServer() {
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      // 收到 ping，直接回 echo
      socket.write(data);
    });
  });
  server.listen(CONFIG.TCP_PORT, () => {
    console.log(`[TCP] Server listening on port ${CONFIG.TCP_PORT}`);
  });
  return server;
}

function testTcp() {
  return new Promise((resolve) => {
    const client = new net.Socket();
    const timer = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, CONFIG.TIMEOUT_MS);

    client.connect(CONFIG.TCP_PORT, '127.0.0.1', () => {
      client.write('ping');
    });

    client.on('data', (data) => {
      clearTimeout(timer);
      const ok = data.toString() === 'ping';
      client.end();
      resolve(ok);
    });

    client.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// ---------- 2. UDP Server & Client ----------
function startUdpServer() {
  const server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    // 把收到的内容原样发送回去
    server.send(msg, rinfo.port, rinfo.address);
  });
  server.bind(CONFIG.UDP_PORT, () => {
    console.log(`[UDP] Server bound on port ${CONFIG.UDP_PORT}`);
  });
  return server;
}

function testUdp() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('ping');
    const timer = setTimeout(() => {
      client.close();
      resolve(false);
    }, CONFIG.TIMEOUT_MS);

    client.send(message, CONFIG.UDP_PORT, '127.0.0.1', (err) => {
      if (err) {
        clearTimeout(timer);
        client.close();
        return resolve(false);
      }
    });

    client.on('message', (msg) => {
      clearTimeout(timer);
      const ok = msg.toString() === 'ping';
      client.close();
      resolve(ok);
    });
  });
}

// ---------- 3. WebSocket Server & Client ----------
function startWsServer() {
  const wss = new WebSocket.Server({ port: CONFIG.WS_PORT }, () => {
    console.log(`[WebSocket] Server listening on port ${CONFIG.WS_PORT}`);
  });

  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      // 简单回显
      ws.send(msg);
    });
  });

  return wss;
}

function testWs() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${CONFIG.WS_PORT}`);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, CONFIG.TIMEOUT_MS);

    ws.on('open', () => {
      ws.send('ping');
    });

    ws.on('message', (msg) => {
      clearTimeout(timer);
      const ok = msg.toString() === 'ping';
      ws.terminate();
      resolve(ok);
    });

    ws.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// ---------- 4. Redis Pub/Sub ----------
function startRedisSubscriber() {
  const sub = redis.createClient();
  sub.subscribe(CONFIG.REDIS_CHANNEL);
  sub.on('message', (channel, message) => {
    if (channel === CONFIG.REDIS_CHANNEL && message === 'ping') {
      // 收到 ping，立刻发布 pong
      sub.publish(CONFIG.REDIS_CHANNEL, 'pong');
    }
  });
  sub.on('ready', () => {
    console.log(`[Redis] Subscriber ready on channel "${CONFIG.REDIS_CHANNEL}"`);
  });
  return sub;
}

function testRedis() {
  return new Promise((resolve) => {
    const pub = redis.createClient();
    const sub = redis.createClient();

    const timer = setTimeout(() => {
      pub.quit();
      sub.quit();
      resolve(false);
    }, CONFIG.TIMEOUT_MS);

    sub.subscribe(CONFIG.REDIS_CHANNEL);
    sub.on('message', (channel, message) => {
      if (channel === CONFIG.REDIS_CHANNEL && message === 'pong') {
        clearTimeout(timer);
        pub.quit();
        sub.quit();
        resolve(true);
      }
    });

    // 先确保订阅成功后再发送 ping
    sub.on('subscribe', () => {
      pub.publish(CONFIG.REDIS_CHANNEL, 'ping');
    });

    // 错误处理
    pub.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    sub.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// ---------- 主流程 ----------
async function main() {
  console.log('=== 实例间通讯方式研究 (除 HTTP ping) ===\n');

  // 启动所有服务器
  const tcpSrv = startTcpServer();
  const udpSrv = startUdpServer();
  const wsSrv = startWsServer();
  const redisSub = startRedisSubscriber();

  // 给服务器一点启动时间
  await new Promise((r) => setTimeout(r, 500));

  // 依次测试
  const results = {
    TCP: await testTcp(),
    UDP: await testUdp(),
    WebSocket: await testWs(),
    RedisPubSub: await testRedis(),
  };

  // 输出结果
  console.log('\n--- 测试结果 ---');
  for (const [method, ok] of Object.entries(results)) {
    console.log(`${method.padEnd(12)}: ${ok ? '✅ 可用' : '❌ 不可用'}`);
  }

  // 关闭服务器（优雅退出）
  tcpSrv.close();
  udpSrv.close();
  wsSrv.close();
  redisSub.quit();

  console.log('\n研究结束。');
}

main().catch((e) => {
  console.error('运行时错误:', e);
});