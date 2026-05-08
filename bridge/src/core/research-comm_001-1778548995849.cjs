// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:23:15.849Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const cluster = require('cluster');
const os = require('os');

console.log('=== 实例间通讯方式研究 ===\n');

// 模拟多个检测方式
async function main() {
  console.log('1. TCP Socket 探测（端口连通性）');
  await tcpProbe();
  
  console.log('\n2. UDP 广播探测');
  await udpBroadcastProbe();
  
  console.log('\n3. 文件系统状态监控');
  fileBasedDetection();
  
  console.log('\n4. Cluster 模块 IPC');
  demonstrateClusterIPC();
  
  console.log('\n5. 共享内存探针（模拟）');
  sharedMemoryProbe();
}

// 1. TCP Socket 探测
async function tcpProbe() {
  const targetHost = 'localhost';
  const targetPort = 3333;
  
  // 启动一个简单的TCP服务器（模拟另一实例）
  const server = net.createServer((socket) => {
    socket.write('PONG\n');
    socket.end();
  });
  
  server.listen(targetPort, () => {
    console.log(`  TCP服务器监听 ${targetPort}`);
  });
  
  // 客户端探测
  const client = new net.Socket();
  client.setTimeout(2000);
  
  client.connect(targetPort, targetHost, () => {
    client.write('PING\n');
  });
  
  client.on('data', (data) => {
    console.log(`  收到响应: ${data.toString().trim()}`);
    console.log('  ✓ TCP探测成功');
  });
  
  client.on('error', (err) => {
    console.log(`  ✗ TCP探测失败: ${err.message}`);
  });
  
  setTimeout(() => {
    client.destroy();
    server.close();
  }, 1000);
}

// 2. UDP 广播探测
async function udpBroadcastProbe() {
  const client = dgram.createSocket('udp4');
  const PORT = 4545;
  
  client.on('message', (msg, rinfo) => {
    console.log(`  收到来自 ${rinfo.address}:${rinfo.port} 的消息: ${msg}`);
    console.log('  ✓ UDP广播探测成功');
  });
  
  client.bind(PORT, () => {
    client.addMembership('224.0.0.114');
    client.setBroadcast(true);
    client.send('HEARTBEAT', PORT, '255.255.255.255');
  });
  
  setTimeout(() => {
    client.close();
  }, 500);
}

// 3. 文件系统状态监控
function fileBasedDetection() {
  const stateFile = path.join(__dirname, '.instance_state');
  
  // 写入状态
  const state = {
    pid: process.pid,
    timestamp: Date.now(),
    status: 'alive',
    hostname: os.hostname()
  };
  
  fs.writeFileSync(stateFile, JSON.stringify(state));
  console.log(`  状态文件已写入: ${stateFile}`);
  
  // 读取状态
  if (fs.existsSync(stateFile)) {
    const data = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(data);
    console.log(`  实例状态: PID=${parsed.pid}, 状态=${parsed.status}`);
    console.log('  ✓ 文件系统检测成功');
  }
  
  // 清理
  fs.unlinkSync(stateFile);
}

// 4. Cluster 模块 IPC
function demonstrateClusterIPC() {
  if (cluster.isPrimary) {
    console.log(`  主进程 PID: ${process.pid}`);
    
    // 模拟子进程
    const worker = cluster.fork();
    
    worker.on('message', (msg) => {
      console.log(`  主进程收到子进程消息: ${msg}`);
      console.log('  ✓ Cluster IPC 成功');
    });
    
    setTimeout(() => {
      worker.kill();
      cluster.disconnect();
    }, 500);
  } else {
    // 子进程
    process.send('子进程正在运行中...');
  }
}

// 5. 共享内存探针（模拟）
function sharedMemoryProbe() {
  const shmKey = 'INSTANCE_STATUS';
  const shmFile = path.join(__dirname, `.shm_${shmKey}`);
  
  const status = {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: Date.now()
  };
  
  fs.writeFileSync(shmFile, JSON.stringify(status));
  console.log(`  共享内存标记写入: ${shmFile}`);
  
  const data = fs.readFileSync(shmFile, 'utf8');
  const parsed = JSON.parse(data);
  console.log(`  运行时长: ${parsed.uptime.toFixed(2)}s`);
  console.log('  ✓ 共享内存探针成功');
  
  fs.unlinkSync(shmFile);
}

// 运行
main().catch(console.error);

console.log('\n=== 探测方式总结 ===');
console.log('1. TCP Socket - 低延迟端口连通性检测');
console.log('2. UDP Broadcast - 广播式心跳检测');
console.log('3. 文件系统 - 简单可靠的状态共享');
console.log('4. Cluster IPC - 进程内高效通信');
console.log('5. 共享内存 - 快速状态读写');
console.log('\n每种方式都可以用于不同场景的实例状态检测！');