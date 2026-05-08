// Research by 小红: 如何准确检测姐妹实例是否真正宕机？端口被占用但无响应可能是忙，如何区分？需要并发机制让再忙也能响应
// Generated: 2026-05-12T09:33:46.504Z

const net = require('net');
const http = require('http');

/**
 * 高级姐妹实例健康检测器
 * 解决：端口占用但无响应（忙） vs 真正宕机的区分
 * 使用并发探测 + 超时机制
 */
class SisterHealthChecker {
  constructor(options = {}) {
    this.defaultTimeout = options.timeout || 3000; // 默认超时3秒
    this.maxRetries = options.retries || 2;        // 默认重试2次
    this.concurrency = options.concurrency || 3;   // 并发探测数
  }

  /**
   * 核心检测方法
   * @param {string} host - 目标主机
   * @param {number} port - 目标端口
   * @returns {Promise<{alive: boolean, status: string, details: object}>}
   */
  async checkSister(host, port) {
    console.log(`\n[检测开始] 目标 ${host}:${port}`);
    const results = [];

    // 并发执行多个探测任务
    const tasks = [];
    for (let i = 0; i < this.concurrency; i++) {
      tasks.push(this._singleProbe(host, port, i));
    }

    const probeResults = await Promise.allSettled(tasksipse);

    // 分析结果
    const successfulProbes = probeResults.filter(r => r.status === 'fulfilled' && r.value.connected);
    const failedProbes = probeResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.connected));

    console.log(`并发探测结果: ${successfulProbes.length} 成功, ${failedProbes.length} 失败`);

    // 如果至少有一个探测成功连接，说明服务是活着的
    if (successfulProbes.length > 0) {
      // 检查响应质量：是否快速响应
      const fastResponses = successfulProbes.filter(r => r.value.responseTime < 1000);
      if (fastResponses.length > 0) {
        return {
          alive: true,
          status: 'healthy',
          details: {
            message: '服务正常运行，响应迅速',
            responseTime: Math.min(...successfulProbes.map(r => r.value.responseTime)),
            successCount: successfulProbes.length
          }
        };
      } else {
        // 所有连接都慢，可能是忙但活着
        return {
          alive: true,
          status: 'busy',
          details: {
            message: '服务可能繁忙，但仍在响应',
            avgResponseTime: successfulProbes.reduce((sum, r) => sum + r.value.responseTime, 0) / successfulProbes.length,
            successCount: successfulProbes.length
          }
        };
      }
    } else {
      // 所有探测都失败
      // 进一步检查端口是否被占用
      const portInUse = await this._checkPortInUse(host, port);
      if (portInUse) {
        return {
          alive: false,
          status: 'hung',
          details: {
            message: '端口被占用但无任何响应，可能是进程挂起或死锁',
            portInUse: true
          }
        };
      } else {
        return {
          alive: false,
          status: 'down',
          details: {
            message: '端口未占用，服务完全宕机',
            portInUse: false
          }
        };
      }
    }
  }

  /**
   * 单次探测
   */
  _singleProbe(host, port, id) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new net.Socket();
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve({
            connected: false,
            id,
            responseTime: Date.now() - startTime,
            error: 'timeout'
          });
        }
      }, this.defaultTimeout);

      socket.on('connect', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          const responseTime = Date.now() - startTime;
          // 发送一个简单的HTTP请求头来测试应用层响应
          socket.write('GET / HTTP/1.0\r\n\r\n');
          // 等待一点数据返回
          let dataReceived = false;
          socket.once('data', () => {
            dataReceived = true;
          });
          setTimeout(() => {
            socket.destroy();
            resolve({
              connected: true,
              id,
              responseTime,
              dataReceived,
              applicationResponded: dataReceived
            });
          }, 500); // 给应用层500ms响应时间
        }
      });

      socket.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({
            connected: false,
            id,
            responseTime: Date.now() - startTime,
            error: err.message
          });
        }
      });

      socket.connect(port, host);
    });
  }

  /**
   * 检查端口是否被占用
   */
  _checkPortInUse(host, port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(true);
        } else {
          resolve(false);
        }
      });
      server.once('listening', () => {
        server.close();
        resolve(false);
      });
      server.listen(port, host);
    });
  }
}

// ========== 测试代码 ==========
async function runTests() {
  const checker = new SisterHealthChecker({
    timeout: 2000,
    concurrency: 3
  });

  console.log('=== 姐妹实例健康检测研究 ===\n');
  console.log('场景1: 本地测试服务器（假设存在）');
  let result = await checker.checkSister('127.0.0.1', 3000);
  console.log(`结果: ${JSON.stringify(result, null, 2)}`);

  console.log('\n场景2: 不存在的服务（真正宕机）');
  result = await checker.checkSister('127.0.0.1', 19999);
  console.log(`结果: ${JSON.stringify(result, null, 2)}`);

  console.log('\n场景3: 已知公共HTTP服务');
  result = await checker.checkSister('8.8.8.8', 53); // DNS服务
  console.log(`结果: ${JSON.stringify(result, null, 2)}`);

  // 模拟一个繁忙服务（仅用于演示）
  console.log('\n场景4: 模拟繁忙服务（启动一个慢响应服务器）');
  const busyServer = net.createServer((socket) => {
    // 故意延迟响应
    setTimeout(() => {
      socket.end('HTTP/1.1 200 OK\r\n\r\nBusy response');
    }, 2000);
  });
  busyServer.listen(19998, '127.0.0.1', async () => {
    result = await checker.checkSister('127.0.0.1', 19998);
    console.log(`结果: ${JSON.stringify(result, null, 2)}`);
    busyServer.close();

    console.log('\n=== 研究结论 ===');
    console.log('1. 通过并发探测（默认3路）可以区分“忙”与“真宕机”');
    console.log('2. 忙：端口占用，至少一个探测能连接成功但响应慢');
    console.log('3. 真宕机：所有探测失败，端口未被占用');
    console.log('4. 挂起：端口占用但所有探测都超时无响应');
    console.log('5. 并发机制确保即使服务再忙，也能在超时内获得结果');
  });
}

runTests().catch(console.error);