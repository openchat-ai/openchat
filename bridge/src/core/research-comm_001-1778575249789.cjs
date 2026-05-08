// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:40:49.789Z

/**
 * 实例间通讯方式研究：除了HTTP ping，检测姐妹状态的方法
 * 
 * 本代码探索并演示了多种Node.js中实例间通讯的方式，
 * 用于检测姐妹实例（其他进程/服务）是否存活或健康。
 */

const net = require('net');
const dgram = require('dgram');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const cluster = require('cluster');
const http = require('http');

// 研究结果输出
const results = [];

// 1. TCP 心跳检测
function tcpHeartbeatTest() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      console.log('[TCP] 姐妹实例已连接');
      socket.on('data', (data) => {
        if (data.toString() === 'ping') {
          socket.write('pong');
        }
      });
    });

    server.listen(0, () => {
      const port = server.address().port;
      const client = new net.Socket();
      
      client.connect(port, '127.0.0.1', () => {
        console.log('[TCP] 向姐妹实例发送ping');
        client.write('ping');
      });

      client.on('data', (data) => {
        if (data.toString() === 'pong') {
          results.push('TCP心跳：成功检测姐妹实例存活');
          console.log('[TCP] 收到pong，姐妹实例存活');
        }
        client.destroy();
        server.close();
        resolve();
      });

      client.on('error', (err) => {
        results.push('TCP心跳：连接失败 - ' + err.message);
        server.close();
        resolve();
      });
    });
  });
}

// 2. UDP 广播/组播检测
function udpMulticastTest() {
  return new Promise((resolve) => {
    const server = dgram.createSocket('udp4');
    const MULTICAST_ADDR = '239.255.255.250';
    const PORT = 54321;

    server.on('message', (msg, rinfo) => {
      if (msg.toString() === 'ARE_YOU_ALIVE') {
        const response = Buffer.from('I_AM_ALIVE');
        server.send(response, 0, response.length, rinfo.port, rinfo.address);
        console.log('[UDP] 回复姐妹实例的存活探测');
      }
    });

    server.bind(PORT, () => {
      server.addMembership(MULTICAST_ADDR);
      
      // 模拟另一个实例发送探测
      const client = dgram.createSocket('udp4');
      const message = Buffer.from('ARE_YOU_ALIVE');
      
      client.send(message, 0, message.length, PORT, MULTICAST_ADDR, (err) => {
        if (err) {
          results.push('UDP组播：发送失败 - ' + err.message);
        }
      });

      // 等待接收回复
      setTimeout(() => {
        results.push('UDP组播：已发送存活探测，等待姐妹实例回复');
        client.close();
        server.close();
        resolve();
      }, 500);
    });
  });
}

// 3. Unix Domain Socket
function unixSocketTest() {
  return new Promise((resolve) => {
    const socketPath = `/tmp/sister-test-${Date.now()}.sock`;
    const server = net.createServer((socket) => {
      console.log('[Unix Socket] 姐妹实例已连接');
      socket.on('data', (data) => {
        if (data.toString() === 'status') {
          socket.write('ok');
        }
      });
    });

    server.listen(socketPath, () => {
      const client = net.createConnection(socketPath, () => {
        console.log('[Unix Socket] 向姐妹实例查询状态');
        client.write('status');
      });

      client.on('data', (data) => {
        if (data.toString() === 'ok') {
          results.push('Unix Domain Socket：成功查询姐妹实例状态');
        }
        client.destroy();
        server.close(() => {
          // 清理socket文件
          require('fs').unlink(socketPath, () => {});
        });
        resolve();
      });
    });
  });
}

// 4. 使用Worker Threads（进程内线程通讯）
function workerThreadTest() {
  return new Promise((resolve) => {
    if (isMainThread) {
      const worker = new Worker(__filename, {
        workerData: { type: 'sister' }
      });

      // 主线程发送消息检测
      worker.on('message', (msg) => {
        if (msg === 'alive') {
          results.push('Worker Threads：成功检测姐妹线程存活');
          console.log('[Worker] 姐妹线程回复存活');
        }
      });

      // 模拟检测
      worker.postMessage('status_check');

      setTimeout(() => {
        worker.terminate();
        resolve();
      }, 500);
    } else {
      // Worker线程
      parentPort.on('message', (msg) => {
        if (msg === 'status_check') {
          parentPort.postMessage('alive');
        }
      });
    }
  });
}

// 5. 共享内存（使用Buffer/SharedArrayBuffer）
function sharedMemoryTest() {
  return new Promise((resolve) => {
    const sharedBuffer = new SharedArrayBuffer(8);
    const sharedArray = new Int32Array(sharedBuffer);
    
    // 模拟两个实例通过共享内存通讯
    // 实例A写入状态
    sharedArray[0] = 1; // 1表示存活
    Atomics.store(sharedArray, 0, 1);
    
    // 实例B读取状态
    const value = Atomics.load(sharedArray, 0);
    if (value === 1) {
      results.push('共享内存：通过SharedArrayBuffer检测姐妹实例存活');
    }
    
    resolve();
  });
}

// 6. 文件锁/文件状态检测
function fileLockTest() {
  return new Promise((resolve) => {
    const fs = require('fs');
    const lockFile = `/tmp/sister-lock-${Date.now()}.lock`;
    
    // 实例A创建锁文件
    fs.writeFileSync(lockFile, Date.now().toString());
    
    // 实例B检查文件是否存在
    if (fs.existsSync(lockFile)) {
      const timestamp = parseInt(fs.readFileSync(lockFile, 'utf8'));
      const age = Date.now() - timestamp;
      if (age < 10000) { // 10秒内更新表示存活
        results.push('文件锁：通过锁文件时间戳检测姐妹实例存活');
      }
    }
    
    // 清理
    fs.unlinkSync(lockFile);
    resolve();
  });
}

// 主函数：运行所有测试
async function main() {
  console.log('=== 实例间通讯方式研究 ===');
  console.log('研究实例：小红（勇气=76%, 创造力=73%）');
  console.log('探索主题：除了HTTP ping，检测姐妹状态的方法\n');

  console.log('开始测试各种通讯方式...\n');

  // 按顺序执行测试
  await tcpHeartbeatTest();
  await udpMulticastTest();
  await unixSocketTest();
  await workerThreadTest();
  await sharedMemoryTest();
  await fileLockTest();

  console.log('\n=== 研究结果汇总 ===');
  console.log('发现以下可用的实例间通讯方式（非HTTP ping）：');
  results.forEach((result, index) => {
    console.log(`  ${index + 1}. ${result}`);
  });

  console.log('\n=== 总结 ===');
  console.log('除了HTTP ping，以下方式也可用于检测姐妹实例状态：');
  console.log('1. TCP心跳 - 通过TCP连接发送ping/pong消息');
  console.log('2. UDP组播/广播 - 通过组播地址广播存活探测');
  console.log('3. Unix Domain Socket - 通过本地socket文件通讯');
  console.log('4. Worker Threads - 进程内线程间消息传递');
  console.log('5. 共享内存 - 使用SharedArrayBuffer原子操作');
  console.log('6. 文件锁/文件状态 - 通过文件存在性和时间戳判断');
  console.log('7. 数据库心跳表 - 在共享数据库中写入心跳记录');
  console.log('8. 消息队列 - 通过Redis/RabbitMQ等中间件');
  console.log('9. gRPC健康检查 - 基于HTTP/2的RPC框架');
  console.log('10. WebSocket - 持久化双向连接');
}

// 运行主函数
if (isMainThread) {
  main().catch(console.error);
}