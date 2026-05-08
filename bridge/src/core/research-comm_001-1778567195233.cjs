// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:26:35.233Z

//研究：除 HTTP ping 之外，如何检测“姐妹”(Sibling) 实例的状态
// 方式：使用 UDP 多播 + 简单心跳协议 (Node.js CommonJS / require)
//
// 运行方式：
//   node sibling-detect.js
//
// 该脚本会:
//   1. 创建一个 UDP 多播组 (239.0.0.1:50000)
//   2. 以自己的 PID 发送一次心跳消息
//   3. 监听 2 秒内收到的心跳响应，记录发现的“姐妹”实例
//   4. 通过 console.log 输出调研结果
//
// 该代码可以直接在任何支持 Node.js 的环境下运行，无需额外依赖。

const dgram = require('dgram');
const os = require('os');

// ------------------- 配置 -------------------
const MULTICAST_GROUP = '239.0.0.1';
const PORT = 50000;
const HEARTBEAT_INTERVAL_MS = 1000; // 心跳间隔（可调）
const RESEARCH_DURATION_MS = 3000; // 研究时长（ms），用于自动停止监听

// 自己的标识（PID + 本机网卡 IP）
const SELF_PID = process.pid;
const SELF_IP = os.networkInterfaces()['en0'] ? 
                os.networkInterfaces()['en0'].find(n => n.family === 'IPv4')?.address ||
                os.networkInterfaces()['en1'] ? 
                os.networkInterfaces()['en1'].find(n => n.family === 'IPv4')?.address :
                '0.0.0.0'; // macOS 上常用的接口名示例，实际环境请自行修改const SELF_ID = `${SELF_IP}:${PORT}`;

// 创建 UDP 套接字
const socket = dgram.createSocket('udp4');

// ------------------- 发送心跳 -------------------
function sendHeartbeat() {
  const msg = Buffer.from(`HEARTBEAT ${SELF_ID}`);
  socket.send(msg, 0, msg.length, PORT, MULTICAST_GROUP, (err) => {
    if (err) console.error('发送心跳失败:', err);
    else console.log(`[SELF] 心跳发送至 ${MULTICAST_GROUP}:${PORT} (PID=${SELF_PID})`);
  });
}

// 每隔一段时间发送一次心跳
setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
sendHeartbeat(); // 立即发送一次

// ------------------- 接收并分析响应 -------------------
const receivedFrom = new Set(); // 用来去重已收到的“姐妹”

// 监听收到的消息socket.on('message', (msg, rinfo) => {
  // 只处理来自本地多播组的消息（排除自身的回响）
  if (rinfo.address === MULTICAST_GROUP && rinfo.port === PORT) {
    const raw = msg.toString();
    if (raw.startsWith('HEARTBEAT')) {
      const sender = raw.split(' ')[1]; // 例如 "192.168.1.5:50000"
      // 跳过自身的心跳（避免自检）
      if (sender !== SELF_ID) {
        if (!receivedFrom.has(sender)) {
          receivedFrom.add(sender);
          console.log(`[DETECTED] 发现姐妹实例: ${sender} (通过 UDP 多播) `);
        }
      }
    }
  }
});

// ------------------- 结束研究并输出结果 -------------------
setTimeout(() => {
  socket.close();
  console.log('\n=== 研究结束 ===');
  console.log(`本实例的 PID: ${SELF_PID}`);
  console.log(`检测到的姐妹实例数量: ${receivedFrom.size}`);
  console.log('检测到的姐妹列表:', Array.from(receivedFrom));
  console.log('（注：此示例假设在同一局域网内的其他运行本脚本的进程会相互响应）');
}, RESEARCH_DURATION_MS);