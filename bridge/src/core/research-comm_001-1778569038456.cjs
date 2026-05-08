// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:57:18.456Z

// filename: instance-communication-demo.js
// 运行方式：node instance-communication-demo.js

// ---------- 1. 引入依赖 ----------
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const Redis = require('ioredis');

// ---------- 2. 配置（每种协议对应的端口/频道） ----------
const CONFIG = {
  TCP: { port: 4001, host: '127.0.0.1' },
  WS:  { port: 4002, host: '127.0.0.1' },
  UDP: { port: 4003, host: '127.0.0.1' },
  REDIS: { channel: 'sister-heartbeat' }
};

// ---------- 3. 启动“姐妹实例” ----------
function startTcpSister() {
  const server = net.createServer(sock => {
    sock.on('data', data => {
      if (data.toString() === 'ping') sock.write('pong');
    });
  });
  server.listen(CONFIG.TCP.port, CONFIG.TCP.host, () => {
    console.log(`[Sister TCP] listening on ${CONFIG.TCP.host}:${CONFIG.TCP.port}`);
  });
}

function startWsSister() {
  const wss = new WebSocket.Server({ port: CONFIG.WS.port }, () => {
    console.log(`[Sister WS] listening on ws://${CONFIG.WS.host}:${CONFIG.WS.port}`);
  });
  wss.on('connection', ws => {
    ws.on('message', msg => {
      if (msg === 'ping') ws.send('pong');
    });
  });
}

function startUdpSister() {
  const server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    if (msg.toString() === 'ping') {
      server.send('pong', rinfo.port, rinfo.address);
    }
  });
  server.bind(CONFIG.UDP.port, CONFIG.UDP.host, () => {
    console.log(`[Sister UDP] bound to ${CONFIG.UDP.host}:${CONFIG.UDP.port}`);
  });
}

function startRedisSister() {
  const pub = new Redis();
  const sub = new Redis();

  // 当收到任何消息时，直接把 “alive” 推送回去
  sub.subscribe(CONFIG.REDIS.channel, () => {
    console.log(`[Sister Redis] subscribed to channel "${CONFIG.REDIS.channel}"`);
  });
  sub.on('message', (channel, message) => {
    if (message === 'ping') {
      pub.publish(channel, 'pong');
    }
  });
}

// 启动所有实例（实际项目里每个实例会是独立的进程，这里为演示放在同一进程）
startTcpSister();
startWsSister();
startUdpSister();
startRedisSister();

// ---------- 4. 检测函数 ----------
function checkTcp() {
  return new Promise((resolve) => {
    const client = net.createConnection(CONFIG.TCP.port, CONFIG.TCP.host, () => {
      client.write('ping');
    });
    client.setTimeout(1000);
    client.once('data', data => {
      resolve(data.toString() === 'pong');
      client.end();
    });
    client.once('timeout', () => {
      resolve(false);
      client.end();
    });
    client.once('error', () => resolve(false));
  });
}

function checkWs() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${CONFIG.WS.host}:${CONFIG.WS.port}`);
    const timer = setTimeout(() => {
      resolve(false);
      ws.terminate();
    }, 1000);
    ws.on('open', () => ws.send('ping'));
    ws.on('message', msg => {
      clearTimeout(timer);
      resolve(msg === 'pong');
      ws.close();
    });
    ws.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function checkUdp() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('ping');
    client.send(message, CONFIG.UDP.port, CONFIG.UDP.host, (err) => {
      if (err) { client.close(); return resolve(false); }
    });
    client.once('message', (msg) => {
      client.close();
      resolve(msg.toString() === 'pong');
    });
    setTimeout(() => {
      client.close();
      resolve(false);
    }, 1000);
  });
}

function checkRedis() {
  return new Promise(async (resolve) => {
    const sub = new Redis();
    const pub = new Redis();

    const timer = setTimeout(() => {
      sub.disconnect();
      pub.disconnect();
      resolve(false);
    }, 1000);

    // 监听响应
    sub.subscribe(CONFIG.REDIS.channel, () => {
      sub.once('message', (channel, message) => {
        if (message === 'pong') {
          clearTimeout(timer);
          sub.disconnect();
          pub.disconnect();
          resolve(true);
        }
      });
      // 发送 ping
      pub.publish(CONFIG.REDIS.channel, 'ping');
    });
  });
}

// ---------- 5. 主流程：依次检测并打印结果 ----------
async function runChecks() {
  console.log('\n=== 开始检测姐妹实例状态 ===');

  const results = await Promise.all([
    checkTcp().then(r => ({ method: 'TCP Socket', alive: r })),
    checkWs().then(r => ({ method: 'WebSocket', alive: r })),
    checkUdp().then(r => ({ method: 'UDP Ping', alive: r })),
    checkRedis().then(r => ({ method: 'Redis Pub/Sub', alive: r }))
  ]);

  results.forEach(res => {
    console.log(`[${res.method}] => ${res.alive ? '✅ Alive' : '❌ Unreachable'}`);
  });

  console.log('\n研究结论：');
  console.log('- TCP、WebSocket、UDP、Redis 都可以作为“除 HTTP ping 之外”的实例健康检测手段。');
  console.log('- 选型建议：');
  console.log('  * 需要可靠、顺序保证 → TCP Socket');
  console.log('  * 前端/浏览器也参与 → WebSocket');
  console.log('  * 超低时延、可容忍少量丢包 → UDP');
  console.log('  * 多机房、跨语言、需要统一消息总线 → Redis Pub/Sub');
  console.log('- 实际生产环境中常常组合使用（如先用 UDP 快速探测，随后用 TCP 确认）。');
}

// 给所有监听器一点启动时间后再检测
setTimeout(runChecks, 1500);