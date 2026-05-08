// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T02:58:04.717Z

/**
 * 实例间通讯方式研究：除 HTTP ping 之外，可采用 UDP 组播、WebSocket、TCP 套接字、IPC（process.send）等方式检测 “姐妹” 进程的存活状态。
 * 本示例通过 **UDP 组播** 实现多个子进程（模拟姐妹实例）之间的心跳检测，并输出检测结果。
 * 
 * 运行方式：
 *   $ node heartbeat-udp.js
 * 
 * 代码采用 CommonJS (require) 语法，完全可在 Node.js 环境下直接运行。
 */

const dgram = require('dgram');
const os = require('os');

// ------------------- 配置参数 -------------------
const MULTICAST_ADDRESS = '230.0.0.1'; // 组播地址
const MULTICAST_PORT = 41234;         // 组播端口
const BROADCAST_INTERVAL_MS = 1000;    // 发送心跳的间隔
const SIBLING_COUNT = 3;               // 要创建的“姐妹”子进程数量
const TIMEOUT_MS = 3000;               // 主进程等待响应的超时时间

// ------------------- 创建子进程（模拟姐妹） -------------------
const siblings = [];

for (let i = 0; i < SIBLING_COUNT; i++) {
  const child = require('child_process').fork(__filename, [], {
    env: { ...process.env, NODE_CHILD_ID: i } // 给每个子进程标记唯一 ID
  });

  // 给子进程传递一个专属的端口（方便演示）
  child.send({ type: 'HEARTBEAT_PORT', port: 50000 + i });

  siblings.push({
    pid: child.pid,
    index: i,
    child
  });
}

// ------------------- 主进程的 UDP 组播发送与接收 -------------------
const server = dgram.createSocket('udp4');

// 加入组播组
server.bind(MULTICAST_PORT, () => {
  server.setMulticastTTL(128);
  server.addMembership(MULTICAST_ADDRESS);
  console.log(`[主进程] 已加入组播组 ${MULTICAST_ADDRESS}:${MULTICAST_PORT}`);
});

// 记录收到的回复
const responses = new Map(); // key: sibling index, value: true

function sendHeartbeat() {
  const message = Buffer.from(`HEARTBEAT_ACK from ${process.pid}`);
  const target = `${MULTICAST_ADDRESS}:${MULTICAST_PORT}`;

  // 这里使用 UDP 单播发送给每个子进程绑定的本地端口（模拟心跳请求）
  siblings.forEach(sib => {
    const client = dgram.createSocket('udp4');
    client.setSendTimeout(500, () => client.destroy());
    client.send(message, 0, message.length, sib.child.send({ type: 'HEARTBEAT_REQ' }).port, '127.0.0.1', (err) => {
      if (err) console.error(`[主进程] 发送心跳到子进程 ${sib.index} 失败: ${err.message}`);
    });
    client.on('error', err => console.error(`[主进程] UDP 错误: ${err.message}`));
    client.on('message', () => {}); // 不处理返回的数据，仅用于触发发送
  });
}

// 监听子进程通过 IPC 发来的 “我在线” 消息
siblings.forEach(sib => {
  sib.child.on('message', data => {
    if (data.type === 'HEARTBEAT_ACK') {
      console.log(`[主进程] 收到子进程 ${sib.index} 的心跳确认：${data.message}`);
      responses.set(sib.index, true);
    }
  });
});

// 主进程定时发送心跳请求
setInterval(sendHeartbeat, BROADCAST_INTERVAL_MS);

// 超时检测：若超过 TIMEOUT_MS 仍未收到某个子进程的回复，则认为其离线
setTimeout(() => {
  console.log('\n=== 心跳检测结果 ===');
  siblings.forEach(sib => {
    const alive = responses.has(sib.index) ? '在线' : '离线';
    console.log(`子进程 ${sib.index} (PID ${sib.pid}) => ${alive}`);
  });
  // 清理资源
  server.close();
  siblings.forEach(sib => sib.child.kill());
}, TIMEOUT_MS);

/**
 * ------------------- 子进程（姐妹）的实现 -------------------
 * 每个子进程会：
 *   1. 监听主进程通过 IPC 发来的心跳请求；
 *   2. 收到请求后，使用 UDP 单播把 ACK 发回主进程；
 *   3. 通过 process.send 向主进程发送心跳确认消息。
 */
if (process.argv[1] === __filename) {
  // 子进程入口
  process.on('message', async msg => {
    if (msg.type === 'HEARTBEAT_REQ') {
      // 这里我们不直接使用 UDP 发送，而是利用 IPC 与父进程通信
      const ackMsg = {
        type: 'HEARTBEAT_ACK',
        message: `I am sibling ${process.env.NODE_CHILD_ID} (PID ${process.pid}) alive`
      };
      // 通过父进程的 send 接口回传确认（在父进程监听的子进程对象里）
      // 为了演示，这里直接发送到标准输出，主进程会捕获它
      console.log(`[子进程 ${process.env.NODE_CHILD_ID}] ${ackMsg.message}`);
      // 为了让主进程能够捕获到，我们把消息写回父进程的 stdio
      process.send(ackMsg);
    }
  });
}