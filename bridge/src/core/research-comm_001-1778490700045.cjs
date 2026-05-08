// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:11:40.045Z

const cluster = require('cluster');
const http = require('http');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const net = require('net');

// 研究结果存储
const results = {
  signal: [],
  fileWatch: [],
  udpBroadcast: [],
  tcpSocket: []
};

if (cluster.isMaster) {
  console.log('=== 实例间通讯方式研究 ===\n');
  
  const numWorkers = 4;
  const workers = [];
  
  // 启动工作进程
  for (let i = 0; i < numWorkers; i++) {
    workers.push(cluster.fork());
  }
  
  // 1. 进程信号测试
  console.log('1. 进程信号 (Signal) 测试：');
  setTimeout(() => {
    workers.forEach((worker, index) => {
      setTimeout(() => {
        process.kill(worker.process.pid, 'SIGINFO');
      }, 100 * (index + 1));
    });
  }, 500);
  
  // 2. 文件系统通知测试
  console.log('2. 文件系统通知 (File Watch) 测试：');
  const statusDir = './status';
  if (!fs.existsSync(statusDir)) {
    fs.mkdirSync(statusDir);
  }
  
  workers.forEach((worker, index) => {
    setTimeout(() => {
      const statusFile = path.join(statusDir, `worker-${index}.txt`);
      fs.writeFileSync(statusFile, `alive at ${Date.now()}`);
    }, 800 + 200 * index);
  });
  
  // 3. UDP广播测试
  console.log('3. UDP广播 测试：');
  const udpServer = dgram.createSocket('udp4');
  const UDP_PORT = 3002;
  
  udpServer.on('message', (msg) => {
    const data = JSON.parse(msg.toString());
    results.udpBroadcast.push({
      from: data.pid,
      timestamp: data.timestamp,
      received: Date.now()
    });
    console.log(`   收到来自 PID ${data.pid} 的心跳`);
  });
  
  udpServer.bind(UDP_PORT, () => {
    console.log(`   UDP服务器监听端口 ${UDP_PORT}`);
    
    // 发送心跳
    workers.forEach((worker, index) => {
      setTimeout(() => {
        const msg = JSON.stringify({
          pid: process.pid,
          timestamp: Date.now()
        });
        const buffer = Buffer.from(msg);
        dgram.createSocket('udp4').send(buffer, UDP_PORT, 'localhost');
      }, 1200 + 300 * index);
    });
  });
  
  // 4. TCP Socket测试
  console.log('4. TCP Socket 测试：');
  const tcpServer = net.createServer((socket) => {
    socket.on('data', (data) => {
      const info = JSON.parse(data.toString());
      results.tcpSocket.push(info);
      console.log(`   收到来自 ${info.pid} 的TCP消息`);
    });
  });
  
  tcpServer.listen(3003, () => {
    console.log('   TCP服务器监听端口 3003');
    
    workers.forEach((worker, index) => {
      setTimeout(() => {
        const client = new net.Socket();
        client.connect(3003, () => {
          client.write(JSON.stringify({
            pid: worker.process.pid,
            timestamp: Date.now()
          }));
          client.destroy();
        });
      }, 1500 + 400 * index);
    });
  });
  
  // 处理信号事件
  cluster.on('message', (worker, msg) => {
    if (msg.type === 'status') {
      results.signal.push({
        pid: worker.process.pid,
        status: msg.status,
        timestamp: msg.timestamp
      });
      console.log(`   收到 PID ${worker.process.pid} 的状态: ${msg.status}`);
    }
  });
  
  // 清理工作进程信号处理
  workers.forEach(worker => {
    worker.on('message', (msg) => {
      if (msg.type === 'signal') {
        console.log(`   工作进程 ${worker.process.pid} 收到信号`);
      }
    });
  });
  
  // 总结
  setTimeout(() => {
    console.log('\n=== 研究结果汇总 ===');
    console.log('信号通信:', results.signal.length > 0 ? '可用' : '不可用');
    console.log('文件监听:', fs.existsSync(statusDir) ? '可用' : '不可用');
    console.log('UDP广播:', results.udpBroadcast.length > 0 ? '可用' : '不可用');
    console.log('TCP Socket:', results.tcpSocket.length > 0 ? '可用' : '不可用');
    
    // 清理
    workers.forEach(w => w.kill());
    udpServer.close();
    tcpServer.close();
    fs.rmSync(statusDir, { recursive: true, force: true });
    process.exit(0);
  }, 4000);
  
} else {
  // 工作进程
  let alive = true;
  
  // 处理信号
  process.on('SIGINFO', () => {
    process.send({ type: 'status', status: 'alive', timestamp: Date.now() });
  });
  
  process.on('message', (msg) => {
    if (msg.type === 'signal') {
      alive = !alive;
      process.send({ type: 'signal', status: alive ? 'alive' : 'dead' });
    }
  });
  
  // 启动HTTP服务（简单）
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(alive ? 'alive' : 'dead');
  });
  
  server.listen(0, () => {
    const port = server.address().port;
    console.log(`工作进程 ${process.pid} 启动，端口 ${port}`);
  });
}