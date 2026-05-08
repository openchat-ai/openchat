// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:30:54.443Z

/**
 *研究：实例间通讯方式（除 HTTP ping 之外的检测姐妹状态的方法）
 * 目标：演示一种基于 UDP 多播 + 文件锁的轻量级 “姐妹实例” 状态感知方案
 * 运行方式：node sister-detect.js
 * 说明：该脚本会尝试在本机加入指定的多播组（233.0.0.1:41234），
 *       周期性发送 “heartbeat”，并在收到其他实例的回应时打印日志。
 *       为了模拟多个姐妹进程，这里用 fork + cluster 示例（仅在本机演示）。
 */

const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');

// ------------------- 配置 -------------------
const MULTICAST_ADDR = '233.0.0.1';
const PORT = 41234;
const INTERVAL_MS = 2000;               // 心跳发送间隔
const HEARTBEAT_MSG = 'HEARTBEAT';      // 简单的心跳消息
const LOCK_PATH = path.join(__dirname, 'sister.lock'); // 文件锁用于标记存活

// ------------------- 工具函数 -------------------
/**
 * 创建一个 UDP 多播发送/接收socket
 */
function createMulticastSocket() {
  const sock = dgram.createSocket('udp4');
  // 绑定任意本地地址（这里使用默认的0.0.0.0）
  sock.bind();
  // 加入多播组
  sock.addMembership(MULTICAST_ADDR, '0.0.0.0');
  return sock;
}

/**
 * 发送心跳消息 */
function sendHeartbeat(sock) {
  const msg = Buffer.from(HEARTBEAT_MSG);
  // 发送到组地址和端口
  sock.send(msg, PORT, MULTICAST_ADDR, (err) => {
    if (err) console.error('发送心跳失败:', err);
  });
}

/**
 * 处理收到的心跳（来自其他姐妹实例）
 */
function onMessage(msg, rinfo) {
  if (msg.toString() === HEARTBEAT_MSG) {
    console.log(`✅ 收到姐妹实例心跳来自 ${rinfo.address}:${rinfo.port}`);
    // 更新锁文件的时间戳，标记最近一次看到姐妹
    try {
      const stats = fs.statSync(LOCK_PATH);
      console.log(`   最后一次心跳距今 ${(Date.now() - stats.mtimeMs) / 1000} 秒`);
    } catch (_) {}
  }
}

// ------------------- 主逻辑 -------------------
(async () => {
  // 1️⃣ 创建 UDP 多播 socket
  const sock = createMulticastSocket();

  // 2️⃣ 绑定消息处理函数
  sock.on('message', (msg, rinfo) => onMessage(msg, rinfo));

  // 3️⃣ 周期性发送心跳
  setInterval(() => {
    sendHeartbeat(sock);
  }, INTERVAL_MS);

  // 4️⃣ 创建文件锁（若不存在则创建，用来记录最近一次心跳时间）
  try {
    if (!fs.existsSync(LOCK_PATH)) {
      fs.writeFileSync(LOCK_PATH, new Date().toISOString());
    }
  } catch (e) {
    console.error('创建/更新锁文件失败:', e);
  }

  // 5️⃣ 记录启动时间并打印提示
  console.log('🚀 姐妹检测服务已启动');
  console.log(`   多播组: ${MULTICAST_ADDR}:${PORT}`);
  console.log(`   心跳间隔: ${INTERVAL_MS} ms`);
  console.log('   按 Ctrl+C 停止后可看到是否仍有姐妹实例回应');

  // 6️⃣ 捕获退出事件，清理资源
  process.on('SIGINT', () => {
    console.log('\n🛑 收到退出信号，关闭 socket...');
    sock.close();
    process.exit(0);
  });
})();