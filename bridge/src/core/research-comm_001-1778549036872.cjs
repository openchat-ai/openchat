// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:23:56.872Z

/**
 * 实例间通讯方式研究脚本
 * 运行环境：Node.js (>=14) + npm 安装的 ws、redis、zeromq
 * 用法：node communication_check.js
 */

const net = require('net');
const dgram = require('dgram');
const { performance } = require('perf_hooks');

// 第三方库（请先 `npm install ws redis zeromq`）
const WebSocket = require('ws');
const redis = require('redis');
const zmq = require('zeromq');

// ------------------- 配置区 -------------------
const instances = [
  // 只做 TCP 检测（常见的自定义协议或 MySQL、PostgreSQL 等）
  { name: 'SSH (TCP)', host: '127.0.0.1', port: 22, methods: ['tcp'] },

  // HTTP 方式（这里用 TCP 代替，因为我们不想依赖额外的 http 请求库）
  { name: 'HTTP (TCP)', host: '127.0.0.1', port: 80, methods: ['tcp'] },

  // UDP 检测（需要目标服务实现“回显”或自定义响应）
  { name: 'UDP Echo', host: '127.0.0.1', port: 7, methods: ['udp'] },

  // WebSocket 检测
  { name: 'WebSocket Server', host: '127.0.0.1', port: 8080, methods: ['ws'] },

  // Redis Pub/Sub 检测
  { name: 'Redis Server', host: '127.0.0.1', port: 6379, methods: ['redis'] },

  // ZeroMQ 检测（使用 ipc 方式演示，本机需要有对应的 zmq 服务）
  { name: 'ZeroMQ Service', endpoint: 'tcp://127.0.0.1:5555', methods: ['zmq'] },
];

// 检测超时时间（毫秒）
const TIMEOUT_MS = 2000;

// ------------------- 检测实现 -------------------
function tcpCheck({ host, port }) {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = new net.Socket();

    const onError = (err) => {
      socket.destroy();
      resolve({ alive: false, time: performance.now() - start, error: err.message });
    };

    socket.setTimeout(TIMEOUT_MS, () => onError(new Error('TCP timeout')));
    socket.once('error', onError);

    socket.connect(port, host, () => {
      const elapsed = performance.now() - start;
      socket.end();
      resolve({ alive: true, time: elapsed });
    });
  });
}

function udpCheck({ host, port }) {
  return new Promise((resolve) => {
    const start = performance.now();
    const client = dgram.createSocket('udp4');

    const message = Buffer.from('ping');
    let timeoutHandle = setTimeout(() => {
      client.close();
      resolve({ alive: false, time: performance.now() - start, error: 'UDP timeout' });
    }, TIMEOUT_MS);

    client.once('message', (msg, rinfo) => {
      clearTimeout(timeoutHandle);
      client.close();
      resolve({ alive: true, time: performance.now() - start, response: msg.toString() });
    });

    client.send(message, 0, message.length, port, host, (err) => {
      if (err) {
        clearTimeout(timeoutHandle);
        client.close();
        resolve({ alive: false, time: performance.now() - start, error: err.message });
      }
    });
  });
}

function wsCheck({ host, port }) {
  return new Promise((resolve) => {
    const start = performance.now();
    const url = `ws://${host}:${port}`;
    const ws = new WebSocket(url);

    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ alive: false, time: performance.now() - start, error: 'WS timeout' });
    }, TIMEOUT_MS);

    ws.on('open', () => {
      clearTimeout(timer);
      const elapsed = performance.now() - start;
      ws.close();
      resolve({ alive: true, time: elapsed });
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      resolve({ alive: false, time: performance.now() - start, error: err.message });
    });
  });
}

function redisCheck({ host, port }) {
  return new Promise((resolve) => {
    const start = performance.now();
    const client = redis.createClient({ socket: { host, port, connectTimeout: TIMEOUT_MS } });

    const timer = setTimeout(() => {
      client.disconnect();
      resolve({ alive: false, time: performance.now() - start, error: 'Redis timeout' });
    }, TIMEOUT_MS + 100); // 给 redis 自己的超时留点余地

    client.on('error', (err) => {
      clearTimeout(timer);
      resolve({ alive: false, time: performance.now() - start, error: err.message });
    });

    client.connect()
      .then(() => {
        clearTimeout(timer);
        const elapsed = performance.now() - start;
        client.quit();
        resolve({ alive: true, time: elapsed });
      })
      .catch((err) => {
        clearTimeout(timer);
        resolve({ alive: false, time: performance.now() - start, error: err.message });
      });
  });
}

function zmqCheck({ endpoint }) {
  return new Promise(async (resolve) => {
    const start = performance.now();
    const sock = new zmq.Request();

    // 设置超时
    const timer = setTimeout(() => {
      sock.close();
      resolve({ alive: false, time: performance.now() - start, error: 'ZMQ timeout' });
    }, TIMEOUT_MS);

    try {
      await sock.connect(endpoint);
      await sock.send('ping');
      const [msg] = await sock.receive();
      clearTimeout(timer);
      const elapsed = performance.now() - start;
      sock.close();
      resolve({ alive: true, time: elapsed, response: msg.toString() });
    } catch (err) {
      clearTimeout(timer);
      sock.close();
      resolve({ alive: false, time: performance.now() - start, error: err.message });
    }
  });
}

// ------------------- 主流程 -------------------
async function runChecks() {
  console.log('=== 实例间通讯方式研究 ===\n');

  for (const inst of instances) {
    console.log(`检测 ${inst.name} (${inst.methods.join('/')}) ...`);

    for (const method of inst.methods) {
      let result;
      try {
        switch (method) {
          case 'tcp':
            result = await tcpCheck(inst);
            break;
          case 'udp':
            result = await udpCheck(inst);
            break;
          case 'ws':
            result = await wsCheck(inst);
            break;
          case 'redis':
            result = await redisCheck(inst);
            break;
          case 'zmq':
            result = await zmqCheck(inst);
            break;
          default:
            result = { alive: false, error: `未知检测方法 ${method}` };
        }
      } catch (e) {
        result = { alive: false, error: e.message };
      }

      const status = result.alive ? '✅ alive' : '❌ dead';
      const extra = result.error ? ` | error: ${result.error}` :
                    result.response ? ` | response: ${result.response}` : '';
      console.log(`  → ${method.toUpperCase()}: ${status} (t=${result.time?.toFixed(1)}ms)${extra}`);
    }

    console.log(''); // 空行分隔
  }

  console.log('=== 检测结束 ===');
}

// 直接执行
runChecks().catch(err => {
  console.error('运行时错误：', err);
});