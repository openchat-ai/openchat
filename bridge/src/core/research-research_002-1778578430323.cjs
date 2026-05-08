// Research by 小明: 如何实现即使忙也能响应心跳？需要研究异步并发机制
// Generated: 2026-05-12T09:33:50.323Z

/**
 * 研究：如何实现即使忙也能响应心跳？
 * 核心思路：通过异步并发机制，让心跳检测与业务处理并行执行
 * 本代码演示了三种不同策略：
 * 1. 使用 setInterval + async 非阻塞轮询
 * 2. 使用 Worker Threads 分离心跳与计算
 * 3. 使用 Promise.race 实现超时控制的心跳
 */

// ========== 策略1：setInterval + 异步非阻塞心跳 ==========
function strategy1() {
  console.log("\n=== 策略1：setInterval + 异步非阻塞心跳 ===");
  
  let heartbeatCount = 0;
  let busy = true;

  // 模拟一个耗时的异步任务（但不会阻塞事件循环）
  async function doBusyWork() {
    console.log("[业务] 开始处理复杂任务...");
    for (let i = 0; i < 5; i++) {
      // 使用 await 让出事件循环，使得心跳有机会执行
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log(`[业务] 任务进行中 ${i + 1}/5`);
    }
    console.log("[业务] 任务完成！");
    busy = false;
  }

  // 心跳检测函数
  function heartbeat() {
    heartbeatCount++;
    console.log(`[心跳] 第 ${heartbeatCount} 次心跳 - 系统状态: ${busy ? '忙碌' : '空闲'}`);
  }

  // 启动心跳（每200ms检测一次）
  const heartbeatInterval = setInterval(heartbeat, 200);

  // 启动业务任务
  doBusyWork().then(() => {
    clearInterval(heartbeatInterval);
    console.log("[策略1] 测试完成：即使任务繁忙，心跳依然准时响应");
  });
}

// ========== 策略2：使用 Worker Threads 分离心跳 ==========
function strategy2() {
  console.log("\n=== 策略2：Worker Threads 分离心跳与计算 ===");
  
  const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

  if (isMainThread) {
    // 主线程：启动 Worker 执行业务计算
    const worker = new Worker(__filename, { workerData: { type: 'worker' } });
    
    // 主线程：独立的心跳检测（不受 Worker 影响）
    let count = 0;
    const heartbeatInterval = setInterval(() => {
      count++;
      console.log(`[主线程心跳] 第 ${count} 次 - 主线程空闲，可响应`);
      if (count >= 5) {
        clearInterval(heartbeatInterval);
        worker.terminate();
        console.log("[策略2] 测试完成：Worker 负责计算，主线程负责心跳");
      }
    }, 300);

    // 监听 Worker 消息
    worker.on('message', (msg) => console.log(`[Worker消息] ${msg}`));
    worker.on('error', (err) => console.error(err));
  } else {
    // Worker 线程：执行密集计算（模拟繁忙）
    function heavyComputation() {
      return new Promise((resolve) => {
        let result = 0;
        for (let i = 0; i < 100000000; i++) {
          result += Math.sqrt(i);
        }
        resolve(`计算结果: ${result.toFixed(2)}`);
      });
    }

    heavyComputation().then((result) => {
      parentPort.postMessage(result);
    });
  }
}

// ========== 策略3：Promise.race 实现超时心跳 ==========
function strategy3() {
  console.log("\n=== 策略3：Promise.race + 超时心跳 ===");
  
  // 模拟一个可能长时间运行的任务，但允许被心跳中断
  function longRunningTask(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("任务超时，触发心跳恢复"));
      }, timeoutMs);

      // 模拟耗时计算（但实际会阻塞，这里用 setTimeout 模拟）
      setTimeout(() => {
        clearTimeout(timer);
        resolve("任务成功完成");
      }, 2000); // 假设任务需要2秒
    });
  }

  // 心跳信号（快速响应）
  function heartbeatSignal() {
    return new Promise((resolve) => {
      setTimeout(() => resolve("心跳正常"), 100);
    });
  }

  // 使用 Promise.race 让心跳和任务竞争
  async function runWithHeartbeat() {
    for (let i = 0; i < 5; i++) {
      console.log(`\n[轮次 ${i + 1}] 启动任务并等待心跳...`);
      try {
        const result = await Promise.race([
          longRunningTask(500),  // 任务最多等500ms
          heartbeatSignal()       // 心跳100ms就返回
        ]);
        console.log(`[结果] ${result}`);
      } catch (error) {
        console.log(`[异常] ${error.message}`);
        // 这里可以执行心跳恢复逻辑
        console.log("[恢复] 执行心跳恢复操作...");
      }
    }
    console.log("[策略3] 测试完成：通过 Promise.race 确保心跳优先响应");
  }

  runWithHeartbeat();
}

// ========== 执行所有策略 ==========
console.log("========== 异步并发机制研究：忙碌中的心跳响应 ==========");
console.log("研究目标：在系统繁忙时，如何保证心跳检测不被阻塞？");
console.log("核心原理：利用 Node.js 事件循环、Worker 线程、Promise 竞争机制\n");

// 依次执行三种策略
strategy1();

// 策略2 需要特殊处理（Worker Threads），延迟执行避免输出混乱
setTimeout(() => {
  strategy2();
}, 3000);

setTimeout(() => {
  strategy3();
}, 6000);

// 最终总结
setTimeout(() => {
  console.log("\n========== 研究结论 ==========");
  console.log("1. setInterval + async/await：通过让出事件循环，心跳可以穿插执行");
  console.log("2. Worker Threads：将心跳放在主线程，计算放在 Worker，互不影响");
  console.log("3. Promise.race：心跳作为更高优先级的 Promise，可中断或超时任务");
  console.log("核心机制：Node.js 的事件循环、微任务、Worker 线程共同实现了并发");
  console.log("==============================");
}, 10000);