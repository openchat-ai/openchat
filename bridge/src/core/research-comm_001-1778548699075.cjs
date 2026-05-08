// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:18:19.075Z

/**
 * inter‑instance‑communication‑explorer.js
 *
 *  研究：除 HTTP ping 之外，还能用哪些方式检测“姐妹”(Sibling) 实例的存活状态？
 *
 *  思路：
 *   - 使用 UDP 组播 (multicast) 在局域网内广播心跳消息。
 *   - 每个“姐妹”进程都启动一个 UDP 接收端口，收到心跳后立即回复ACK。
 *   - 主进程定时发送心跳并监听 ACK，若超时未收到则认为该姐妹已离线。
 *   - 通过 console.log 打印每一次检测到的姐妹状态，演示可观测性。
 *
 *  运行方式：
 *   $ node inter-instance-communication-explorer.js
 *
 *  注意：此示例假设所有进程在同一台机器上运行，使用本地组播地址 239.0.0.1
 *        端口 41234。在真实的分布式环境中，只需要把组播地址换成可路由的地址即可。
 */

const dgram = require('dgram');
const os = require('os');

// ==== 配置 ====
const MULTICAST_ADDRESS = '239.0.0.1'; // 组播地址（本地只能收到本机发送的组播）
const PORT = 41234;                  // 心跳/ACK端口
const HEARTBEAT_INTERVAL_MS = 1000;   // 每秒发送一次心跳
const TIMEOUT_MS = 2000;              // 超时阈值（认为失联）
const SIBLINGS = ['sibling-1', 'sibling-2', 'sibling-3']; // 模拟的姐妹实例标识

// ==== 主进程（协调者） ====
const server = dgram.createSocket('udp4');
let siblingsStatus = {}; // { siblingId: { alive: true|false, lastSeen: timestamp } }

server.on('error', (err) => {
  console.error(`[Server] Socket error:\n${err.stack}`);
  server.close();
});

server.on('message', (msg, rinfo) => {
  // 收到的 ACK 消息格式：'ACK <siblingId>'
  const parts = msg.toString().split(' ');
  if (parts[0] === 'ACK' && parts[1]) {
    const id = parts[1];
    console.log(`[Server] Received ACK from ${id} (from ${rinfo.address}:${rinfo.port})`);
    siblingsStatus[id] = { alive: true, lastSeen: Date.now() };
  }
});

// 绑定到组播地址和端口
server.bind(PORT, () => {
  // 加入本机的网络接口加入组播组
  const iface = os.networkInterfaces();
  const addresses = (iface['Wi-Fi'] || iface['en0'] || iface['eth0'] || iface['eth0']).map(i => i.address);
  addresses.forEach(addr => {
    server.addMembership(MULTICAST_ADDRESS, addr);
  });
  console.log(`[Server] Listening on ${MULTICAST_ADDRESS}:${PORT}`);
});

// ==== 每个姐妹进程的行为 ====
function spawnSibling(id) {
  const sibling = dgram.createSocket('udp4');

  sibling.on('error', (err) => {
    console.error(`[${id}] Socket error:\n${err.stack}`);
    sibling.close();
  });

  sibling.on('message', (msg) => {
    // 收到心跳后回复 ACK
    const reply = `ACK ${id}`;
    const client = sibling.remoteAddress + ':' + sibling.remotePort;
    console.log(`[${id}] Received heartbeat from server (${client}) – replying ACK`);
    sibling.send(reply, 0, reply.length, PORT, MULTICAST_ADDRESS, (err) => {
      if (err) console.error(`[${id}] Send ACK error: ${err.message}`);
    });
  });

  // 监听指定端口（这里不需要绑定，直接使用同一端口的组播即可）
  sibling.bind(PORT, () => {
    console.log(`[${id}] Sibling process started, waiting for heartbeat...`);
  });

  // 心跳到期后主动发送心跳（这里不需要，主进程负责发送）
  // 但我们可以让 sibling 也定时发送一次心跳用于健康检测（可选）
  const heartbeatTimer = setInterval(() => {
    const msg = 'HEARTBEAT';
    sibling.send(msg, 0, msg.length, PORT, MULTICAST_ADDRESS, (err) => {
      if (err) console.error(`[${id}] Send heartbeat error: ${err.message}`);
    });
  }, HEARTBEAT_INTERVAL_MS);

  // 退出清理
  process.on('exit', () => clearInterval(heartbeatTimer));
}

// 启动所有姐妹进程
SIBLINGS.forEach((id) => {
  spawnSibling(id);
});

// ==== 主进程的心跳发送循环 ====
let lastSeen = {};

function broadcastHeartbeat() {
  const msg = 'PING';
  // 发送到组播地址，端口保持不变
  server.send(msg, 0, msg.length, PORT, MULTICAST_ADDRESS, (err) => {
    if (err) console.error(`[Server] Send heartbeat error: ${err.message}`);
  });

  // 检查超时的姐妹
  console.log('--- Heartbeat cycle ---');
  Object.keys(siblingsStatus).forEach((id) => {
    const info = siblingsStatus[id];
    if (info.alive) {
      const now = Date.now();
      if (!lastSeen[id] || now - info.lastSeen < TIMEOUT_MS) {
        console.log(`[Server] ${id} is alive`);
      } else {
        console.log(`[Server] ${id} timed out (no ACK for ${TIMEOUT_MS}ms)`);
        delete siblingsStatus[id];
      }
    }
  });

  // 清理已经失联的记录（如果在别处标记为 false，这里不处理）
  // 为下一轮做准备
  setTimeout(broadcastHeartbeat, HEARTBEAT_INTERVAL_MS);
}

// 开始第一次心跳循环
broadcastHeartbeat();

// ==== 进程退出处理 ====
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  server.close();
  process.exit(0);
});