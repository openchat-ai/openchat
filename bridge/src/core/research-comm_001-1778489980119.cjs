// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T08:59:40.119Z

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');

// 临时目录用于文件通信
const TEMP_DIR = path.join(os.tmpdir(), 'ipc-demo');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

console.log('=== 实例间通信方式研究 ===\n');

// 方法1: 使用 fork 发送消息 (Process.send)
function demonstrateForkIPC() {
  console.log('1. Fork IPC (Process.send):');
  
  const forked = childProcess.fork(__filename, ['worker']);
  
  forked.on('message', (msg) => {
    console.log(`   收到来自 worker 的消息: ${msg.type}`);
  });
  
  forked.send({ type: 'status-check', from: 'parent' });
  
  setTimeout(() => {
    console.log('   Fork IPC 成功建立消息通道\n');
    forked.kill();
  }, 500);
}

// 方法2: Unix 域套接字
function demonstrateUnixSocketIPC() {
  console.log('2. Unix Domain Socket IPC:');
  
  const socketPath = path.join(TEMP_DIR, 'ipc.sock');
  
  // 服务器端
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      const msg = JSON.parse(data.toString());
      console.log(`   Socket 收到: ${msg.status}`);
      socket.write(JSON.stringify({ status: 'alive', timestamp: Date.now() }));
    });
  });
  
  server.listen(socketPath, () => {
    console.log('   Unix Socket 服务器启动');
    
    // 客户端
    const client = net.connect(socketPath, () => {
      client.write(JSON.stringify({ status: 'ping', from: 'sibling' }));
    });
    
    client.on('data', (data) => {
      console.log(`   Socket 响应: ${data.toString()}`);
      server.close();
      fs.unlinkSync(socketPath);
      console.log('   Unix Socket IPC 成功\n');
    });
  });
}

// 方法3: 文件心跳检测
function demonstrateFileHeartbeat() {
  console.log('3. File Heartbeat IPC:');
  
  const heartbeatFile = path.join(TEMP_DIR, 'heartbeat.json');
  const peerPid = process.pid + 1000; // 模拟姐妹进程PID
  
  // 写入心跳
  fs.writeFileSync(heartbeatFile, JSON.stringify({
    pid: peerPid,
    status: 'active',
    timestamp: Date.now()
  }));
  
  // 读取心跳
  const heartbeat = JSON.parse(fs.readFileSync(heartbeatFile, 'utf8'));
  console.log(`   姐妹进程 heartbeat: PID=${heartbeat.pid}, 状态=${heartbeat.status}`);
  
  // 检查是否存在
  if (fs.existsSync(heartbeatFile)) {
    const age = Date.now() - heartbeat.timestamp;
    console.log(`   心跳年龄: ${age}ms, 状态: ${age < 5000 ? '在线' : '离线'}`);
  }
  
  fs.unlinkSync(heartbeatFile);
  console.log('   File Heartbeat IPC 成功\n');
}

// 方法4: 共享内存 (SharedArrayBuffer)
function demonstrateSharedMemoryIPC() {
  console.log('4. Shared Memory IPC:');
  
  const sharedBuffer = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sharedBuffer);
  int32[0] = 1; // 1 = 在线, 0 = 离线
  
  console.log(`   共享内存状态: ${int32[0] ? '在线' : '离线'}`);
  console.log('   SharedArrayBuffer 创建成功\n');
}

// 方法5: 消息队列模拟 (使用文件)
function demonstrateMessageQueue() {
  console.log('5. Message Queue IPC:');
  
  const queueFile = path.join(TEMP_DIR, 'message_queue.json');
  const messages = [];
  
  // 模拟发送消息
  messages.push({ from: 'sibling', type: 'status', data: 'active', time: Date.now() });
  
  fs.writeFileSync(queueFile, JSON.stringify(messages));
  
  const received = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  console.log(`   收到 ${received.length} 条消息`);
  received.forEach(msg => console.log(`   消息: ${msg.type} = ${msg.data}`));
  
  fs.unlinkSync(queueFile);
  console.log('   Message Queue IPC 成功\n');
}

// 方法6: 信号量机制 (process.kill with signals)
function demonstrateSignalIPC() {
  console.log('6. Signal-based IPC:');
  
  console.log(`   当前进程 PID: ${process.pid}`);
  console.log('   可通过 process.kill(targetPid, "SIGUSR1") 发送自定义信号');
  console.log('   姐妹进程监听 SIGUSR1 信号进行状态通知\n');
}

// 运行所有演示
console.log('正在演示各种IPC方式...\n');

if (process.argv.includes('worker')) {
  // worker 进程
  process.on('message', (msg) => {
    console.log(`Worker 收到: ${msg.type}`);
    process.send({ type: 'worker-response', status: 'ready' });
  });
} else {
  // 主进程
  demonstrateForkIPC();
  demonstrateUnixSocketIPC();
  demonstrateFileHeartbeat();
  demonstrateSharedMemoryIPC();
  demonstrateMessageQueue();
  demonstrateSignalIPC();
  
  console.log('=== IPC 方法总结 ===');
  console.log('1. Fork IPC: 高效，支持双向异步消息');
  console.log('2. Unix Socket: 跨进程通信，低延迟');
  console.log('3. File Heartbeat: 简单可靠，适合状态检测');
  console.log('4. Shared Memory: 最快，适合频繁数据交换');
  console.log('5. Message Queue: 解耦通信，支持异步');
  console.log('6. Signals: 轻量通知，适合简单状态');
}