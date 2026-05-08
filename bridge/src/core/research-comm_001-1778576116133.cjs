// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:55:16.133Z

// 实例间通讯方式研究 - 检测姐妹状态的非HTTP方法
// 本代码演示了三种除HTTP外的通讯方式：TCP Socket、进程间信号、共享文件

const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 配置
const TCP_PORT = 9123;
const SHARED_FILE = path.join(os.tmpdir(), 'sister_status.sock');

// ========== 方式1：TCP Socket 心跳检测 ==========
function startTCPServer() {
  const server = net.createServer((socket) => {
    console.log('[TCP] 姐妹实例已连接');
    
    // 收到心跳消息
    socket.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg === 'PING') {
        socket.write('PONG');
        console.log('[TCP] 收到PING，回复PONG');
      }
    });

    socket.on('close', () => {
      console.log('[TCP] 姐妹实例断开连接');
    });
  });

  server.listen(TCP_PORT, () => {
    console.log(`[TCP] 服务端监听端口 ${TCP_PORT}`);
  });

  return server;
}

function tcpPing() {
  return new Promise((resolve) => {
    const client = new net.Socket();
    const timeout = setTimeout(() => {
      console.log('[TCP] 心跳超时 - 姐妹可能宕机');
      client.destroy();
      resolve(false);
    }, 2000);

    client.connect(TCP_PORT, '127.0.0.1', () => {
      client.write('PING');
    });

    client.on('data', (data) => {
      if (data.toString().trim() === 'PONG') {
        console.log('[TCP] 收到PONG - 姐妹存活');
        clearTimeout(timeout);
        resolve(true);
      }
      client.destroy();
    });

    client.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

// ========== 方式2：Unix Domain Socket (进程间通讯) ==========
function startUnixSocketServer() {
  try { fs.unlinkSync(SHARED_FILE); } catch(e) {} // 清理旧socket文件

  const server = net.createServer((socket) => {
    console.log('[UnixSocket] 姐妹实例已连接');
    
    socket.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg === 'STATUS') {
        socket.write('ALIVE');
        console.log('[UnixSocket] 收到状态查询，回复ALIVE');
      }
    });
  });

  server.listen(SHARED_FILE, () => {
    console.log(`[UnixSocket] 监听 ${SHARED_FILE}`);
  });

  return server;
}

function unixSocketPing() {
  return new Promise((resolve) => {
    const client = net.createConnection(SHARED_FILE, () => {
      client.write('STATUS');
    });

    const timeout = setTimeout(() => {
      console.log('[UnixSocket] 查询超时');
      client.destroy();
      resolve(false);
    }, 2000);

    client.on('data', (data) => {
      if (data.toString().trim() === 'ALIVE') {
        console.log('[UnixSocket] 姐妹存活');
        clearTimeout(timeout);
        resolve(true);
      }
      client.destroy();
    });

    client.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

// ========== 方式3：共享文件锁（文件系统通讯） ==========
const LOCK_FILE = path.join(os.tmpdir(), 'sister.lock');

function acquireLock() {
  try {
    fs.writeFileSync(LOCK_FILE, process.pid.toString(), { flag: 'wx' });
    console.log('[共享文件] 获得锁，成为活跃实例');
    return true;
  } catch(e) {
    if (e.code === 'EEXIST') {
      console.log('[共享文件] 锁已被其他实例占用');
      return false;
    }
    throw e;
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK_FILE);
    console.log('[共享文件] 释放锁');
  } catch(e) {
    // 文件可能已被删除
  }
}

function checkSisterByLock() {
  try {
    const pid = fs.readFileSync(LOCK_FILE, 'utf8');
    // 检查进程是否存活（Unix系统可用 kill 0）
    try {
      process.kill(parseInt(pid), 0);
      console.log(`[共享文件] 姐妹进程 ${pid} 存活`);
      return true;
    } catch(e) {
      console.log(`[共享文件] 姐妹进程 ${pid} 已终止，锁已过期`);
      releaseLock(); // 清理过期锁
      return false;
    }
  } catch(e) {
    console.log('[共享文件] 无锁文件，姐妹不在运行');
    return false;
  }
}

// ========== 主研究流程 ==========
async function main() {
  console.log('========== 实例间通讯方式研究 ==========');
  console.log('研究目标：检测姐妹实例状态（非HTTP方式）\n');

  // 启动服务
  const tcpServer = startTCPServer();
  const unixServer = startUnixSocketServer();
  
  // 获取锁（模拟当前实例成为主实例）
  const haveLock = acquireLock();
  
  console.log('\n--- 开始检测姐妹状态 ---\n');

  // 方法1：TCP心跳
  console.log('【方式1】TCP Socket 心跳检测：');
  const tcpResult = await tcpPing();
  console.log(`  结果：姐妹实例 ${tcpResult ? '存活' : '不可达'}\n`);

  // 方法2：Unix Domain Socket
  console.log('【方式2】Unix Domain Socket 状态查询：');
  const unixResult = await unixSocketPing();
  console.log(`  结果：姐妹实例 ${unixResult ? '存活' : '不可达'}\n`);

  // 方法3：共享文件锁
  console.log('【方式3】共享文件锁检测：');
  const lockResult = checkSisterByLock();
  console.log(`  结果：姐妹实例 ${lockResult ? '存活' : '不存在'}\n`);

  // 输出研究总结
  console.log('========== 研究结论 ==========');
  console.log(`
    除了HTTP ping，检测姐妹状态的方式包括：

    1. TCP Socket 心跳
       - 优点：实时性好，可双向通讯
       - 缺点：需要管理连接池，端口可能被占用

    2. Unix Domain Socket
       - 优点：性能高，安全性好（仅本地进程可访问）
       - 缺点：仅适用于同一主机

    3. 共享文件锁
       - 优点：实现简单，无需网络
       - 缺点：需要处理锁过期，有文件系统开销

    其他未演示但有效的方式：
    - Redis/MQTT等消息队列的心跳
    - 共享内存（通过mmap）
    - 进程信号（SIGUSR1/SIGUSR2）
    - gRPC健康检查协议
    - 数据库心跳表
  `);

  // 清理
  releaseLock();
  tcpServer.close();
  unixServer.close();
  try { fs.unlinkSync(SHARED_FILE); } catch(e) {}
  
  console.log('\n研究完成，资源已清理。');
}

main().catch(console.error);