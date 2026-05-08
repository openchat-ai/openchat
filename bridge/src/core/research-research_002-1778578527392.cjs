// Research by 小明: 如何实现即使忙也能响应心跳？需要研究异步并发机制
// Generated: 2026-05-12T09:35:27.392Z

// 研究：如何在繁忙任务中保持心跳响应
// 核心思路：利用异步并发机制，将心跳检测与主任务分离

const EventEmitter = require('events');

// 模拟心跳响应器
class HeartbeatResponder extends EventEmitter {
  constructor(intervalMs = 1000) {
    super();
    this.intervalMs = intervalMs;
    this.isAlive = false;
    this.heartbeatTimer = null;
  }

  start() {
    this.isAlive = true;
    console.log(`[心跳] 启动，间隔 ${this.intervalMs}ms`);
    
    // 使用 setInterval 作为心跳定时器，这是异步并发的关键
    this.heartbeatTimer = setInterval(() => {
      if (this.isAlive) {
        this.emit('heartbeat', Date.now());
        console.log(`[心跳] ♥ 在 ${new Date().toISOString()} 响应`);
      }
    }, this.intervalMs);
  }

  stop() {
    this.isAlive = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    console.log('[心跳] 停止');
  }
}

// 模拟一个繁忙的同步任务（阻塞主线程）
function simulateBusyWork(durationMs) {
  const start = Date.now();
  console.log(`[繁忙] 开始执行阻塞任务，持续 ${durationMs}ms`);
  
  // 注意：这是同步阻塞，会阻止事件循环
  // 在真实场景中这是不可取的，这里仅用于演示问题
  while (Date.now() - start < durationMs) {
    // 空循环消耗CPU
  }
  
  console.log(`[繁忙] 阻塞任务完成，耗时 ${Date.now() - start}ms`);
}

// 模拟一个异步繁忙任务（不阻塞事件循环）
async function simulateAsyncBusyWork(durationMs) {
  console.log(`[异步繁忙] 开始执行异步任务，持续 ${durationMs}ms`);
  
  // 使用 Promise 和 setTimeout 来让出事件循环
  await new Promise((resolve) => {
    let accumulated = 0;
    const chunk = 50; // 每次处理50ms的工作
    
    function doChunk() {
      // 模拟一小段同步计算
      const start = Date.now();
      while (Date.now() - start < chunk) {
        // 模拟计算
        Math.sqrt(Math.random() * 10000);
      }
      accumulated += chunk;
      
      if (accumulated < durationMs) {
        // 让出事件循环，使得心跳有机会执行
        setImmediate(doChunk);
      } else {
        console.log(`[异步繁忙] 异步任务完成，总耗时 ${accumulated}ms`);
        resolve();
      }
    }
    
    setImmediate(doChunk);
  });
}

