// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:20:22.276Z

constdgram = require('dgram');
const os = require('os');
const net = require('net');

// ==== 配置 ====
// 假设同机其他实例的 IP 与端口（实际使用时请替换为真实地址）
const siblingInfos = [
  { host: '127.0.0.1', port: 3000 },
  { host: '127.0.0.1', port: 3001 },
  { host: '127.0.0.1', port: 3002 }
];

// UDP 组播用于发现（组播地址 + 端口）
const UDP_GROUP = '239.255.0.1';
const UDP_PORT = 41234;

// ==== 1. TCP 连接检测（模拟 HTTP ping） ====
function tcpProbe(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', (err) => {
      resolve(false);
    });
    // 设置超时，防止卡死
    socket.setTimeout(500, () => {
      socket.end();
      resolve(false);
    });
  });
}

// ==== 2. UDP 组播发现 ====
function udpBroadcast() {
  return new Promise((resolve) => {
    const server = dgram.createSocket('udp4');
    server.on('message', (msg) => {
      if (msg.toString().trim() === 'SIBLING_ALIVE') {
        resolve(true);
        server.close();
      }
    });
    server.on('error', (err) => {
      resolve(false);
    });
    server.bind(UDP_PORT);
    // 发送一次广播
    const client = dgram.createSocket('udp4');
    client.send('SIBLING_ALIVE', 0, UDP_PORT, UDP_GROUP, UDP_PORT, (err) => {
      if (err) resolve(false);
    });
  });
}

// ==== 主函数 ====
(async () => {
  console.log('=== 开始研究实例间通讯方式 ===');

  // 1) TCP 连接检测结果
  console.log('\n--- TCP 连接检测结果 ---');
  for (const info of siblingInfos) {
    const alive = await tcpProbe(info.host, info.port);
    console.log(`[TCP] ${info.host}:${info.port} -> ${alive ? '存活' : '不可达'}`);
  }

  // 2) UDP 组播发现结果
  console.log('\n--- UDP 组播发现结果 ---');
  const udpAlive = await udpBroadcast();
  console.log(`[UDP] 组播发现 -> ${udpAlive ? '检测到至少一实例' : '未检测到'}`);

  // 3) 进一步示例：使用共享文件锁（可选）
  // 这里仅示意，实际可使用 fs.open with 'a' + flock
  console.log('\n--- 共享文件锁示例（仅演示）---');
  const fs = require('fs');
  const lockPath = '/tmp/sibling.lock';
  try {
    // 尝试独占获取锁（如果文件不存在则创建）
    const fd = fs.openSync(lockPath, 'a');
    const released = fs.writeSync(fd, 'lock acquired\n', null, 'utf8');
    fs.closeSync(fd);
    console.log('[Lock] 成功获取文件锁（示例），表示进程间可见性');
  } catch (e) {
    console.log('[Lock] 文件锁不可用或已被占用');
  }

  console.log('\n=== 研究结束 ===');
})();