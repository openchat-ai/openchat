// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:28:07.397Z

// 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// 本代码模拟多种通讯方式，并输出研究结果

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

// 模拟姐妹实例的状态（用文件锁和共享内存模拟）
const STATE_FILE = './sister_state.json';
const SHARED_FILE = './shared_heartbeat.txt';

// 初始化状态文件
function initState() {
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ alive: true, lastPing: Date.now() }));
  }
}

// 方式1：TCP ping（非HTTP）
function tcpPing(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

// 方式2：UDP心跳包
function udpHeartbeat(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('HEARTBEAT');
    client.send(message, 0, message.length, port, host, (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
      client.close();
    });
  });
}

// 方式3：Unix Domain Socket (本地通信)
function unixSocketPing(socketPath) {
  return new Promise((resolve) => {
    const client = net.createConnection(socketPath, () => {
      client.write('PING');
      client.end();
      resolve(true);
    });
    client.on('error', () => {
      resolve(false);
    });
    client.setTimeout(1000, () => {
      client.destroy();
      resolve(false);
    });
  });
}

// 方式4：共享文件/文件锁（文件心跳）
function fileHeartbeatCheck() {
  try {
    if (fs.existsSync(SHARED_FILE)) {
      const stat = fs.statSync(SHARED_FILE);
      const age = Date.now() - stat.mtimeMs;
      // 如果文件在5秒内更新，认为姐妹存活
      return age < 5000;
    }
    return false;
  } catch {
    return false;
  }
}

// 方式5：共享内存（通过mmap或临时文件模拟）
// 这里使用一个简单的JSON文件作为共享状态
function sharedStateCheck() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      const age = Date.now() - data.lastPing;
      return age < 5000;
    }
    return false;
  } catch {
    return false;
  }
}

// 方式6：信号（SIGUSR1/SIGUSR2）—— 需要进程间通信，这里模拟发送信号
function signalCheck(pid) {
  try {
    // 发送信号0（检查进程是否存在）
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 主研究函数
async function researchSisterDetection() {
  console.log('=== 实例间通讯方式研究：检测姐妹状态 ===\n');
  
  // 初始化
  initState();
  
  // 模拟姐妹进程（当前进程自己作为姐妹）
  console.log('1. TCP Ping (非HTTP):');
  const tcpResult = await tcpPing('127.0.0.1', 8080); // 假设姐妹在8080端口
  console.log(`   TCP连接测试结果: ${tcpResult ? '姐妹可达' : '姐妹不可达'}`);
  console.log('   优点：可靠，有连接状态；缺点：需要端口开放\n');

  console.log('2. UDP心跳包:');
  const udpResult = await udpHeartbeat(9090);
  console.log(`   UDP心跳发送结果: ${udpResult ? '发送成功' : '发送失败'}`);
  console.log('   优点：轻量，无连接；缺点：不可靠，可能丢包\n');

  console.log('3. Unix Domain Socket:');
  const socketPath = '/tmp/sister.sock';
  const unixResult = await unixSocketPing(socketPath);
  console.log(`   Unix Socket连接结果: ${unixResult ? '姐妹可达' : '姐妹不可达'}`);
  console.log('   优点：本地通信快，安全；缺点：仅限同一主机\n');

  console.log('4. 共享文件/文件锁:');
  // 模拟姐妹更新心跳文件
  fs.writeFileSync(SHARED_FILE, `heartbeat_${Date.now()}`);
  const fileResult = fileHeartbeatCheck();
  console.log(`   文件心跳检测结果: ${fileResult ? '姐妹存活' : '姐妹已死'}`);
  console.log('   优点：简单，跨语言；缺点：I/O开销，可能文件冲突\n');

  console.log('5. 共享内存/状态文件:');
  const sharedResult = sharedStateCheck();
  console.log(`   共享状态检测结果: ${sharedResult ? '姐妹存活' : '姐妹已死'}`);
  console.log('   优点：快速；缺点：需同步机制\n');

  console.log('6. 信号检测 (SIG):');
  const myPid = process.pid;
  const signalResult = signalCheck(myPid);
  console.log(`   信号检测(当前进程): ${signalResult ? '进程存在' : '进程不存在'}`);
  console.log('   优点：系统级，可靠；缺点：仅限同一主机，需权限\n');

  console.log('\n=== 研究结论 ===');
  console.log('除了HTTP ping，还有以下方式可检测姐妹实例状态：');
  console.log('- TCP ping (非HTTP)');
  console.log('- UDP心跳包');
  console.log('- Unix Domain Socket');
  console.log('- 共享文件/文件锁');
  console.log('- 共享内存/状态文件');
  console.log('- 进程信号');
  console.log('\n每种方式适用场景不同：');
  console.log('· 跨主机：TCP/UDP更合适');
  console.log('· 同主机高性能：Unix Socket或共享内存');
  console.log('· 简单可靠：文件心跳');
  console.log('· 系统级监控：信号');

  // 清理
  try { fs.unlinkSync(SHARED_FILE); } catch {}
  try { fs.unlinkSync(STATE_FILE); } catch {}
}

researchSisterDetection().catch(console.error);