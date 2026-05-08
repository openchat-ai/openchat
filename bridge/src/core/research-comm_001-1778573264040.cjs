// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:07:44.040Z

// sister-detect.js
// 运行方式：node sister-detect.js
// 采用 UDP 广播实现进程/实例之间的状态检测（不使用 HTTP ping）

const dgram = require('dgram');
const os = require('os');

// ==== 配置 ====
const PORT = 41234;                     // 统一的端口
const BROADCAST_ADDR = '255.255.255.255'; // 广播地址
const INTERVAL_MS = 1000;                // 发送间隔（ms）
const SISTER_TTL = 5;                    // 认为“姐妹”仍在存活的秒数（缓存时间）
const WHITELIST = new Set();             // 本实例的 IP（用于过滤自己的报文)

// 本机所有网卡的 IP（排除 127.0.0.1）
const localIps = os.networkInterfaces();
let myIp = null;
for (const name of Object.keys(localIps)) {
  for (const iface of localIps[name]) {
    if (iface.family === 'IPv4' && !iface.internal) {
      myIp = iface.address;
      break;
    }
  }
  if (myIp) break;
}
if (!myIp) {
  console.error('❌ 未能获取本机 IPv4 地址，请检查网络设置。');
  process.exit(1);
}
WHITELIST.add(myIp);
console.log(`🖥 本实例 IP: ${myIp}`);

// ==== 发送者 ====
const sendSocket = dgram.createSocket('udp4');
sendSocket.bind(); // 绑定任意端口
sendSocket.setBroadcast(true); // 允许广播

function sendPing() {
  const payload = Buffer.from(`PING ${process.pid} ${myIp}`);
  sendSocket.send(payload, 0, payload.length, PORT, BROADCAST_ADDR, (err) => {
    if (err) console.error('❌ 发送广播失败:', err.message);
    else console.log(`📤 已广播: ${payload.toString()}`);
  });
}

// ==== 接收者 & 姐妹状态表 ====
const sisters = new Map(); // key: ip, value: {pid, lastSeen}

// 清理过期的姐妹记录（每次收到报文时调用）
function purgeExpiredSisters() {
  const now = Date.now();
  for (const ip of sisters.keys()) {
    if (now - sisters.get(ip).lastSeen > SISTER_TTL * 1000) {
      console.log(`⏳ 姐妹 ${ip} 超时离线`);
      sisters.delete(ip);
    }
  }
}

// 处理收到的报文
function handleMessage(msg, rinfo) {
  // rinfo: { address, family, port, size }
  const raw = msg.toString().trim();
  const parts = raw.split(/\s+/);
  if (parts[0] !== 'PING') return; // 只处理我们自己的协议

  const pid = parts[1];
  const senderIp = parts[2];
  if (WHITELIST.has(senderIp)) {
    // 来自自己的报文，直接忽略
    return;
  }

  // 记录最新的姐妹信息
  sisters.set(senderIp, { pid, lastSeen: Date.now() });
  purgeExpiredSisters();

  console.log(`🔔 检测到姐妹报文: ${raw} 来自 ${senderIp}`);
  console.log(`   └─ 姐妹 PID: ${pid}, IP: ${senderIp}`);

  // 简单统计：打印当前已知的姐妹列表
  console.log('📊 当前已知姐妹列表:');
  for (const [ip, info] of sisters.entries()) {
    console.log(`   • ${ip} -> PID ${info.pid}`);
  }
}

// 开启接收const recvSocket = dgram.createSocket('udp4');
recvSocket.on('message', (msg, rinfo) => {
  handleMessage(msg, rinfo);
});
recvSocket.bind(PORT); // 绑定同一端口进行接收
recvSocket.on('error', (err) => {
  console.error('❌ 接收套接字错误:', err.message);
  recvSocket.close();
});

// ==== 定时发送 ====
setInterval(sendPing, INTERVAL_MS);
sendPing(); // 立即发送一次以快速触发发现过程

// ==== 程序退出处理 ====
process.on('SIGINT', () => {
  console.log('\n🛑 程序被中断，关闭套接字...');
  sendSocket.close();
  recvSocket.close();
  process.exit(0);
});