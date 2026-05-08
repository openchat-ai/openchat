// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:38:41.688Z

/**
 * 实例间通讯方式研究（除 HTTP ping 之外的检测方法）
 * 思路：
 * 1. 使用 UDP 广播在本地网络中广播心跳包，监听是否收到其他实例的响应。
 * 2. 使用 TCP 短连接尝试建立对等连接，若成功则说明对方在线。
 * 3. 通过进程内的文件锁（可选）作辅助验证。
 * 运行环境：Node.js (CommonJS) —  — 只依赖 Node 内置模块，无需额外依赖。
 */

const dgram = require('dgram');               // UDP
const os = require('os');                     // 获取本机网络信息
const net = require('net');                   // TCP
const fs = require('fs');
const path = require('path');

// ---------- 配置 ----------
const UDP_PORT = 41234;                       // 广播端口
const UDP_GROUP = '255.255.255.255';           // 广播地址
const UDP_MESSAGE = Buffer.from('PING');      // 心跳内容
const TCP_PORT = 41235;                       // TCP 端口（用于对等连接）
const CHECK_INTERVAL = 1000;                  // 发送/UDP 心跳的间隔（ms）
const DURATION_MS = 15000;                    // 整个探测过程的时长const LOCK_PATH = path.join(__dirname, '.lock'); // 文件锁路径（可选）
// -------------------------

// 1️⃣ UDP 广播发现
function startUdpDiscovery() {
  const socket = dgram.createSocket('udp4');
  socket.bind(); // 绑定到随机端口，自动允许发送广播

  // 设置广播选项
  socket.setBroadcast(true);

  // 记录发现的对端地址集合
  const discovered = new Set();

  // 发送心跳
  const sender = setInterval(() => {
    socket.send(UDP_MESSAGE, 0, UDP_MESSAGE.length, UDP_PORT, UDP_GROUP, (err) => {
      if (err) console.error('UDP send error:', err);
    });
  }, CHECK_INTERVAL);

  // 接收响应
  socket.on('message', (msg, rinfo) => {
    // 只接受相同内容的响应
    if (msg.equals(UDP_MESSAGE)) {
      const peer = `${rinfo.address}:${rinfo.port}`;
      discovered.add(peer);
      console.log(`[UDP] 收到来自 ${peer} 的响应`);
    }
  });

  // 超时结束后打印结果
  setTimeout(() => {
    clearInterval(sender);
    socket.close();
    console.log('\n=== UDP Discovery 完成 ===');
    console.log('已发现的姐妹实例（通过 UDP 广播）:', Array.from(discovered));
    console.log('-----------------------------------\n');
  }, DURATION_MS);
}

// 2️⃣ TCP 短连接检测（对等主动连接）
function startTcpProbe() {
  const server = net.createServer((socket) => {
    // 收到连接后立刻关闭（只为占位，表示端口已被占用）
    socket.end('OK');
  });
  server.listen(TCP_PORT, '0.0.0.0', () => {
    console.log(`[TCP] 正在监听 ${TCP_PORT} 端口，等待对等实例主动连接...`);
  });

  // 发起主动连接（模拟另一个实例的主动方）
  const client = new net.Socket();
  client.connect(TCP_PORT, '127.0.0.1', () => {
    console.log('[TCP] 主动连接成功，说明有实例在监听该端口');
    client.destroy(); // 立即关闭
  });
  client.on('error', (err) => {
    console.log('[TCP] 主动连接失败（可能没有实例在监听）', err.message);
  });

  // 超时结束后关闭服务器
  setTimeout(() => {
    server.close();
    console.log('[TCP] TCP 探测结束\n');
  }, DURATION_MS);
}

// 3️⃣ 文件锁（可选的进程级同步信息）
function acquireLock() {
  try {
    // 创建文件锁文件（独占）
    const fd = fs.openSync(LOCK_PATH, 'w');
    fs.writeSync(fd, 'locked', 'utf8');
    fs.closeSync(fd);
    console.log('[Lock] 成功获取文件锁（表示当前进程唯一）');
    // 运行结束后删除锁文件
    setTimeout(() => {
      try { fs.unlinkSync(LOCK_PATH); } catch (_) {}
    }, DURATION_MS);
  } catch (e) {
    console.log('[Lock] 文件锁已被占用，可能有其他实例在运行');
  }
}

// ---------- 主程序 ----------
console.log('=== 实例间通讯方式研究启动 ===');
console.log('探测时长:', DURATION_MS / 1000, '秒\n');

acquireLock();          // 可选的文件锁验证
startUdpDiscovery();   // UDP 广播方式
startTcpProbe();       // TCP 短连接方式

// 结束提示
setTimeout(() => {
  console.log('=== 所有探测结束 ===');
}, DURATION_MS);