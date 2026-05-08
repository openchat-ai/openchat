// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:54:15.492Z

// file: checkSisters.js
// Node.js (CommonJS) 示例代码 – 检测姐妹实例的多种通讯方式

const net = require('net');
const dgram = require('dgram');
const { exec } = require('child_process');
const WebSocket = require('ws'); // 需要先 npm i ws

// ---------------------- 配置 ----------------------
const TARGETS = [
  // 这里列出要检测的“姐妹实例”。根据实际情况自行增删。
  { name: 'ServiceA', host: '127.0.0.1', tcpPort: 3000, wsPort: 8080, udpPort: 4000 },
  { name: 'ServiceB', host: '192.168.1.20', tcpPort: 3001, wsPort: 8081, udpPort: 4001 },
];

const TIMEOUT_MS = 5000;

// ---------------------- 检测函数 ----------------------

// 1. TCP 端口探测
function checkTcp(target) {
  return new Promise((resolve) => {
    const socket = net.connect(
      { host: target.host, port: target.tcpPort },
      () => {
        socket.end();
        resolve({ ok: true, method: 'TCP', detail: `Connected to ${target.host}:${target.tcpPort}` });
      }
    );

    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy();
      resolve({ ok: false, method: 'TCP', detail: 'timeout' });
    });

    socket.on('error', (err) => {
      resolve({ ok: false, method: 'TCP', detail: err.message });
    });
  });
}

// 2. UDP 回声（需要目标实现回声服务）
function checkUdp(target) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('ping');
    let responded = false;

    const timer = setTimeout(() => {
      if (!responded) {
        client.close();
        resolve({ ok: false, method: 'UDP', detail: 'timeout' });
      }
    }, TIMEOUT_MS);

    client.on('message', (msg) => {
      responded = true;
      clearTimeout(timer);
      client.close();
      resolve({ ok: true, method: 'UDP', detail: `reply: ${msg.toString()}` });
    });

    client.send(message, 0, message.length, target.udpPort, target.host, (err) => {
      if (err) {
        clearTimeout(timer);
        client.close();
        resolve({ ok: false, method: 'UDP', detail: err.message });
      }
    });
  });
}

// 3. WebSocket 检测
function checkWebSocket(target) {
  return new Promise((resolve) => {
    const wsUrl = `ws://${target.host}:${target.wsPort}`;
    const ws = new WebSocket(wsUrl, { handshakeTimeout: TIMEOUT_MS });

    ws.on('open', () => {
      ws.terminate(); // 直接关闭即可，说明连通
      resolve({ ok: true, method: 'WebSocket', detail: `Connected to ${wsUrl}` });
    });

    ws.on('error', (err) => {
      resolve({ ok: false, method: 'WebSocket', detail: err.message });
    });
  });
}

// 4. 系统 ping（ICMP）
function checkPing(target) {
  return new Promise((resolve) => {
    // 根据不同平台使用不同参数
    const platform = process.platform;
    const cmd = platform === 'win32'
      ? `ping -n 1 -w ${TIMEOUT_MS} ${target.host}`
      : `ping -c 1 -W ${Math.floor(TIMEOUT_MS / 1000)} ${target.host}`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, method: 'ICMP Ping', detail: error.message });
      } else if (/ttl=/i.test(stdout) || /time=/i.test(stdout)) {
        resolve({ ok: true, method: 'ICMP Ping', detail: 'alive' });
      } else {
        resolve({ ok: false, method: 'ICMP Ping', detail: 'no reply' });
      }
    });
  });
}

// ---------------------- 主流程 ----------------------
async function runChecks() {
  for (const t of TARGETS) {
    console.log(`\n=== 检测 ${t.name} (${t.host}) ===`);

    const results = await Promise.all([
      checkTcp(t),
      checkWebSocket(t),
      checkPing(t),
      // 如果你已经有对应的 UDP 回声服务，可以打开下面这行：
      // checkUdp(t),
    ]);

    results.forEach((res) => {
      const status = res.ok ? '✅ 可达' : '❌ 不可达';
      console.log(`[${res.method}] ${status} - ${res.detail}`);
    });
  }
}

// 直接执行
runChecks().catch((e) => console.error('运行时错误:', e));