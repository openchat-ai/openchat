// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:02:30.375Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

// 研究结果存储
const researchResults = {
  tcpHeartbeat: null,
  udpBroadcast: null,
  fileLock: null,
  ipc: null
};

console.log('=== 实例间通讯方式研究 ===\n');

// 1. TCP Socket 心跳检测
function tcpHeartbeatDemo() {
  console.log('1. TCP Socket 心跳检测:');
  
  // 服务端
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      if (data.toString() === 'HEARTBEAT') {
        socket.write('ALIVE');
      }
    });
  });
  
  server.listen(3001, () => {
    console.log('   TCP 服务端监听端口 3001');
    
    // 客户端模拟 heartbeat
    const client = new net.Socket();
    client.connect(3001, () => {
      client.write('HEARTBEAT');
    });
    
    client.on('data', (data) => {
      researchResults.tcpHeartbeat = data.toString() === 'ALIVE';
      console.log(`   收到来自服务端的响应: ${data}`);
      console.log(`   TCP 心跳检测结果: ${researchResults.tcpHeartbeat ? '成功' : '失败'}\n`);
      client.destroy();
      server.close();
    });
  });
}

// 2. UDP 广播检测
function udpBroadcastDemo() {
  console.log('2. UDP 广播检测:');
  
  const server = dgram.createSocket('udp4');
  const PORT = 3002;
  
  server.on('message', (msg, rinfo) => {
    if (msg.toString() === 'PING') {
      const response = Buffer.from('PONG');
      server.send(response, rinfo.port, rinfo.address);
    }
  });
  
  server.bind(PORT, () => {
    console.log(`   UDP 服务端监听端口 ${PORT}`);
    
    // 模拟广播
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('PING');
    
    // 广播到本地
    client.send(message, PORT, 'localhost', () => {
      console.log('   发送 UDP 广播...');
    });
    
    // 监听响应
    server.on('message', (msg) => {
      researchResults.udpBroadcast = msg.toString() === 'PONG';
      console.log(`   接收到 UDP 响应: ${msg}`);
      console.log(`   UDP 广播检测结果: ${researchResults.udpBroadcast ? '成功' : '失败'}\n`);
      client.close();
      server.close();
    });
  });
}

// 3. 文件锁检测
function fileLockDemo() {
  console.log('3. 文件锁检测:');
  
  const lockFile = path.join(__dirname, 'instance.lock');
  
  try {
    // 尝试创建锁文件
    if (!fs.existsSync(lockFile)) {
      fs.writeFileSync(lockFile, process.pid.toString());
      researchResults.fileLock = true;
      console.log('   创建锁文件成功，表示实例存活');
      console.log(`   文件锁检测结果: 成功 (PID: ${process.pid})\n`);
      
      // 清理
      fs.unlinkSync(lockFile);
    }
  } catch (err) {
    researchResults.fileLock = false;
    console.log(`   文件锁检测结果: 失败 - ${err.message}\n`);
  }
}

// 4. IPC (进程间通信) 演示
function ipcDemo() {
  console.log('4. IPC (进程间通信):');
  
  if (process.argv.includes('--child')) {
    // 子进程
    process.on('message', (msg) => {
      if (msg === 'CHECK_STATUS') {
        process.send({ status: 'ALIVE', pid: process.pid });
      }
    });
  } else {
    // 父进程
    const child = require('child_process').fork(__filename, ['--child']);
    
    child.send('CHECK_STATUS');
    child.on('message', (msg) => {
      researchResults.ipc = msg.status === 'ALIVE';
      console.log(`   收到子进程消息: ${JSON.stringify(msg)}`);
      console.log(`   IPC 检测结果: ${researchResults.ipc ? '成功' : '失败'}\n`);
      child.kill();
      printSummary();
    });
  }
}

// 总结
function printSummary() {
  console.log('\n=== 研究总结 ===');
  console.log('可用的实例间通讯方式:');
  console.log('  1. TCP Socket - 可靠的点对点通信');
  console.log('  2. UDP 广播 - 高效的广播通信');
  console.log('  3. 文件锁 - 简单的文件系统通信');
  console.log('  4. IPC - 进程间信道通信');
  console.log('\n每种方式的优缺点:');
  console.log('  TCP: 面向连接，保证可靠性，但 overhead 较大');
  console.log('  UDP: 低延迟，适合广播，但不可靠');
  console.log('  文件锁: 简单易用，跨平台，但需文件系统支持');
  console.log('  IPC: 高效，Node.js 原生支持，但仅限父子进程');
}

// 运行演示
tcpHeartbeatDemo();
setTimeout(udpBroadcastDemo, 500);
setTimeout(fileLockDemo, 1000);
setTimeout(ipcDemo, 1500);