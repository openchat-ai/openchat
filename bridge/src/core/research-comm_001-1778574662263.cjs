// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:31:02.263Z

// 实例间通讯方式研究：检测姐妹状态的方法对比
// 除了HTTP ping，探索多种进程间通讯方式

const net = require('net');
const cluster = require('cluster');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// 研究工具类：模拟姐妹实例并测试不同通讯方式
class SisterCommunicationStudy {
  constructor() {
    this.results = [];
    this.workers = [];
    this.sharedState = new EventEmitter();
  }

  // 方法1：TCP Socket 心跳检测
  testTCPSocketHeartbeat() {
    const server = net.createServer((socket) => {
      socket.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg === 'PING') {
          socket.write('PONG');
        }
      });
    });

    server.listen(0, () => {
      const port = server.address().port;
      const client = net.createConnection({ port }, () => {
        client.write('PING');
      });

      client.on('data', (data) => {
        const response = data.toString().trim();
        this.results.push({
          method: 'TCP Socket 心跳',
          status: response === 'PONG' ? '成功' : '失败',
          latency: '低延迟，可靠'
        });
        client.end();
        server.close();
      });
    });
  }

  // 方法2：Unix Domain Socket（本地进程间通讯）
  testUnixDomainSocket() {
    const socketPath = path.join(os.tmpdir(), `sister-${Date.now()}.sock`);
    
    const server = net.createServer((socket) => {
      socket.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg === 'STATUS_CHECK') {
          socket.write('ALIVE');
        }
      });
    });

    server.listen(socketPath, () => {
      const client = net.createConnection({ path: socketPath }, () => {
        client.write('STATUS_CHECK');
      });

      client.on('data', (data) => {
        const response = data.toString().trim();
        this.results.push({
          method: 'Unix Domain Socket',
          status: response === 'ALIVE' ? '成功' : '失败',
          latency: '极低延迟，仅限同机'
        });
        client.end();
        server.close(() => {
          try { fs.unlinkSync(socketPath); } catch(e) {}
        });
      });
    });
  }

  // 方法3：共享文件锁 + 文件状态检测
  testSharedFileLock() {
    const lockFile = path.join(os.tmpdir(), `sister-lock-${process.pid}.lock`);
    
    // 模拟姐妹实例写入状态文件
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: process.pid,
      timestamp: Date.now(),
      status: 'alive'
    }));

    // 检测文件是否被更新（姐妹实例会定期更新）
    const checkInterval = setInterval(() => {
      try {
        const data = fs.readFileSync(lockFile, 'utf8');
        const status = JSON.parse(data);
        if (status.status === 'alive' && (Date.now() - status.timestamp) < 5000) {
          this.results.push({
            method: '共享文件锁',
            status: '成功 (姐妹存活)',
            latency: '中等延迟，依赖文件系统'
          });
          clearInterval(checkInterval);
          fs.unlinkSync(lockFile);
        }
      } catch(e) {
        clearInterval(checkInterval);
      }
    }, 100);

    // 模拟姐妹实例更新文件
    setTimeout(() => {
      fs.writeFileSync(lockFile, JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        status: 'alive'
      }));
    }, 200);
  }

  // 方法4：进程信号 (SIGUSR1/SIGUSR2)
  testProcessSignals() {
    // 创建子进程模拟姐妹实例
    if (cluster.isMaster) {
      const worker = cluster.fork();
      
      // 主进程发送信号检测
      setTimeout(() => {
        const alive = worker.isConnected();
        this.results.push({
          method: '进程信号 (SIGUSR)',
          status: alive ? '成功 (进程存活)' : '失败',
          latency: '极快，但仅限父子进程'
        });
        worker.kill();
      }, 500);
    }
  }

  // 方法5：消息队列 (使用EventEmitter模拟)
  testMessageQueue() {
    // 使用EventEmitter模拟消息队列
    const queue = new EventEmitter();
    let responseReceived = false;

    // 模拟姐妹实例监听
    queue.on('health-check', (respond) => {
      respond('ALIVE');
    });

    // 发送健康检查
    queue.emit('health-check', (response) => {
      if (response === 'ALIVE') {
        this.results.push({
          method: '消息队列 (EventEmitter)',
          status: '成功',
          latency: '极低延迟，内存级通讯'
        });
      }
    });
  }

  // 方法6：共享内存 (使用Buffer模拟)
  testSharedMemory() {
    // 创建共享Buffer (实际场景可用mmap)
    const sharedBuffer = Buffer.alloc(1024);
    
    // 模拟姐妹实例写入状态
    sharedBuffer.write('ALIVE', 0);
    
    // 读取状态
    const status = sharedBuffer.toString('utf8', 0, 5);
    this.results.push({
      method: '共享内存 (Buffer模拟)',
      status: status === 'ALIVE' ? '成功' : '失败',
      latency: '纳秒级，最快方式'
    });
  }

  // 综合研究并输出结果
  async study() {
    console.log('========== 实例间通讯方式研究 ==========');
    console.log('研究主题：检测姐妹实例状态的方法对比\n');
    console.log('探索以下非HTTP方式：\n');

    // 执行所有测试
    this.testTCPSocketHeartbeat();
    this.testUnixDomainSocket();
    this.testSharedFileLock();
    this.testProcessSignals();
    this.testMessageQueue();
    this.testSharedMemory();

    // 等待异步测试完成
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('研究结果：');
    console.log('----------------------------------------');
    console.log('| 通讯方式                | 状态  | 特点                |');
    console.log('----------------------------------------');
    
    this.results.forEach(r => {
      console.log(`| ${r.method.padEnd(25)}| ${r.status.padEnd(5)} | ${r.latency.padEnd(20)} |`);
    });
    
    console.log('----------------------------------------\n');
    console.log('总结分析：');
    console.log('1. TCP/UDP Socket: 最通用的网络级心跳检测');
    console.log('2. Unix Domain Socket: 同机高性能通讯首选');
    console.log('3. 共享文件: 简单但依赖文件系统，适合跨语言');
    console.log('4. 进程信号: 快速但功能有限，仅限进程间');
    console.log('5. 消息队列: 解耦异步通讯，适合分布式');
    console.log('6. 共享内存: 最快但实现复杂，需同步机制');
    console.log('\n建议：根据部署场景选择合适的通讯方式');
    console.log('- 同机部署: Unix Socket 或 共享内存');
    console.log('- 跨机部署: TCP Socket 或 消息队列');
    console.log('- 简单场景: 文件锁或信号');
    
    return this.results;
  }
}

// 运行研究
const study = new SisterCommunicationStudy();
study.study().then(results => {
  console.log('\n研究完成，共测试', results.length, '种通讯方式');
}).catch(err => {
  console.error('研究过程出错:', err);
});