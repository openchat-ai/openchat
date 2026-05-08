// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:46:14.615Z

/**
 * 实例间通讯方式研究
 * 1. TCP 心跳
 * 2. UDP ping
 * 3. ICMP ping
 * 4. WebSocket ping/pong
 *
 * 运行方式：node instance_ping.js
 */

const net = require('net');
const dgram = require('dgram');
const { exec } = require('child_process');
const WebSocket = require('ws');

// ---------- 目标实例列表 ----------
const targets = [
  { name: '实例A', host: '127.0.0.1', tcpPort: 9001, udpPort: 9002, wsPort: 9003 },
  // 可自行添加更多实例
];

// ---------- 工具函数 ----------
const timeout = ms => new Promise(res => setTimeout(res, ms));

/**
 * TCP 心跳检测
 * @param {string} host
 * @param {number} port
 * @param {number} t 用于超时的毫秒数
 */
function tcpPing(host, port, t = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isResolved = false;

    socket.setTimeout(t);
    socket.once('error', () => {
      if (!isResolved) {
        isResolved = true;
        resolve(false);
      }
    });
    socket.once('timeout', () => {
      if (!isResolved) {
        isResolved = true;
        resolve(false);
      }
      socket.destroy();
    });
    socket.connect(port, host, () => {
      if (!isResolved) {
        isResolved = true;
        resolve(true);
      }
      socket.end();
    });
  });
}

/**
 * UDP ping
 * 发送自定义消息，等待回包（仅适用于目标实例自行实现回包逻辑）
 * @param {string} host
 * @param {number} port
 */
function udpPing(host, port, t = 2000) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('PING');
    let isResolved = false;

    const timer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        resolve(false);
      }
      client.close();
    }, t);

    client.on('message', (msg, rinfo) => {
      if (!isResolved && msg.toString() === 'PONG') {
        isResolved = true;
        resolve(true);
      }
    });

    client.send(message, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        if (!isResolved) {
          isResolved = true;
          resolve(false);
        }
        client.close();
      }
    });
  });
}

/**
 * ICMP ping（使用系统 ping 命令）
 * @param {string} host
 */
function icmpPing(host, t = 2000) {
  return new Promise((resolve) => {
    // Windows 里使用 -n, Linux/macOS 使用 -c
    const pingCmd = process.platform === 'win32'
      ? `ping -n 1 -w ${t} ${host}`
      : `ping -c 1 -W ${Math.ceil(t / 1000)} ${host}`;

    exec(pingCmd, (error, stdout, stderr) => {
      resolve(!error);
    });
  });
}

/**
 * WebSocket ping/pong
 * @param {string} url
 */
function wsPing(url, t = 5000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { handshakeTimeout: t });
    let isResolved = false;

    ws.on('open', () => {
      ws.ping();
    });

    ws.on('pong', () => {
      if (!isResolved) {
        isResolved = true;
        resolve(true);
      }
      ws.close();
    });

    ws.on('error', () => {
      if (!isResolved) {
        isResolved = true;
        resolve(false);
      }
    });

    setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        resolve(false);
      }
      ws.terminate();
    }, t);
  });
}

// ---------- 主流程 ----------
(async () => {
  console.log('===== 实例间通讯方式研究 =====\n');

  for (const tgt of targets) {
    console.log(`--- 目标: ${tgt.name} (${tgt.host}) ---`);

    // 1. TCP 心跳
    const tcpOk = await tcpPing(tgt.host, tgt.tcpPort);
    console.log(`  TCP 心跳检测 (${tgt.tcpPort}): ${tcpOk ? '✅ 连接成功' : '❌ 连接失败'}`);

    // 2. UDP ping
    const udpOk = await udpPing(tgt.host, tgt.udpPort);
    console.log(`  UDP ping (${tgt.udpPort}): ${udpOk ? '✅ 收到 PONG' : '❌ 未收到回包'}`);

    // 3. ICMP ping
    const icmpOk = await icmpPing(tgt.host);
    console.log(`  ICMP ping: ${icmpOk ? '✅ 主机可达' : '❌ 主机不可达'}`);

    // 4. WebSocket ping/pong
    const wsUrl = `ws://${tgt.host}:${tgt.wsPort}`;
    const wsOk = await wsPing(wsUrl);
    console.log(`  WebSocket ping/pong: ${wsOk ? '✅ 连接成功' : '❌ 连接失败'}`);

    console.log(); // 空行分隔
    await timeout(500); // 为了防止输出过快
  }

  console.log('===== 研究结束 =====');
})();