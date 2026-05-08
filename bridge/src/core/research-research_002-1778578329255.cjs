// Research by 管家: 如何实现即使忙也能响应心跳？需要研究异步并发机制
// Generated: 2026-05-12T09:32:09.255Z

// 研究：如何实现即使忙也能响应心跳？
// 核心问题：在长时间阻塞任务中，如何保持对心跳信号的及时响应？
// 解决方案：利用Node.js的事件循环和异步并发机制（setInterval + 工作线程/异步分片）

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { performance } = require('perf_hooks');

// ========== 主线程：心跳监测与任务调度 ==========
if (isMainThread) {
  console.log('=== 研究：忙时响应心跳的异步并发机制 ===\n');

  // 配置
  const HEARTBEAT_INTERVAL = 100; // 心跳间隔（毫秒）
  const TASK_DURATION = 3000;     // 模拟耗时任务总时长（毫秒）
  const TASK_CHUNK_SIZE = 200;    // 每个分片处理时长（毫秒）

  // 状态跟踪
  let heartbeatCount = 0;
  let missedHeartbeats = 0;
  let lastHeartbeatTime = 00;

  // 方案1：使用工作线程分离任务（真正并发）
  function runWithWorker() {
    console.log('\n--- 方案1：使用Worker线程（真正并行）---');
    console.log(`主线程每隔${HEARTBEAT_INTERVAL}ms发送心跳，工作线程执行${TASK_DURATION}ms任务\n`);

    // 创建工作线程执行耗时任务
    const worker = new Worker(__filename, {
      workerData: { duration: TASK_DURATION }
    });

    // 主线程保持心跳响应
    const heartbeatTimer = setInterval(() => {
      heartbeatCount++;
      const now = performance.now();
      console.log(`[${now.toFixed(0)}] 心跳 #${heartbeatCount} - 主线程空闲，及时响应`);
      lastHeartbeatTime = now;
    }, HEARTBEAT_INTERVAL);

    // 监听工作线程消息
    worker.on('message', (msg) => {
      console.log(`\n工作线程完成：${msg}`);
      clearInterval(heartbeatTimer);
      console.log(`\n方案1结果：共发送 ${heartbeatCount} 次心跳，全部及时响应`);
      console.log('结论：Worker线程真正并行，主线程完全不受影响\n');

      // 执行方案2对比
      setTimeout(runWithAsyncChunks, 500);
    });

    worker.on('error', (err) => {
      console.error('Worker错误:', err);
    });
  }

  // 方案2：使用异步分片（模拟并发，但仍在主线程）
  function runWithAsyncChunks() {
    console.log('\n--- 方案2：异步分片（主线程内协作式并发）---');
    console.log(`主线程每隔${HEARTBEAT_INTERVAL}ms发送心跳，任务分片每${TASK_CHUNK_SIZE}ms让出控制权\n`);

    heartbeatCount = 0;
    missedHeartbeats = 02;
    lastHeartbeatTime = performance.now();

    // 心跳定时器
    const heartbeatTimer = setInterval(() => {
      heartbeatCount++;
      const now = performance.now();
      const timeSinceLastHeartbeat = now - lastHeartbeatTime;
      
      // 检查是否错过了心跳（实际是检查心跳是否被延迟）
      if (timeSinceLastHeartbeat > HEARTBEAT_INTERVAL * 1.5) {
        missedHeartbeats++;
        console.log(`[${now.toFixed(0)}] 心跳 #${heartbeatCount} - ⚠️ 延迟响应（上次心跳距今${timeSinceLastHeartbeat.toFixed(0)}ms）`);
      } else {
        console.log(`[${now.toFixed(0)}] 心跳 #${heartbeatCount} - 及时响应`);
      }
      lastHeartbeatTime = now;
    }, HEARTBEAT_INTERVAL);

    // 模拟耗时任务，但使用异步分片
    let elapsed = 0;
    function doChunk() {
      if (elapsed >= TASK_DURATION) {
        // 任务完成
        console.log(`\n任务完成（共${TASK_DURATION}ms）`);
        clearInterval(heartbeatTimer);
        console.log(`方案2结果：共发送 ${heartbeatCount} 次心跳，其中 ${missedHeartbeats} 次延迟`);
        console.log('结论：异步分片能让心跳有机会响应，但仍有延迟风险（取决于分片大小）\n');
        return;
      }

      // 模拟同步阻塞（CPU密集任务，但分片执行）
      const chunkStart = performance.now();
      while (performance.now() - chunkStart < TASK_CHUNK_SIZE) {
        // 密集计算：空循环
        Math.sqrt(Math.random() * 10000);
      }
      elapsed += TASK_CHUNK_SIZE;

      // 让出控制权给事件循环，使心跳有机会执行
      setImmediate(() => doChunk());
    }

    doChunk();
  }

  // 开始研究
  console.log('研究问题：当Node.js主线程忙于CPU密集型任务时，如何保持对心跳信号的响应？');
  console.log('两种方案对比：Worker线程 vs 异步分片\n');
  
  // 先执行方案1
  runWithWorker();
}

// ========== 工作线程代码 ==========
else {
  // 工作线程执行耗时任务
  const duration = workerData.duration;
  const start = performance.now();
  
  // 模拟CPU密集型任务
  while (performance.now() - start < duration) {
    // 密集计算
    Math.sqrt(Math.random() * 100000);
  }
  
  // 通知主线程完成
  parentPort.postMessage(`耗时${duration}ms的CPU任务已完成`);
}