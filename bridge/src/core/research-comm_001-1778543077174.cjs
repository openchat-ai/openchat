// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:44:37.174Z

// 研究不同的实例间通讯方式（除 HTTP ping 之外）
// 通过 TCP 套接字、UDP 广播、以及子进程 IPC 进行状态检测
// 运行后会在 console 中输出检测结果

const net = require('net');
const dgram = require('dgram');
const os = require('os');

// -------------------
// 1️⃣ TCP 套接字检测// -------------------
const TCP_PORTS = [3000, 3001, 3002, 3003, 3004];
const tcpClients = [];

function tryTcpConnect(port, index) {
  const socket = new net.Socket();
  tcpClients.push({ port, index, socket });

  socket.connect(port, () => {
    console.log(`✅ TCP 连接成功: ${port}`);
    socket.end(); // 简单读取后关闭
  });

  socket.on('error', (err) => {
    // 连接失败不报错，等待后续手动触发
  });
}

// 尝试连接所有端口
TCP_PORTS.forEach(tryTcpConnect);

// 30 秒后关闭所有监听的套接字（防止无限占用）
setTimeout(() => {
  tcpClients.forEach(c => c.socket.destroy());
}, 30_000);

// -------------------
// 2️⃣ UDP 广播检测
// -------------------
const UDP_PORT = 41234;
const udpSocket = dgram.createSocket('udp4');

// 发送广播消息
udpSocket.on('message', (msg, rinfo) => {
  console.log(`📨 收到 UDP 回响: ${msg} 来自 ${rinfo.address}:${rinfo.port}`);
});

udpSocket.on('error', (err) => {
  console.error('❌ UDP 套接字错误:', err.message);
  udpSocket.close();
});

// 启动监听
udpSocket.bind(UDP_PORT, () => {
  const broadcastMsg = Buffer.from('SIBLING_CHECK');
  const broadcastAddr = '255.255.255.255';
  console.log(`📡 正在广播检测...（发送 ${broadcastMsg.toString()} 到 ${broadcastAddr}:${UDP_PORT}）`);
  udpSocket.send(broadcastMsg, 0, broadcastMsg.length, UDP_PORT, broadcastAddr, (err) => {
    if (err) console.error('❌ 发送广播失败:', err);
  });
});

// 5 秒后停止监听
setTimeout(() => {
  console.log('🛑 停止 UDP 广播监听');
  udpSocket.close();
}, 5_000);

// -------------------
// 3️⃣ 子进程 IPC 检测（示例）
// -------------------
const { fork } = require('child_process');

// 启动一个模拟的“姐妹”进程，它会通过 process.send() 向父进程发送信息
const siblingScript = `
  const os = require('os');
  const osObj = JSON.stringify({ pid: process.pid, hostname: os.hostname() });
  process.send({ type: 'STATUS', data: osObj });
  console.log('🧬 子进程已发送状态信息');
`;

const sibling = fork('child.js', [], { execPath: process.execPath });
sibling.on('message', (msg) => {
  if (msg && msg.type === 'STATUS') {
    console.log(`👾 子进程状态: ${msg.data}`);
  }
});
sibling.on('close', (code) => {
  console.log(`🔚 子进程退出码: ${code}`);
});

// 等待 10 秒后结束子进程
setTimeout(() => {
  sibling.kill();
}, 10_000);

// -------------------
// 4️⃣ 输出研究总结
// -------------------
setTimeout(() => {
  console.log('\n=== 研究结果汇总 ===');
  console.log('1. TCP 套接字：已尝试连接 5 个常用端口，若有占用会在控制台打印 ✅ 连接成功。');
  console.log('2. UDP 广播：向 255.255.255.255:41234 发送广播，若有其他进程响应会在控制台打印 📨 收到 UDP 回响。');
  console.log('3. 子进程 IPC：通过 fork() 与子进程通信，能够收到 👾 状态信息（仅示例）。');
  console.log('以上展示了除了 HTTP ping 之外的多种实例间检测方式，实际项目可根据网络环境选用合适的机制。');
}, 6_000);