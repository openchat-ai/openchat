// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:28:32.838Z

// 实例间通讯方式研究：TCP心跳 + 进程信号
// 运行方式：node thisfile.js
// 本脚本会同时模拟两个实例（主进程和子进程），演示如何检测对方状态

const net = require('net');
const { fork } = require('child_process');
const path = require('path');

// ========== TCP 心跳服务器（每个实例都运行） ==========
function startHeartbeatServer(port, instanceName) {
  const server = net.createServer((socket) => {
    console.log(`[${instanceName}] TCP 连接建立`);

    // 收到心跳包
    socket.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg === 'ping') {
        socket.write('pong');
        console.log(`[${instanceName}] 收到心跳 ping，回复 pong`);
      }
    });

    socket.on('close', () => {
      console.log(`[${instanceName}] TCP 连接关闭`);
    });

    socket.on('error', (err) => {
      console.log(`[${instanceName}] TCP 错误:`, err.message);
    });
  });

  server.listen(port, () => {
    console.log(`[${instanceName}] TCP 心跳服务器运行在端口 ${port}`);
  });

  return server;
}

// ========== TCP 心跳客户端（检测其他实例） ==========
function checkTcpHeartbeat(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log(`TCP 心跳检测超时 (${host}:${port})`);
        client.destroy();
        resolve(false);
      }
    }, timeout);

    client.connect(port, host, () => {
      client.write('ping');
    });

    client.on('data', (data) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        const response = data.toString().trim();
        console.log(`TCP 心跳响应: ${response}`);
        client.destroy();
        resolve(response === 'pong');
      }
    });

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        console.log(`TCP 心跳连接失败:`, err.message);
        client.destroy();
        resolve(false);
      }
    });
  });
}

// ========== 进程信号检测（仅限同一台机器） ==========
function sendSignalCheck(pid) {
  try {
    // 发送 SIGUSR1 信号，如果进程存在且不忽略信号，会触发默认行为（进入调试模式）
    // 这里我们只是检测进程是否存在，更安全的方式是用 kill(pid, 0)
    process.kill(pid, 0); // 信号 0 不发送实际信号，只检测进程是否存在
    console.log(`进程信号检测: 进程 ${pid} 存活`);
    return true;
  } catch (err) {
    console.log(`进程信号检测: 进程 ${pid} 不存在或无权访问`);
    return false;
  }
}

// ========== 主逻辑 ==========
async function main() {
  console.log('========== 实例间通讯方式研究 ==========');
  console.log('方式1: TCP Socket 心跳');
  console.log('方式2: 进程信号 (SIGUSR1 / kill(pid,0))');
  console.log('方式3: HTTP ping (作为对比)');
  console.log('');

  // 启动心跳服务器（本实例）
  const MY_PORT = 9123;
  const server = startHeartbeatServer(MY_PORT, '实例A');

  // 模拟另一个实例：fork 一个子进程作为实例B
  const childPath = path.join(__dirname, 'heartbeat_child.js');
  // 如果不存在子进程文件，则用内联代码创建
  const fs = require('fs');
  if (!fs.existsSync(childPath)) {
    const childCode = `
      const net = require('net');
      const server = net.createServer((socket) => {
        socket.on('data', (data) => {
          if (data.toString().trim() === 'ping') socket.write('pong');
        });
      });
      server.listen(9124, () => {
        // 通知父进程准备就绪
        process.send({ ready: true });
      });
      // 监听信号
      process.on('SIGUSR1', () => {
        console.log('[子进程] 收到 SIGUSR1 信号');
      });
    `;
    fs.writeFileSync(childPath, childCode);
  }

  const child = fork(childPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

  // 等待子进程就绪
  await new Promise((resolve) => {
    child.on('message', (msg) => {
      if (msg.ready) resolve();
    });
    // 超时保护
    setTimeout(resolve, 2000);
  });

  console.log('\n--- 开始检测 ---\n');

  // 1. TCP 心跳检测子进程（实例B）
  console.log('检测实例B (TCP 心跳):');
  const tcpResult = await checkTcpHeartbeat('127.0.0.1', 9124);
  console.log(`实例B TCP 心跳状态: ${tcpResult ? '存活' : '死亡'}\n`);

  // 2. 进程信号检测子进程
  console.log('检测实例B (进程信号):');
  const signalResult = sendSignalCheck(child.pid);
  console.log(`实例B 进程信号状态: ${signalResult ? '存活' : '死亡'}\n`);

  // 3. 模拟实例B崩溃，再次检测
  console.log('--- 模拟实例B崩溃 ---');
  child.kill('SIGKILL');
  // 等待子进程真正结束
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log('\n实例B 崩溃后再次检测:');
  const tcpResult2 = await checkTcpHeartbeat('127.0.0.1', 9124);
  console.log(`实例B TCP 心跳状态: ${tcpResult2 ? '存活' : '死亡'}`);
  const signalResult2 = sendSignalCheck(child.pid);
  console.log(`实例B 进程信号状态: ${signalResult2 ? '存活' : '死亡'}`);

  // 清理
  server.close();
  if (fs.existsSync(childPath)) {
    fs.unlinkSync(childPath); // 清理临时文件
  }

  console.log('\n========== 研究结论 ==========');
  console.log('1. TCP心跳：适用于网络间实例，需自行管理连接和超时，准确可靠');
  console.log('2. 进程信号：仅限同一操作系统，速度快，但无法跨机器');
  console.log('3. HTTP ping：简单但开销较大，需HTTP服务器支持');
  console.log('4. 其他方式：Redis Pub/Sub、共享文件锁、gRPC健康检查等');
  console.log('建议：根据实例部署位置（同机/跨机）选择合适方式');
}

main().catch(console.error);