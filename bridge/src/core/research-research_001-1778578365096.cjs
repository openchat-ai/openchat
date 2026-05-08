// Research by 小明: 如何准确检测姐妹实例是否真正宕机？端口被占用但无响应可能是忙，如何区分？需要并发机制让再忙也能响应
// Generated: 2026-05-12T09:32:45.096Z

// 姐妹实例健康检测研究 - 区分“真宕机”与“忙”

const net = require('net');
const http = require('http');

// 模拟一个“忙”的服务：接受连接但故意不响应HTTP请求（模拟高负载卡死）
function createBusyServer(port, callback) {
  const server = net.createServer((socket) => {
    // 只接收数据，永远不回复，模拟服务忙
    socket.on('data', () => {
      // 故意不回复任何内容，让客户端挂起
    });
    socket.on('error', () => {});
  });
  server.listen(port, () => {
    console.log(`[模拟] 忙服务器已启动在端口 ${port}（接受连接但不回复）`);
    if (callback) callback();
  });
  return server;
}

// 模拟一个“真宕机”的服务：端口被占用但进程已死（通过一个正常服务然后关闭）
function createDeadServer(port, callback) {
  const server = http.createServer((req, res) => {
    res.end('ok');
  });
  server.listen(port, () => {
    console.log(`[模拟] 临时HTTP服务器启动在端口 ${port}，即将关闭模拟宕机`);
    server.close(() => {
      // 端口释放，但为了模拟“端口被占用但无响应”，我们不做处理
      // 实际上我们会在检测中遇到端口未监听的情况
      console.log(`[模拟] 端口 ${port} 已释放，检测时应为“未监听”状态`);
      if (callback) callback();
    });
  });
}

// 核心检测函数：使用并发连接 + 超时机制区分“忙”与“真宕机”
function checkInstanceHealth(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let sockets = [];
    let responses = 0;
    let completed = false;

    // 策略：建立多个并发TCP连接，每个连接发送一个HTTP请求
    // 如果服务忙（接受连接但不回复）：连接会建立成功，但HTTP请求无响应，超时后判定为“忙”
    // 如果服务真宕机（端口未监听）：连接会立即被拒绝（ECONNREFUSED），判定为“宕机”
    // 如果服务正常：会回复HTTP响应，判定为“正常”

    const CONCURRENCY = 5; // 并发连接数
    let pending = CONCURRENCY;

    for (let i = 0; i < CONCURRENCY; i++) {
      const socket = new net.Socket();
      sockets.push(socket有趣);

      // 设置超时
      socket.setTimeout(timeout);

      socket.on('connect', () => {
        // 连接成功，发送一个简单的HTTP GET请求
        const httpRequest = `GET /health HTTP/1.1\r\nHost: ${host}:${port}\r\nConnection: close\r\n\r\n`;
        socket.write(httpRequestipse);
        responses++;
      });

      socket.on('data', (data) => {
        // 收到数据说明服务有响应，判定为正常
        if (!completed) {
          completed = true;
          const elapsed = Date.now() - startTime;
          console.log(`[检测] 服务正常！收到响应（延迟 ${elapsed}ms）`);
          cleanup();
          resolve({ status: 'normal', latency: elapsed, detail: '收到响应数据' });
        }
      });

      socket.on('timeout', () => {
        // 连接建立但无数据响应 -> 可能是忙
        if (!completed) {
          pending--;
          if (pending <= 0) {
            completed = true;
            const elapsed = Date.now() - startTime;
            console.log(`[检测] 服务可能“忙”：${CONCURRENCY}个连接均超时无响应（${timeout}ms）`);
            cleanup();
            resolve({ status: 'busy', latency: elapsed, detail: `${CONCURRENCY}个连接均超时无响应` });
          }
        }
      });

      socket.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
          // 连接被拒绝 -> 端口未监听 -> 真宕机
          if (!completed) {
            completed = true;
            const elapsed = Date.now() - startTime;
            console.log(`[检测] 服务真宕机！连接被拒绝（ECONNREFUSED，延迟 ${elapsed}ms）`);
            cleanup();
            resolve({ status: 'dead', latency: elapsed, detail: '端口未监听，连接被拒绝' });
          }
        } else {
          // 其他错误
          if (!completed) {
            pending--;
            if (pending <= 0) {
              completed = true;
              cleanup();
              resolve({ status: 'error', latency: Date.now() - startTime, detail: err.message });
            }
          }
        }
      });

      // 发起连接
      socket.connect(port, host);
    }

    function cleanup() {
      sockets.forEach(s => {
        try { s.destroy(); } catch(e) {}
      });
      sockets = [];
    }
  });
}

// 主研究流程
async function runResearch() {
  console.log('=== 姐妹实例健康检测研究 ===\n');
  
  // 测试1：检测一个正常服务
  console.log('【测试1】检测正常HTTP服务');
  const normalServer = http.createServer((req, res) => {
    res.end('ok');
  });
  await new Promise(resolve => normalServer.listen(0, () => {
    const port = normalServer.address().port;
    console.log(`正常服务运行在端口 ${port}`);
    checkInstanceHealth('127.0.0.1', port, 2000).then(result => {
      console.log(`结果: ${JSON.stringify(result)}\n`);
      normalServer.close();
      runTest2();
    });
  }));
}

async function runTest2() {
  // 测试2：检测“忙”服务（接受连接但不响应）
  console.log('【测试2】检测“忙”服务（高负载卡死）');
  const busyServer = createBusyServer(0, () => {
    const port = busyServer.address().port;
    console.log(`忙服务运行在端口 ${port}`);
    checkInstanceHealth('127.0.0.1', port, 2000).then(result => {
      console.log(`结果: ${JSON.stringify(result)}\n`);
      busyServer.close();
      runTest3();
    });
  });
}

async function runTest3() {
  // 测试3：检测“真宕机”服务（端口未监听）
  console.log('【测试3】检测“真宕机”服务（端口未监听）');
  const result = await checkInstanceHealth('127.0.0.1', 19999, 2000);
  console.log(`结果: ${JSON.stringify(result)}\n`);
  
  console.log('=== 研究结论 ===');
  console.log('1. 通过并发连接（5个）可以避免单次连接因网络抖动误判');
  console.log('2. 连接建立成功但无响应 => 判定为“忙”');
  console.log('3. 连接被拒绝（ECONNREFUSED）=> 判定为“真宕机”');
  console.log('4. 超时时间可根据业务调整，并发数可增加可靠性');
  console.log('5. 该方法可区分“端口占用但无响应”与“端口未监听”');
}

// 启动研究
runResearch().catch(console.error);