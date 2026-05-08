// Research by 小明: 如何准确检测姐妹实例是否真正宕机？端口被占用但无响应可能是忙，如何区分？需要并发机制让再忙也能响应
// Generated: 2026-05-12T09:31:53.239Z

const net = require('net');
const http = require('http');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// 核心检测函数：通过并发TCP连接 + 超时 + HTTP探测 区分"忙"和"宕机"
function probeHost(host, port, options = {}) {
  return new Promise((resolve) => {
    const {
      tcpTimeout = 500,      // TCP连接超时(ms)
      httpTimeout = 1000,    // HTTP请求超时(ms)
      concurrency = 3,       // 并发连接数
      checkHttp = true       // 是否尝试HTTP GET
    } = options;

    let tcpAlive = false;
    let httpAlive = false;
    let completed = 0;
    const totalChecks = concurrency + (checkHttp ? 1 : 0);
    let finalResult = 'unknown';

    function checkDone() {
      completed++;
      if (completed >= totalChecks) {
        // 综合判断逻辑
        if (httpAlive) {
          finalResult = 'alive (HTTP响应正常)';
        } else if (tcpAlive) {
          finalResult = 'busy (端口开放但无HTTP响应，可能是高负载或非HTTP服务)';
        } else {
          finalResult = 'down (端口无响应，疑似宕机或防火墙拦截)';
        }
        resolve(finalResult);
      }
    }

    // 并发TCP连接探测
    for (let i = 0; i < concurrency; i++) {
      const socket = new net.Socket();
      let timer = setTimeout(() => {
        socket.destroy();
        checkDone();
      }, tcpTimeout);

      socket.on('connect', () => {
        clearTimeout(timer);
        tcpAlive = true;
        socket.destroy();
        checkDone();
      });

      socket.on('error', () => {
        clearTimeout(timer);
        socket.destroy();
        checkDone();
      });

      socket.connect(port, host);
    }

    // HTTP探测（可选）
    if (checkHttp) {
      const req = http.get(`http://${host}:${port}/`, { timeout: httpTimeout }, (res) => {
        httpAlive = true;
        res.resume(); // 消费响应体
        checkDone();
      });

      req.on('error', () => {
        checkDone();
      });

      req.on('timeout', () => {
        req.destroy();
        checkDone();
      });
    }
  });
}

// 模拟一个"忙"的服务器（故意延迟响应以模拟高负载）
function createBusyServer(port) {
  const server = net.createServer((socket) => {
    // 模拟忙：延迟很久才响应，但TCP连接立即接受
    setTimeout(() => {
      socket.write('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nbusy!');
      socket.end();
    }, 3000); // 3秒延迟，超过探测超时
  });
  server.listen(port, () => {
    console.log(`[模拟] 忙服务器已启动在端口 ${port} (TCP接受连接但HTTP响应延迟)`);
  });
  return server;
}

// 模拟一个"宕机"的服务器（端口不监听）
function simulateDownPort(port) {
  // 什么也不做，端口未被占用
  console.log(`[模拟] 端口 ${port} 未被监听 (模拟宕机状态)`);
}

// 主测试流程
async function runTests() {
  console.log('=== 姐妹实例健康检测研究 ===\n');
  console.log('测试目标：区分端口开放但无响应(忙) vs 端口完全无响应(宕机)\n');

  // 测试1：正常工作的服务器
  console.log('--- 测试1: 正常工作的HTTP服务 ---');
  const normalServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('alive');
  });
  await new Promise(resolve => normalServer.listen(0, () => resolve()));
  const normalPort = normalServer.address().port;
  console.log(`正常HTTP服务端口: ${normalPort}`);
  let result1 = await probeHost('127.0.0.1', normalPort, { concurrency: 3, tcpTimeout: 500, httpTimeout: 1000 });
  console.log(`结果: ${result1}\n`);
  normalServer.close();

  // 测试2：忙的服务器（TCP接受连接但HTTP响应慢）
  console.log('--- 测试2: 忙的服务器 (TCP连接快，HTTP响应慢) ---');
  const busyPort = 9123;
  const busyServer = createBusyServer(busyPort);
  await new Promise(resolve => setTimeout(resolve, 100)); // 等待服务器启动
  let result2 = await probeHost('127.0.0.1', busyPort, { concurrency: 3, tcpTimeout: 500, httpTimeout: 1000 });
  console.log(`结果: ${result2}\n`);

  // 测试3：宕机的端口
  console.log('--- 测试3: 宕机端口 (无服务监听) ---');
  const downPort = 9876;
  simulateDownPort(downPort);
  let result3 = await probeHost('127.0.0.1', downPort, { concurrency: 3, tcpTimeout: 500, httpTimeout: 1000 });
  console.log(`结果: ${result3}\n`);

  // 测试4：防火墙模拟（端口被占用但拒绝连接）
  console.log('--- 测试4: 端口被占用但拒绝连接 (模拟防火墙) ---');
  const refusePort = 9999;
  const refuseServer = net.createServer((socket) => {
    socket.destroy(); // 立即断开
  });
  refuseServer.listen(refusePort, () => {
    console.log(`拒绝连接服务器已启动在端口 ${refusePort}`);
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  let result4 = await probeHost('127.0.0.1', refusePort, { concurrency: 3, tcpTimeout: 500, httpTimeout: 1000 });
  console.log(`结果: ${result4}\n`);
  refuseServer.close();

  // 清理忙服务器
  busyServer.close();

  console.log('=== 研究结论 ===');
  console.log('1. 通过并发TCP连接(3次) + 超时(500ms) 可快速检测端口是否开放');
  console.log('2. 若TCP连接成功但HTTP请求超时 → 判定为"忙" (端口开放但服务无响应)');
  console.log('3. 若所有TCP连接都超时/失败 → 判定为"宕机" (端口未监听或被拦截)');
  console.log('4. 并发机制确保即使服务繁忙，也能在超时阈值内完成探测');
  console.log('5. 局限性：无法区分"真正宕机"和"防火墙丢弃数据包"，需要额外ICMP探测');
}

// 运行测试
runTests().catch(console.error);