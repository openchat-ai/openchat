// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:34:39.879Z

// 实例间通讯方式研究：检测姐妹实例状态的非HTTP方法
// 本代码演示了三种替代方案：TCP心跳、Unix域套接字、进程间信号

const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 研究结果容器
const results = [];

// 1. TCP心跳检测（自定义协议）
function tcpHeartbeatTest() {
  return new Promise((resolve) => {
    const PORT = 9876;
    const HOST = '127.0.0.1';
    const TIMEOUT = 3000;

    // 创建TCP服务器模拟姐妹实例
    const server = net.createServer((socket) => {
      // 收到心跳请求，回复确认
      socket.on('data', (data) => {
        if (data.toString() === 'PING') {
          socket.write('PONG');
        }
      });
    });

    server.listen(PORT, HOST, () => {
      console.log('[TCP心跳] 服务器启动，监听端口:', PORT);

      // 客户端发送心跳
      const client = net.createConnection({ port: PORT, host: HOST }, () => {
        client.write('PING');
        client.setTimeout(TIMEOUT);
      });

      client.on('data', (data) => {
        if (data.toString() === 'PONG') {
          results.push('TCP心跳：成功收到姐妹实例的PONG响应');
          console.log('[TCP心跳] 姐妹实例存活');
        }
        client.end();
        server.close();
        resolve();
      });

      client.on('timeout', () => {
        results.push('TCP心跳：超时，姐妹实例可能宕机');
        client.destroy();
        server.close();
        resolve();
      });

      client.on('error', (err) => {
        results.push(`TCP心跳：连接失败 - ${err.message}`);
        server.close();
        resolve();
      });
    });
  });
}

// 2. Unix域套接字检测（本地进程间通信）
function unixSocketTest() {
  return new Promise((resolve) => {
    const SOCKET_PATH = path.join('/tmp', `sister-test-${Date.now()}.sock`);

    // 创建Unix域套接字服务器
    const server = net.createServer((socket) => {
      socket.on('data', (data) => {
        if (data.toString() === 'STATUS') {
          socket.write('ALIVE');
        }
      });
    });

    server.listen(SOCKET_PATH, () => {
      console.log('[Unix域套接字] 服务器启动，监听:', SOCKET_PATH);

      // 客户端连接检测
      const client = net.createConnection(SOCKET_PATH, () => {
        client.write('STATUS');
      });

      client.on('data', (data) => {
        if (data.toString() === 'ALIVE') {
          results.push('Unix域套接字：姐妹实例状态为ALIVE');
          console.log('[Unix域套接字] 姐妹实例存活');
        }
        client.end();
        server.close();
        // 清理socket文件
        try { fs.unlinkSync(SOCKET_PATH); } catch(e) {}
        resolve();
      });

      client.on('error', (err) => {
        results.push(`Unix域套接字：连接失败 - ${err.message}`);
        server.close();
        try { fs.unlinkSync(SOCKET_PATH); } catch(e) {}
        resolve();
      });
    });
  });
}

// 3. 进程间信号检测（仅适用于同一台机器的父子进程）
function signalTest() {
  return new Promise((resolve) => {
    // 启动一个子进程模拟姐妹实例
    const child = spawn(process.execPath, ['-e', `
      // 子进程：监听SIGUSR1信号并响应
      process.on('SIGUSR1', () => {
        console.log('子进程收到SIGUSR1，发送SIGUSR2回应');
        process.send({ status: 'ALIVE' });
      });
      // 保持进程运行
      setInterval(() => {}, 1000);
    `], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    // 给子进程一点时间初始化
    setTimeout(() => {
      // 向子进程发送SIGUSR1信号
      child.kill('SIGUSR1');

      // 通过IPC接收子进程消息
      child.on('message', (msg) => {
        if (msg.status === 'ALIVE') {
          results.push('进程信号(SIGUSR1/SIGUSR2)：姐妹实例通过IPC回应存活');
          console.log('[进程信号] 姐妹实例存活');
        }
        child.kill();
        resolve();
      });

      // 超时处理
      setTimeout(() => {
        results.push('进程信号：超时，姐妹实例可能无响应');
        child.kill();
        resolve();
      }, 2000);

    }, 500);
  });
}

// 主研究函数
async function researchCommunicationMethods() {
  console.log('========================================');
  console.log('  实例间通讯方式研究（非HTTP Ping）');
  console.log('========================================\n');

  console.log('方法1: TCP心跳检测');
  console.log('方法2: Unix域套接字');
  console.log('方法3: 进程间信号\n');

  console.log('正在进行测试...\n');

  // 依次执行测试
  await tcpHeartbeatTest();
  await unixSocketTest();
  await signalTest();

  console.log('\n========== 研究结果 ==========');
  console.log(`总共测试了 ${results.length} 种方法`);
  results.forEach((result, index) => {
    console.log(`${index + 1}. ${result}`);
  });

  console.log('\n========== 总结 ==========');
  console.log('除了HTTP ping，以下方法也可用于检测姐妹实例状态：');
  console.log('1. TCP心跳：通过自定义TCP协议发送PING/PONG，轻量且可靠');
  console.log('2. Unix域套接字：适合同一主机上的进程，性能高且安全');
  console.log('3. 进程信号：利用操作系统信号+IPC，适合父子进程间通信');
  console.log('其他未演示的方法：共享内存、管道、消息队列、gRPC等');
}

// 运行研究
researchCommunicationMethods().catch(console.error);