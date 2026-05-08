// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:29:48.906Z

// 实例间通讯方式研究：除HTTP ping外的姐妹状态检测方法
// 本代码演示多种替代方案并输出研究结果

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

// 模拟姐妹实例（两个进程间通讯）
class SisterInstance extends EventEmitter {
  constructor(name, port) {
    super();
    this.name = name;
    this.port = port;
    this.alive = true;
  }

  // 模拟实例状态
  isAlive() {
    return this.alive;
  }

  kill() {
    this.alive = false;
  }

  revive() {
    this.alive = true;
  }
}

// 方式1：TCP 套接字检测（比HTTP轻量）
function tcpProbe(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000); // 2秒超时

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

// 方式2：UDP 心跳检测（无连接，低开销）
function udpHeartbeat(host, port, expectedResponse = 'PONG') {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('PING');
    let responded = false;

    client.send(message, 0, message.length, port, host, (err) => {
      if (err) {
        client.close();
        resolve(false);
        return;
      }
    });

    client.on('message', (msg) => {
      if (msg.toString() === expectedResponse) {
        responded = true;
        client.close();
        resolve(true);
      }
    });

    setTimeout(() => {
      if (!responded) {
        client.close();
        resolve(false);
      }
    }, 2000);
  });
}

// 方式3：Unix Domain Socket（本机高效通讯）
function unixSocketProbe(socketPath) {
  return new Promise((resolve) => {
    const client = net.createConnection(socketPath, () => {
      client.write('STATUS');
      client.once('data', (data) => {
        const status = data.toString().trim() === 'ALIVE';
        client.end();
        resolve(status);
      });
    });

    client.on('error', () => {
      resolve(false);
    });

    setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 2000);
  });
}

// 方式4：共享内存文件（通过文件锁检测）
function sharedFileProbe(filePath, timeout = 2000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    function checkFile() {
      try {
        fs.accessSync(filePath, fs.constants.F_OK);
        // 检查文件是否过期（超过5秒认为实例死亡）
        const stats = fs.statSync(filePath);
        const age = Date.now() - stats.mtimeMs;
        if (age < 5000) {
          resolve(true);
        } else {
          resolve(false);
        }
      } catch (err) {
        if (Date.now() - startTime < timeout) {
          setTimeout(checkFile, 100);
        } else {
          resolve(false);
        }
      }
    }
    
    checkFile();
  });
}

// 方式5：进程信号（仅适用于父子进程或同用户进程）
function signalProbe(pid) {
  try {
    process.kill(pid, 0); // 信号0用于检测进程存在
    return true;
  } catch (err) {
    return false;
  }
}

// 方式6：消息队列（使用Node.js内置的EventEmitter模拟，实际可用Redis/RabbitMQ）
function messageQueueProbe(queueName, timeout = 2000) {
  return new Promise((resolve) => {
    // 实际应用中这里会连接消息队列
    // 这里用EventEmitter模拟，假设姐妹实例会向队列发送心跳
    const emitter = new EventEmitter();
    let alive = false;
    
    // 模拟心跳监听
    const listener = (msg) => {
      if (msg === 'HEARTBEAT') {
        alive = true;
      }
    };
    
    emitter.on(queueName, listener);
    
    // 模拟收到心跳（实际应由姐妹实例发送）
    setTimeout(() => {
      emitter.emit(queueName, 'HEARTBEAT');
    }, 100);
    
    setTimeout(() => {
      emitter.removeListener(queueName, listener);
      resolve(alive);
    }, timeout);
  });
}

// 研究主函数
async function studyInstanceCommunication() {
  console.log('=== 实例间通讯方式研究 ===');
  console.log('除HTTP ping外，以下方法可检测姐妹实例状态：\n');

  // 创建测试实例
  const instanceA = new SisterInstance('InstanceA', 3001);
  const instanceB = new SisterInstance('InstanceB', 3002);
  
  const testPort = 9999;
  const testUdpPort = 9998;
  const socketPath = path.join(os.tmpdir(), 'test-unix-socket.sock');
  const sharedFilePath = path.join(os.tmpdir(), 'test-shared-file.lock');

  console.log('1. TCP 套接字探测');
  console.log('   原理：建立TCP连接检测端口监听状态');
  console.log('   优点：比HTTP轻量，无协议开销');
  console.log('   缺点：需要明确端口，防火墙可能干扰');
  console.log('   测试结果：', await tcpProbe('127.0.0.1', testPort) ? '✅ 有效' : '❌ 未监听');
  console.log('   实际应用：可配合端口扫描或健康检查\n');

  console.log('2. UDP 心跳检测');
  console.log('   原理：发送UDP包，期待响应');
  console.log('   优点：无连接，极低开销');
  console.log('   缺点：不可靠，可能丢包');
  console.log('   测试结果：', await udpHeartbeat('127.0.0.1', testUdpPort) ? '✅ 有效' : '❌ 无响应');
  console.log('   实际应用：适合高频心跳，需容忍偶尔失败\n');

  console.log('3. Unix Domain Socket');
  console.log('   原理：通过本地文件套接字通讯');
  console.log('   优点：本机通讯极快，安全（仅限本机）');
  console.log('   缺点：仅限同一主机');
  console.log('   测试结果：', await unixSocketProbe(socketPath) ? '✅ 有效' : '❌ 未连接');
  console.log('   实际应用：容器内或同主机微服务通讯\n');

  console.log('4. 共享文件/文件锁');
  console.log('   原理：实例定期更新文件，其他实例检查文件新鲜度');
  console.log('   优点：简单，无需网络');
  console.log('   缺点：依赖文件系统，可能有性能问题');
  console.log('   测试结果：', await sharedFileProbe(sharedFilePath) ? '✅ 有效' : '❌ 文件过期/不存在');
  console.log('   实际应用：适合无网络环境的状态同步\n');

  console.log('5. 进程信号');
  console.log('   原理：向进程发送信号0检测存在性');
  console.log('   优点：操作系统原生支持，极快');
  console.log('   缺点：仅限同用户进程，不能跨主机');
  console.log('   测试结果：', signalProbe(process.pid) ? '✅ 自身进程存在' : '❌ 异常');
  console.log('   实际应用：监控同一台机器的子进程\n');

  console.log('6. 消息队列（模拟）');
  console.log('   原理：通过消息中间件传递心跳');
  console.log('   优点：解耦，可跨网络，支持广播');
  console.log('   缺点：引入外部依赖');
  console.log('   测试结果：', await messageQueueProbe('heartbeat-queue') ? '✅ 收到心跳' : '❌ 超时');
  console.log('   实际应用：生产环境常用Redis Pub/Sub或RabbitMQ\n');

  console.log('=== 总结 ===');
  console.log('推荐方案：');
  console.log('- 同主机：Unix Domain Socket + 文件锁（双重保障）');
  console.log('- 跨主机：UDP心跳 + TCP探测（组合使用）');
  console.log('- 分布式系统：消息队列（如Redis）');
  console.log('- 容器环境：健康检查API + 信号检测');
}

// 运行研究
studyInstanceCommunication().catch(console.errorapse