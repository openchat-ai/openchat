// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:02:51.267Z

const cluster = require('cluster');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 研究不同实例间通讯方式
console.log('=== 实例间通讯方式研究 ===\n');

// 主进程
if (cluster.isMaster) {
  console.log('主进程启动，创建工作进程...\n');
  
  const numWorkers = 3;
  const workers = [];
  
  // 创建工作进程
  for (let i = 0; i < numWorkers; i++) {
    const worker = cluster.fork();
    workers.push(worker);
    console.log(`工作进程 ${i + 1} 已创建，PID: ${worker.process.pid}`);
  }
  
  // 方法1: 使用 process.send() IPC 通讯
  console.log('\n--- 方法1: process.send() IPC ---');
  workers.forEach((worker, index) => {
    worker.send({ type: 'HEARTBEAT', workerId: index + 1 });
  });
  
  // 接收来自工作进程的消息
  workers.forEach((worker, index) => {
    worker.on('message', (msg) => {
      console.log(`主进程收到工作${index + 1}的消息:`, msg);
    });
  });
  
  // 方法2: TCP Socket 心跳检测
  console.log('\n--- 方法2: TCP Socket 状态检测 ---');
  const tcpServers = [];
  const ports = [3001, 3002, 3003];
  
  workers.forEach((worker, index) => {
    const port = ports[index];
    const server = net.createServer((socket) => {
      socket.write('ALIVE\n');
      socket.end();
    });
    
    server.listen(port, () => {
      tcpServers.push({ port, server });
      console.log(`TCP 服务器启动，端口 ${port}`);
      
      // 定期检测
      setInterval(() => {
        const client = net.connect(port, () => {
          client.destroy();
        });
        client.on('error', (err) => {
          console.log(`端口 ${port} 检测失败:`, err.message);
        });
      }, 3000);
    });
  });
  
  // 方法3: 文件系统状态检测
  console.log('\n--- 方法3: 文件系统状态检测 ---');
  const heartbeatDir = path.join(__dirname, 'heartbeats');
  
  if (!fs.existsSync(heartbeatDir)) {
    fs.mkdirSync(heartbeatDir);
  }
  
  workers.forEach((worker, index) => {
    const heartbeatFile = path.join(heartbeatDir, `worker_${index + 1}.txt`);
    setInterval(() => {
      fs.writeFileSync(heartbeatFile, Date.now().toString());
    }, 2000);
  });
  
  // 检查文件状态
  setInterval(() => {
    console.log('\n文件状态检查:');
    ports.forEach((port, index) => {
      const heartbeatFile = path.join(heartbeatDir, `worker_${index + 1}.txt`);
      if (fs.existsSync(heartbeatFile)) {
        const timestamp = fs.readFileSync(heartbeatFile, 'utf8');
        const age = (Date.now() - parseInt(timestamp)) / 1000;
        console.log(`  工作${index + 1}: 在线 (${age.toFixed(1)}秒前活动)`);
      } else {
        console.log(`  工作${index + 1}: 离线`);
      }
    });
  }, 4000);
  
  // 优雅关闭
  process.on('SIGTERM', () => {
    console.log('\n主进程接收到关闭信号...');
    workers.forEach(worker => worker.kill());
    tcpServers.forEach(({ server }) => server.close());
    process.exit(0);
  });
  
} else {
  // 工作进程
  const workerId = cluster.worker.id;
  console.log(`工作进程 ${workerId} 启动`);
  
  // 接收主进程消息
  process.on('message', (msg) => {
    console.log(`工作进程 ${workerId} 收到消息:`, msg);
    
    // 响应心跳
    if (msg.type === 'HEARTBEAT') {
      process.send({
        type: 'STATUS',
        workerId: msg.workerId,
        status: 'ALIVE',
        timestamp: Date.now(),
        memory: process.memoryUsage()
      });
    }
  });
  
  // 模拟工作
  setInterval(() => {
    process.send({
      type: 'KEEPALIVE',
      workerId: workerId,
      timestamp: Date.now()
    });
  }, 3000);
}