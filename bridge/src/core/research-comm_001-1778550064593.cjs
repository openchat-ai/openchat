// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:41:04.593Z

/**
 *  实例间通讯方式研究：除了 HTTP ping，还有哪些方式可以检测姐妹状态？
 *  这里我们使用 UDP 多播 + 简单心跳协议来探测同网段内的“姐妹”实例。
 *  运行方式（在同一台机器上打开多个终端）：

 *    node sibling-detector.js   # 每个终端会自动成为发送方 & 接收方
 *
 *  代码会：
 *   1. 加入本地多播组 (239.0.0.1, 41234)
 *   2. 每隔 1 秒向组播地址发送 "HEARTBEAT" 字符串（UDP 广播）
 *   3. 监听同一组播地址的返回消息（来自其他进程的回应）
 *   4. 通过计数器判断是否检测到至少一个回应，并打印结果
 *
 *  该示例兼容 Node.js CommonJS (require) 环境，可直接运行。
 */

const dgram = require('dgram');
const os = require('os');

// ==== 配置 ====
const MULTICAST_ADDRESS = '239.0.0.1'; // 组播地址（本地网络可用）
const PORT = 41234;                  // 组播端口
const HEARTBEAT_INTERVAL_MS = 1000;  // 心跳发送间隔
const RESPONSE_TIMEOUT_MS = 2000;    // 等待回应的超时时间
const LOCAL_INTERFACE = '0.0.0.0';    // 绑定的本地网卡（0.0.0.0 表示任意）

// ==== 创建 UDP 套接字 ====
// 1) 发送端：支持多播
const sender = dgram.createSocket({ type: 'udp4', proto: 'udp4' });
sender.setAddress(LOCAL_INTERFACE);
sender.setPort(0); // 让系统自动分配端口// 2) 接收端：加入组播组
const receiver = dgram.createSocket({ type: 'udp4', proto: 'udp4' });
receiver.bind(PORT, LOCAL_INTERFACE); // 绑定到本地端口
receiver.addMembership(MULTICAST_ADDRESS, 0); // 加入组播组

// ==== 心跳发送逻辑 ====
let heartbeatCount = 0;
function sendHeartbeat() {
  const message = Buffer.from(`HEARTBEAT ${process.pid}`);
  // 发送到组播地址和端口
  sender.send(message, 0, message.length, PORT, MULTICAST_ADDRESS, (err) => {
    if (err) console.error('❗ 发送心跳失败:', err);
    else console.log(`🟢 已发送心跳 ${heartbeatCount++}`);
  });
}

// 开启定时器，周期性发送心跳
setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

// ==== 接收逻辑 ====
let detectedSiblings = new Set(); // 记录检测到的“姐妹”进程（通过 PID 区分）

receiver.on('message', (msg, rinfo) => {
  // 收到的消息格式：HEARTBEAT <pid>
  const parts = msg.toString().split(' ');
  if (parts[0] !== 'HEARTBEAT') return; // 只处理我们的心跳协议

  const senderPid = parseInt(parts[1], 10);
  const senderAddress = rinfo.address;
  const senderPort = rinfo.port;

  // 记录检测到的 sibling
  detectedSiblings.add(senderPid);
  console.log(`🔎 收到回应来自 PID ${senderPid} (${senderAddress}:${senderPort})`);
});

// ==== 启动探测并输出最终结果 ====
function startExploration() {
  console.log('🚀 开始使用 UDP 多播探测姐妹状态...');
  console.log(`   组播地址: ${MULTICAST_ADDRESS}:${PORT}`);
  console.log(`   本机网卡: ${LOCAL_INTERFACE}`);
  console.log('   按 Ctrl+C 退出后会打印检测到的姐妹数量。\n');

  // 设置一个一次性计时器，在一定时间后打印统计信息并退出
  const explorationDuration = 10 * 1000; // 10 秒探测窗口
  setTimeout(() => {
    console.log('\n===== 探测结束 =====');
    console.log(`检测到的姐妹进程数量: ${detectedSiblings.size}`);
    if (detectedSiblings.size > 0) {
      detectedSiblings.forEach(pid => {
        console.log(`   - PID ${pid} 在 ${MULTICAST_ADDRESS}:${PORT} 上回应`);
      });
    } else {
      console.log('   未发现任何回应的姐妹进程。');
    }
    // 关闭套接字，结束进程
    sender.close();
    receiver.close();
    process.exit(0);
  }, explorationDuration);
}

// 捕获退出信号，确保资源被释放
process.on('SIGINT', () => {
  console.log('\n🛑 手动中断，即时结束探测。');
  sender.close();
  receiver.close();
  process.exit(0);
});

// 启动探测
startExploration();