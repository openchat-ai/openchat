// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:30:32.176Z

// 实例间通讯方式研究：姐妹状态检测方法探索
// 除了HTTP ping，探索多种检测姐妹实例状态的方式

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 研究结果存储
const researchResults = [];

// 辅助函数：添加研究结果
function logResult(method, description, success, details = '') {
  researchResults.push({
    method,
    description,
    success,
    details,
    timestamp: new Date().toISOString()
  });
  console.log(`[${success ? '✓' : '✗'}] ${method}: ${description} ${details}`);
}

// 1. TCP Socket 连接检测
async function testTCPConnection(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 2000;
    
    socket.setTimeout(timeout);
    
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    
    socket.connect(port, host);
  });
}

// 2. UDP 心跳检测
async function testUDPHeartbeat(host, port) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('HEARTBEAT');
    let received = false;
    
    client.on('message', (msg) => {
      if (msg.toString() === 'ALIVE') {
        received = true;
        client.close();
      }
    });
    
    client.send(message, 0, message.length, port, host, (err) => {
      if (err) {
        client.close();
        resolve(false);
      }
    });
    
    setTimeout(() => {
      if (!received) {
        client.close();
        resolve(false);
      } else {
        resolve(true);
      }
    }, 2000);
  });
}

// 3. 文件锁检测（共享文件系统）
async function testFileLockDetection() {
  const lockFilePath = path.join(os.tmpdir(), 'sister-instance.lock');
  
  try {
    // 尝试创建锁文件
    const fd = await fs.promises.open(lockFilePath, 'wx');
    await fd.close();
    
    // 如果成功创建，说明没有其他实例
    await fs.promises.unlink(lockFilePath);
    return false; // 没有姐妹实例
  } catch (err) {
    if (err.code === 'EEXIST') {
      // 文件已存在，有姐妹实例
      return true;
    }
    return false;
  }
}

// 4. 进程信号检测（仅限父子进程）
async function testProcessSignal(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

// 5. Unix Domain Socket 检测
async function testUnixDomainSocket(socketPath) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    
    client.on('connect', () => {
      client.destroy();
      resolve(true);
    });
    
    client.on('error', () => {
      client.destroy();
      resolve(false);
    });
    
    client.connect(socketPath);
    
    setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 1000);
  });
}

// 6. 共享内存检测（使用文件作为模拟）
async function testSharedMemory() {
  const memFilePath = path.join(os.tmpdir(), 'shared-memory.dat');
  
  try {
    // 尝试读取共享状态
    const data = await fs.promises.readFile(memFilePath);
    const status = JSON.parse(data.toString());
    
    // 更新心跳时间
    status.lastHeartbeat = Date.now();
    await fs.promises.writeFile(memFilePath, JSON.stringify(status));
    
    // 检查是否在合理时间内有更新
    const timeSinceLastHeartbeat = Date.now() - status.lastHeartbeat;
    return timeSinceLastHeartbeat < 10000; // 10秒内算活跃
  } catch (err) {
    // 创建共享内存文件
    const initialStatus = {
      instanceId: process.pid,
      lastHeartbeat: Date.now(),
      createdAt: Date.now()
    };
    await fs.promises.writeFile(memFilePath, JSON.stringify(initialStatus));
    return false;
  }
}

// 主研究函数
async function main() {
  console.log('=== 实例间通讯方式研究：姐妹状态检测 ===\n');
  console.log('研究开始时间:', new Date().toISOString());
  console.log('当前进程PID:', process.pid, '\n');

  // 设置测试参数
  const testHost = '127.0.0.1';
  const testPort = 8080;
  const testSocketPath = '/tmp/sister-test.sock';
  
  // 1. TCP Socket 检测
  console.log('--- 1. TCP Socket 连接检测 ---');
  const tcpResult = await testTCPConnection(testHost, testPort);
  logResult('TCP Socket', '尝试建立TCP连接', tcpResult, 
    tcpResult ? '端口开放' : '端口未开放或无响应');
  
  // 2. UDP 心跳检测
  console.log('\n--- 2. UDP 心跳检测 ---');
  const udpResult = await testUDPHeartbeat(testHost, testPort);
  logResult('UDP Heartbeat', '发送UDP心跳包并等待响应', udpResult,
    udpResult ? '收到响应' : '无响应');
  
  // 3. 文件锁检测
  console.log('\n--- 3. 文件锁检测 ---');
  const fileLockResult = await testFileLockDetection();
  logResult('File Lock', '使用锁文件检测实例存在', fileLockResult,
    fileLockResult ? '锁文件存在' : '无锁文件');
  
  // 4. 进程信号检测
  console.log('\n--- 4. 进程信号检测 ---');
  const signalResult = await testProcessSignal(process.pid);
  logResult('Process Signal', '发送信号0检测进程存在', signalResult,
    signalResult ? '进程存在' : '进程不存在');
  
  // 5. Unix Domain Socket 检测
  console.log('\n--- 5. Unix Domain Socket 检测 ---');
  const unixSocketResult = await testUnixDomainSocket(testSocketPath);
  logResult('Unix Domain Socket', '连接Unix域套接字', unixSocketResult,
    unixSocketResult ? '套接字存在' : '套接字不存在');
  
  // 6. 共享内存检测
  console.log('\n--- 6. 共享内存检测 ---');
  const sharedMemResult = await testSharedMemory();
  logResult('Shared Memory', '通过文件模拟共享内存检测', sharedMemResult,
    sharedMemResult ? '姐妹实例活跃' : '无活跃姐妹实例');
  
  // 输出总结
  console.log('\n=== 研究总结 ===');
  console.log('探索的实例间通讯方式：');
  console.log('1. TCP Socket - 直接建立TCP连接检测');
  console.log('2. UDP Heartbeat - 无连接的心跳检测');
  console.log('3. File Lock - 利用文件系统锁机制');
  console.log('4. Process Signal - 操作系统信号检测');
  console.log('5. Unix Domain Socket - 本地进程间通信');
  console.log('6. Shared Memory - 共享内存状态检测');
  
  console.log('\n=== 完整研究结果 ===');
  console.log(JSON.stringify(researchResults, null, 2));
  
  // 清理测试文件
  try {
    const memFilePath = path.join(os.tmpdir(), 'shared-memory.dat');
    await fs.promises.unlink(memFilePath);
  } catch (e) {
    // 忽略清理错误
  }
  
  console.log('\n研究完成！');
}

// 运行研究
main().catch(console.error.chalk || console.error);