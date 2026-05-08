// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:56:52.412Z

/**
 * sibling-status.js
 *
 * 研究实例间通讯方式：除了 HTTP Ping，尝试 TCP、UDP、Unix Socket（IPC）以及 Cluster 方式，
 * 通过发送/接收心跳来检测姐妹进程状态。
 *
 * 运行方式：
 *   node sibling-status.js
 *
 * 说明：
 *   - 父进程会创建一个子进程（子进程代码内部同样在这段脚本中定义）。
 *   - 父子通过四种方式各自监听对应端口/通道，并互相发送心跳。
 *   - 每隔 2 秒尝试一次，若 5 秒内无响应就认为子进程已挂掉。
 */

const net = require('net');      // TCP
const dgram = require('dgram');  // UDP
const { fork } = require('child_process');
const path = require('path');
const os = require('os');

// ======== 子进程代码（会被 fork） ========
const childCode = `
const net = require('net');
const dgram = require('dgram');
const os = require('os');

// 1️⃣ TCP 监听
const server = net.createServer((socket) => {
  socket.on('data', (msg) => {
    if (msg.toString() === 'PING') {
      socket.write('PONG');
    }
  });
});
server.listen(5000, () => console.log('[子进程] TCP 监听在 5000 端口'));

// 2️⃣ UDP 监听
const udpServer = dgram.createSocket('udp4');
udpServer.on('message', (msg, rinfo) => {
  if (msg.toString() === 'PING') {
    udpServer.send('PONG', rinfo.port, rinfo.address);
  }
});
udpServer.bind(6000, () => console.log('[子进程] UDP 监听在 6000 端口'));

// 3️⃣ Unix Socket（IPC）监听
const ipcPath = os.tmpdir() + '/ipc_socket_' + process.pid + '.sock';
const ipcServer = net.createServer((socket) => {
  socket.on('data', (msg) => {
    if (msg.toString() === 'PING') {
      socket.write('PONG');
    }
  });
});
ipcServer.listen(ipcPath, () => console.log('[子进程] Unix Socket 监听在', ipcPath));

// 4️⃣ Cluster 方式（借助 process.send）
process.on('message', (msg) => {
  if (msg === 'PING') process.send('PONG');
});
`;

// 将子进程代码写入临时文件
const fs = require('fs');
const tmpChildPath = path.join(os.tmpdir(), 'sibling_child.js');
fs.writeFileSync(tmpChildPath, childCode);

// ======== 父进程代码 ========

// 记录各通道最后一次收到回应的时间
const lastSeen = {
  tcp: 0,
  udp: 0,
  ipc: 0,
  cluster: 0,
};

// 1️⃣ TCP 心跳
const tcpClient = net.createConnection({ port: 5000 }, () => {
  console.log('[父进程] TCP 连接已建立');
});
tcpClient.on('data', (data) => {
  if (data.toString() === 'PONG') lastSeen.tcp = Date.now();
});
tcpClient.on('error', (err) => console.log('[父进程] TCP 错误:', err.message));

// 2️⃣ UDP 心跳
const udpClient = dgram.createSocket('udp4');
udpClient.on('message', (msg) => {
  if (msg.toString() === 'PONG') lastSeen.udp = Date.now();
});
udpClient.on('error', (err) => console.log('[父进程] UDP 错误:', err.message));

// 3️⃣ Unix Socket 心跳
const ipcPath = os.tmpdir() + '/ipc_socket_' + process.pid + '.sock';
const ipcClient = net.createConnection(ipcPath, () => {
  console.log('[父进程] Unix Socket 连接已建立');
});
ipcClient.on('data', (data) => {
  if (data.toString() === 'PONG') lastSeen.ipc = Date.now();
});
ipcClient.on('error', (err) => console.log('[父进程] IPC 错误:', err.message));

// 4️⃣ Cluster 方式心跳（通过 process.send）
const child = fork(tmpChildPath, [], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
child.on('message', (msg) => {
  if (msg === 'PONG') lastSeen.cluster = Date.now();
});
child.on('exit', (code, signal) => console.log('[父进程] 子进程退出，code:', code, 'signal:', signal));
child.on('error', (err) => console.log('[父进程] 子进程错误:', err));

// 心跳循环（每 2 秒发送一次）
setInterval(() => {
  const now = Date.now();

  // 发送 TCP
  tcpClient.write('PING');

  // 发送 UDP
  const udpMsg = Buffer.from('PING');
  udpClient.send(udpMsg, 6000, '127.0.0.1');

  // 发送 IPC
  ipcClient.write('PING');

  // 发送 Cluster
  child.send('PING');

  // 检查 5 秒内是否有回应
  const checks = ['tcp', 'udp', 'ipc', 'cluster'];
  checks.forEach((type) => {
    if (now - lastSeen[type] > 5000) {
      console.log(\`[父进程] \${type.toUpperCase()} 心跳超时，子进程可能已挂掉。\`);
    } else {
      console.log(\`[父进程] \${type.toUpperCase()} 心跳正常。\`);
    }
  });
  console.log('-----------------------------------');
}, 2000);