// 主研究函数
async function researchHeartbeatVsBusy() {
  console.log('=== 研究：繁忙任务中的心跳响应 ===\n');
  
  // 创建心跳实例
  const responder = new HeartbeatResponder(500); // 500ms 心跳间隔
  responder.start();
  
  // 阶段1：观察同步阻塞对心跳的影响
  console.log('\n--- 阶段1：同步阻塞任务 ---');
  console.log('预期：心跳会在阻塞期间完全停止响应');
  
  // 执行一个3秒的同步阻塞任务
  // 注意：这会完全阻塞事件循环，心跳将无法响应
  const blockStart = Date.now();
  try {
    simulateBusyWork(3000);
  } catch (e) {
    console.error('同步任务异常:', e.message);
  }
  console.log(`同步阻塞后经过时间: ${Date.now() - blockStart}ms`);
  console.log('观察：心跳在阻塞期间完全停止，阻塞结束后才恢复');
  
  // 阶段2：观察异步非阻塞对心跳的影响
  console.log('\n--- 阶段2：异步非阻塞任务 ---');
  console.log('预期：心跳会持续响应，不受异步任务影响');
  
  // 执行一个3秒的异步任务
  const asyncStart = Date.now();
  await simulateAsyncBusyWork(3000);
  console.log(`异步任务后经过时间: ${Date.now() - asyncStart}ms`);
  console.log('观察：心跳在整个异步任务期间持续响应');
  
  // 阶段3：混合场景测试
  console.log('\n--- 阶段3：混合场景 ---');
  console.log('先执行短同步任务，再执行异步任务');
  
  simulateBusyWork(1000); // 1秒同步阻塞
  await simulateAsyncBusyWork(2000); // 2秒异步任务
  
  // 停止心跳
  responder.stop();
  
  // 输出研究结论
  console.log('\n=== 研究结论 ===');
  console.log('1. 同步阻塞 (while循环等) 会完全阻塞事件循环，导致心跳无法响应');
  console.log('2. 异步任务 (setTimeout/setImmediate/Promise) 不会阻塞事件循环，心跳可以正常响应');
  console.log('3. 实现“忙也能响应心跳”的关键是避免长时间同步阻塞，使用异步并发机制');
  console.log('4. 推荐方案：将耗时任务拆分为小片，使用 setImmediate/nextTick 让出控制权');
  console.log('5. 或者使用 Worker Threads 将阻塞任务移到独立线程');
}

// 运行研究
researchHeartbeatVsBusy().catch(console.errorapsed ${accumulated}ms`);
        resolve();
      }
    }
    
    setImmediate(doChunk);
  });
}

// 主研究函数
async function researchHeartbeatVsBusy() {
  console.log('=== 研究：繁忙任务中的心跳响应 ===\n');
  
  // 创建心跳实例
  const responder = new HeartbeatResponder(500); // 500ms 心跳间隔
  responder.start();
  
  // 阶段1：观察同步阻塞对心跳的影响
  console.log('\n--- 阶段1：同步阻塞任务 ---');
  console.log('预期：心跳会在阻塞期间完全停止响应');
  
  // 执行一个3秒的同步阻塞任务
  const blockStart = Date.now();
  simulateBusyWork(3000);
  console.log(`同步阻塞后经过时间: ${Date.now() - blockStart}ms`);
  console.log('观察：心跳在阻塞期间完全停止，阻塞结束后才恢复');
  
  // 阶段2：观察异步非阻塞对心跳的影响
  console.log('\n--- 阶段2：异步非阻塞任务 ---');
  console.log('预期：心跳会持续响应，不受异步任务影响');
  
  // 执行一个3秒的异步任务
  const asyncStart = Date.now();
  await simulateAsyncBusyWork(3000);
  console.log(`异步任务后经过时间: ${Date.now() - asyncStart}ms`);
  console.log('观察：心跳在整个异步任务期间持续响应');
  
  // 阶段3：混合场景测试
  console.log('\n--- 阶段3：混合场景 ---');
  console.log('先执行短同步任务，再执行异步任务');
  
  simulateBusyWork(1000); // 1秒同步阻塞
  await simulateAsyncBusyWork(2000); // 2秒异步任务
  
  // 停止心跳
  responder.stop();
  
  // 输出研究结论
  console.log('\n=== 研究结论 ===');
  console.log('1. 同步阻塞 (while循环等) 会完全阻塞事件循环，导致心跳无法响应');
  console.log('2. 异步任务 (setTimeout/setImmediate/Promise) 不会阻塞事件循环，心跳可以正常响应');
  console.log('3. 实现“忙也能响应心跳”的关键是避免长时间同步阻塞，使用异步并发机制');
  console.log('4. 推荐方案：将耗时任务拆分为小片，使用 setImmediate/nextTick 让出控制权');
  console.log('5. 或者使用 Worker Threads 将阻塞任务移到独立线程');
}

// 运行研究
researchHeartbeatVsBusy().catch(console.error);