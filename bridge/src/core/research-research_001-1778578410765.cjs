// Research by 小明: 如何准确检测姐妹实例是否真正宕机？端口被占用但无响应可能是忙，如何区分？需要并发机制让再忙也能响应
// Generated: 2026-05-12T09:33:30.765Z

const net = require('net');
const http = require('http');
const { EventEmitter } = require('events');

// 模拟一个"忙"的服务 - 接受连接但永远不响应
function createBusyServer(port) {
  const server = net.createServer((socket) => {
    console.log(`[忙服务器] 接受了连接，但保持沉默...`);
    // 故意不发送任何数据，模拟"忙"状态
    // socket 保持打开但不响应
  });
  
  server.listen(port, () => {
    console.log(`[忙服务器] 运行在端口 ${port}`);
  });
  
  return server;
}

// 模拟一个"宕机"的服务 - 端口未被占用
// 实际上就是端口没有被监听

// 模拟一个"正常"的服务
function createNormalServer(port) {
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
  });
  
  server.listen(port, () => {
    console.log(`[正常服务器] 运行在端口 ${port}`);
  });
  
  return server;
}

// 带超时的连接检测 - 核心检测逻辑
function detectServiceStatus(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let timer = null;
    let resolved = false;
    
    const finish = (status, detail) => {
      if (resolved) return;
      resolved = true;
      
      if (timer) clearTimeout(timer);
      if (!socket.destroyed) {
        socket.destroy();
      }
      
      resolve({
        status,
        detail,
        elapsed: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
    };
    
    // 超时处理 - 区分"忙"和"宕机"
    timer = setTimeout(() => {
      // 关键：如果在连接建立后超时，说明服务"忙"
      if (socket.readyState === 'open') {
        finish('busy', '连接已建立但无响应');
      } else {
        finish('down', '连接超时');
      }
    }, timeout);
    
    // 连接错误 - 端口未监听
    socket.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        finish('down', '连接被拒绝，端口未监听');
      } else if (err.code === 'ENETUNREACH') {
        finish('down', '网络不可达');
      } else {
        finish('error', err.message);
      }
    });
    
    // 成功连接
    socket.connect(port, host, () => {
      // 连接成功，但需要等待响应
      // 设置一个更短的超时来判断是否真的"忙"
      const responseTimer = setTimeout(() => {
        finish('busy', '连接成功但无数据响应');
      }, Math.min(timeout, 1000)); // 1秒无响应就认为是"忙"
      
      // 如果有数据回来，说明服务正常
      socket.once('data', (data) => {
        clearTimeout(responseTimer);
        finish('alive', `收到响应: ${data.length} bytes`);
      });
      
      // 如果连接被关闭，也算一种响应
      socket.once('close', () => {
        clearTimeout(responseTimer);
        finish('alive', '连接正常关闭');
      });
    });
  });
}

// 并发检测 - 多个检测同时进行
async function concurrentDetection(host, port, concurrency = 3, timeout = 2000) {
  console.log(`\n开始并发检测 ${host}:${port} (并发数: ${concurrency}, 超时: ${timeout}ms)`);
  
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    promises.push(detectServiceStatus(host, port, timeout));
  }
  
  const results = await Promise.all(promises);
  
  // 分析结果
  const statusCounts = {};
  results.forEach(r => {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  });
  
  console.log(`检测结果统计:`);
  console.log(`  - alive: ${statusCounts['alive'] || 0}`);
  console.log(`  - busy: ${statusCounts['busy'] || 0}`);
  console.log(`  - down: ${statusCounts['down'] || 0}`);
  
  // 决策逻辑 - 综合判断
  const aliveRatio = (statusCounts['alive'] || 0) / concurrency;
  const busyRatio = (statusCounts['busy'] || 0) / concurrency;
  
  let finalStatus;
  if (aliveRatio > 0.5) {
    finalStatus = 'alive';
  } else if (busyRatio > 0.5) {
    finalStatus = 'busy';
  } else {
    finalStatus = 'down';
  }
  
  console.log(`最终判断: ${finalStatus}`);
  
  return {
    finalStatus,
    details: results,
    statistics: statusCounts
  };
}

// 主测试函数
async function main() {
  console.log('=== 服务状态检测研究 ===\n');
  
  // 测试场景
  const testCases = [
    { name: '正常服务', port: 3001, type: 'normal' },
    { name: '忙服务', port: 3002, type: 'busy' },
    { name: '宕机服务', port: 3003, type: 'down' }
  ];
  
  // 启动服务
  const normalServer = createNormalServer(3001);
  const busyServer = createBusyServer(3002);
  // 3003 端口不启动任何服务
  
  // 等待服务启动
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log('\n=== 单次检测对比 ===\n');
  
  for (const testCase of testCases) {
    console.log(`\n--- 测试: ${testCase.name} ---`);
    const result = await detectServiceStatus('localhost', testCase.port);
    console.log(`结果: status=${result.status}, detail=${result.detail}, elapsed=${result.elapsed}ms`);
  }
  
  console.log('\n=== 并发检测对比 ===\n');
  
  for (const testCase of testCases) {
    console.log(`\n--- 并发测试: ${testCase.name} ---`);
    await concurrentDetection('localhost', testCase.port, 5, 2000);
  }
  
  // 清理
  normalServer.close();
  busyServer.close();
  
  console.log('\n=== 研究结论 ===');
  console.log('1. 端口占用 ≠ 服务正常（忙服务也会占用端口）');
  console.log('2. 通过带超时的连接检测可以区分：');
  console.log('   - 连接被拒绝 → 宕机');
  console.log('   - 连接成功但无响应 → 忙');
  console.log('   - 连接成功有响应 → 正常');
  console.log('3. 并发检测可以提高判断准确性，减少误判');
  console.log('4. 建议使用 2-3 秒的超时时间，平衡检测速度和准确性');
}

// 运行测试
main().catch(console.error);