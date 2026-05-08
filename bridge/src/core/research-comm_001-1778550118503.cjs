// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:41:58.503Z

// 文件名：sister-discovery-udp.js
// 运行方式：node sister-discovery-udp.js
// 依赖：Node.js ≥12（CommonJS）

const dgram = require('dgram');
const os = require('os');

// ------------------- 配置 -------------------
const PORT = 2333;                     // 组播端口
const GROUP = '233.3.3.3';               // 组播组地址（本地仅限）
const INTERVAL_MS = 1000;               // 发送间隔（每秒一次）
const DURATION_MS = 5000;               // 程序运行多久后自动退出（仅用于演示）
const MSG_TEMPLATE = (pid, ip, timestamp) => `SISTER|${pid}|${ip}|${timestamp}`;

// ------------------- 获取本机信息 -------------------
const interfaces = os.networkInterfaces();
let localIP = '';
for (const name of Object.keys(interfaces)) {
  for (const iface of interfaces[name]) {
    if (iface.family === 'IPv4') {
      localIP = iface.address;
      break;
    }
  }
}
if (!localIP) {
  console.error('❌ 未找到 IPv4 地址，程序退出。');
  process.exit(1);
}
const pid = process.pid;
const now = new Date().toISOString();

// 组装发送的消息
const msg = Buffer.from(MsgTemplate(pid, localIP, now));

// ------------------- 创建 UDP 套接字 -------------------
const socket = dgram.createSocket('udp4');

// 设置加入组播组的选项
socket.setSendIpAddrs(true); // 让 send() 使用默认网卡
socket.setAddressOption('ipv4', GROUP, 1); // 加入组播组

// 加入组播组
socket.on('error', (err) => {
  console.error(`❌ 套接字错误: ${err.stack}`);
  socket.close();
});

socket.on('message', (msg, rinfo) => {
  try {
    const raw = msg.toString();
    if (raw.startsWith('SISTER|')) {
      const parts = raw.split('|');
      const siblingPid = parts[1];
      const siblingIP = parts[2];
      console.log(`✅ 收到姐妹实例消息 → PID: ${siblingPid}, IP: ${siblingIP}`);
    }
  } catch (e) {
    // ignore unrelated messages
  }
});

// 发送组播报文
const sendPulse = () => {
  socket.send(msg, 0, msg.length, PORT, GROUP, (err) => {
    if (err) console.error(`❌ 发送失败: ${err.message}`);
  });
};

// ------------------- 主循环 -------------------
console.log(`🔧 本实例 PID=${pid} IP=${localIP} 开始组播发现`);
console.log(`   向 ${GROUP}:${PORT} 发送 ${msg.length} 字节报文`);
console.log('   监听收到的姐妹实例消息（每 1 秒一次）');

// 每 INTERVAL_MS 发送一次心跳
const timer = setInterval(sendPulse, INTERVAL_MS);

// 自动结束（仅用于演示）
setTimeout(() => {
  clearInterval(timer);
  socket.dropMembership(GROUP);
  socket.close();
  console.log('🛑 检测结束，程序退出。');
}, DURATION_MS);