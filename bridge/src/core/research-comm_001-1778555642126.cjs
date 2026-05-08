// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:14:02.126Z

const cluster = require('cluster');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_MASTER = cluster.isMaster;
const STATE_FILE = path.join(__dirname, '.sibling_state.json');

// 初始化状态文件
function initStatusFile() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    workers: {},
    timestamp: Date.now()
  }));
}

// 更新工作进程状态到文件
function updateWorkerStatus(workerId, status) {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  state.workers[workerId] = { status, timestamp: Date.now() };
  state.timestamp = Date.now();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

// 从文件读取所有工作进程状态
function getAllWorkerStatuses() {
  if (!fs.existsSync(STATE_FILE)) return {};
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  return state.workers;
}

if (IS_MASTER) {
  console.log('=== 主进程启动 ===');
  console.log('PID:', process.pid);
  
  const numCPUs = os.cpus().length;
  const numWorkers = Math.min(2, numCPUs); // 限制 worker 数量
  
  initStatusFile();
  
  // 启动 worker 进程
  for (let i = 0; i < numWorkers; i++) {
    const worker = cluster.fork();
    console.log(`启动 Worker ${worker.id}`);
  }
  
  // 监听 worker 退出事件
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.id} 退出 (code: ${code}, signal: ${signal})`);
    updateWorkerStatus(worker.id, 'offline');
  });
  
  // 定期检查工作进程状态
  setInterval(() => {
    console.log('\n--- 当前所有 Worker 状态 ---');
    const statuses = getAllWorkerStatuses();
    for (const [id, info] of Object.entries(statuses)) {
      const age = Date.now() - info.timestamp;
      console.log(`Worker ${id}: ${info.status} (更新于 ${age}ms 前)`);
    }
  }, 2000);
  
  // 测试：模拟发送信号给所有 worker
  setTimeout(() => {
    console.log('\n=== 发送 SIGUSR1 信号给所有 Worker 测试心跳 ===');
    for (const id in cluster.workers) {
      cluster.workers[id].kill('SIGUSR1');
    }
  }, 3000);
  
} else {
  // Worker 进程
  console.log(`Worker ${process.pid} 启动`);
  
  let heartbeatCount = 0;
  
  // 处理来自主进程的消息
  process.on('message', (msg) => {
    if (msg.type === 'ping') {
      console.log(`Worker ${process.pid} 收到 ping`);
      process.send({ type: 'pong', from: process.pid });
    }
  });
  
  // 处理信号
  process.on('SIGUSR1', () => {
    heartbeatCount++;
    console.log(`Worker ${process.pid} 收到 SIGUSR1 信号 (心跳 #{heartbeatCount})`);
    updateWorkerStatus(process.pid, 'online');
  });
  
  // 定期向主进程报告状态
  setInterval(() => {
    updateWorkerStatus(process.pid, 'online');
    process.send({ type: 'status', workerId: process.pid, status: 'online' });
  }, 1500);
  
  // 定期启动 TCP 检查服务器
  const TCP_PORT = 3000 + process.pid % 100;
  
  const server = net.createServer((socket) => {
    console.log(`Worker ${process.pid} TCP 检查服务器收到连接`);
    socket.write(JSON.stringify({ workerId: process.pid, status: 'online', timestamp: Date.now() }));
    socket.end();
  });
  
  server.listen(TCP_PORT, () => {
    console.log(`Worker ${process.pid} TCP 检查服务器启动 (端口 ${TCP_PORT})`);
  });
  
  // 优雅退出
  process.on('SIGTERM', () => {
    console.log(`Worker ${process.pid} 收到 SIGTERM，准备退出`);
    updateWorkerStatus(process.pid, 'offline');
    process.exit(0);
  });
}