// Research by 管家: 如何实现即使忙也能响应心跳？需要研究异步并发机制
// Generated: 2026-05-12T09:33:54.269Z

// 研究：如何实现即使忙也能响应心跳？
// 核心思路：使用异步并发机制，将心跳检测和任务处理分离到不同的执行路径
// 这里我们探索两种方法：1) setInterval + 异步任务 2) 使用 Worker Threads 实现真正的并行

// 方法1：使用 setInterval 和异步非阻塞任务
// 即使主线程在处理耗时任务（通过 setTimeout 模拟），setInterval 仍然能按时触发心跳回调
// 这是因为 Node.js 的事件循环会优先处理定时器回调（在 timers 阶段）

console.log("=== 研究开始：异步并发机制与心跳响应 ===");
console.log("方法1：使用 setInterval 处理心跳 + 异步任务");

// 模拟心跳函数
function heartbeat(tag) {
  console.log(`[${tag}] 心跳信号: 时间戳 ${Date.now()}`);
}

// 模拟一个“忙”的任务：异步但非阻塞的耗时操作
function busyWork(durationMs, taskId) {
  return new Promise((resolve) => {
    // 使用 setTimeout 模拟异步任务，不会阻塞事件循环
    setTimeout(() => {
      console.log(`任务 ${taskId} 完成，耗时 ${durationMs}ms`);
      resolve();
    }, durationMs);
  });
}

// 启动心跳定时器（每 500ms 发送一次心跳）
const heartInterval = setInterval(() => {
  heartbeat("setInterval");
}, 500);

// 启动一系列“忙”的任务，它们不会阻塞心跳
async function runBusyTasks() {
  console.log("开始执行异步任务...");
  await busyWork(1200, "A");  // 耗时 1.2 秒
  await busyWork(800, "B");   // 耗时 0.8 秒
  await busyWork(2000, "C");  // 耗时 2 秒
  console.log("所有异步任务完成");
  
  // 方法2：使用 Worker Threads 实现真正的并行（CPU 密集型任务）
  console.log("\n=== 方法2：使用 Worker Threads 实现真正并行 ===");
  const { Worker } = require('worker_threads');
  
  // 创建一个 Worker 执行 CPU 密集型任务
  const worker = new Worker(`
    const { parentPort } = require('worker_threads');
    
    // 模拟 CPU 密集型计算（计算斐波那契数列）
    function fib(n) {
      if (n <= 1) return n;
      return fib(n - 1) + fib(n - 2);
    }
    
    // 执行耗时计算（fib(40) 大约需要 1-2 秒）
    const result = fib(40);
    parentPort.postMessage({ result, from: 'worker' });
  `, { eval: true });
  
  // 主线程继续响应心跳
  const workerHeartbeat = setInterval(() => {
    heartbeat("Worker 期间");
  }, 500);
  
  worker.on('message', (msg) => {
    console.log(`\nWorker 返回结果: fib(40) = ${msg.result}`);
    clearInterval(workerHeartbeat);  // 停止 Worker 期间的心跳
    
    // 清理并输出结论
    clearInterval(heartInterval);
    console.log("\n=== 研究结论 ===");
    console.log("1. 使用 setInterval + 异步任务 (Promise/setTimeout)：");
    console.log("   - 心跳可以准时触发，因为异步任务不会阻塞事件循环");
    console.log("   - 适用于 I/O 密集型或非阻塞任务");
    console.log("2. 使用 Worker Threads：");
    console.log("   - 对于 CPU 密集型任务，Worker 在独立线程运行，不阻塞主线程");
    console.log("   - 主线程的心跳仍然可以正常响应");
    console.log("3. 关键机制：Node.js 事件循环的异步非阻塞特性");
    console.log("   - 定时器回调在事件循环的 timers 阶段执行");
    console.log("   - 异步操作（如 setTimeout/Promise）会注册回调，不阻塞后续代码");
    console.log("   - Worker Threads 提供了真正的并行执行能力");
  });
  
  worker.on('error', (err) => {
    console.error('Worker 错误:', err);
  });
}

runBusyTasks().catch(console.error);