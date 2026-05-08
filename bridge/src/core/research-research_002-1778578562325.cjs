// Research by 小明: 如何实现即使忙也能响应心跳？需要研究异步并发机制
// Generated: 2026-05-12T09:36:02.325Z

// 研究：如何实现即使忙也能响应心跳？
// 核心思路：使用 Node.js 的事件循环和异步并发机制，将心跳检测放在独立的高优先级微任务/定时器中，
// 与耗时任务并行执行，避免阻塞。

const EventEmitter = require('events');

// 模拟一个需要长时间计算的任务（同步阻塞任务）
function busyTask(durationMs) {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    // 空循环模拟 CPU 密集型工作
    Math.sqrt(Math.random() * 100000);
  }
  console.log(`[${new Date().toISOString()}] 耗时任务完成 (${durationMs}ms)`);
}

// 模拟异步的心跳响应机制
class HeartbeatService extends EventEmitter {
  constructor(intervalMs = 500) {
    super();
    this.intervalMs = intervalMs;
    this.alive = false;
    this.beatCount = 0;
  }

  start() {
    this.alive = true;
    console.log(`[${new Date().toISOString()}] 心跳服务启动，间隔 ${this.intervalMs}ms`);
    
    // 使用 setInterval 但内部用 setTimeout 链式调用，更可控
    const tick = () => {
      if (!this.alive) return;
      this.beatCount++;
      const now = new Date().toISOString();
      console.log(`[${now}] ❤️ 心跳 #${this.beatCount} (任务队列状态: 事件循环未阻塞?)`);
      
      // 模拟心跳响应：即使主线程忙，这个回调仍然能执行（因为它是异步的）
      this.emit('heartbeat', this.beatCount);
      
      // 调度下一次心跳（使用 setTimeout 而非 setInterval 以避免累积）
      setTimeout(tick, this.intervalMs);
    };
    
    // 立即开始第一次心跳
    setTimeout(tick, 0);
  }

  stop() {
    this.alive = false;
    console.log(`[${new Date().toISOString()}] 心跳服务停止`);
  }
}

// 研究主程序
function runStudy() {
  console.log('='.repeat(60));
  console.log('研究：如何实现即使忙也能响应心跳？');
  console.log('='.repeat(60));
  
  // 创建心跳服务
  const heart = new HeartbeatService(300); // 每300ms一次心跳
  heart.start();

  // 监听心跳事件
  heart.on('heartbeat', (count) => {
    // 这里可以放一些轻量响应，但为了研究，我们只记录
  });

  // 场景1：先执行一个短耗时任务，观察心跳是否被阻塞
  console.log(`\n[${new Date().toISOString()}] 场景1: 执行短耗时任务 (500ms)...`);
  busyTask(500); // 同步阻塞 500ms
  
  // 场景2：执行一个长耗时任务，看心跳是否仍在响应
  console.log(`\n[${new Date().toISOString()}] 场景2: 执行长耗时任务 (2000ms)...`);
  busyTask(2000); // 同步阻塞 2s
  
  // 场景3：使用 setImmediate 或 process.nextTick 测试微任务优先级
  console.log(`\n[${new Date().toISOString()}] 场景3: 测试微任务对心跳的影响`);
  // 大量微任务（但不会完全阻塞事件循环）
  for (let i = 0; i < 5; i++) {
    process.nextTick(() => {
      console.log(`[${new Date().toISOString()}] 微任务 ${i+1} 执行`);
    });
  }
  
  // 场景4：异步任务中嵌入心跳响应
  console.log(`\n[${new Date().toISOString()}] 场景4: 异步任务+心跳 (使用Promise)`);
  const asyncTask = new Promise((resolve) => {
    setTimeout(() => {
      console.log(`[${new Date().toISOString()}] 异步任务完成`);
      resolve();
    }, 800);
  });

  // 注意：由于 busyTask 是同步阻塞的，上面的异步任务和心跳会在同步任务完成后才执行
  // 这正是问题所在！所以我们需要将耗时任务也异步化或拆解

  // 结论分析
  setTimeout(() => {
    console.log('\n' + '='.repeat(60));
    console.log('研究结论:');
    console.log('1. 同步阻塞任务 (如 while 循环) 会完全阻塞事件循环，导致心跳无法响应');
    console.log('2. 解决方案: 将耗时任务拆分为异步片段 (setTimeout/setImmediate/worker_threads)');
    console.log('3. 使用 setInterval/setTimeout 的心跳能保证在事件循环空闲时及时响应');
    console.log('4. 对于 CPU 密集型任务，建议使用 Worker 线程或子进程分离');
    console.log('5. 微任务 (nextTick/Promise) 会在当前阶段执行，不影响定时器精度');
    console.log('='.repeat(60));
    
    // 停止心跳
    heart.stop();
    process.exit(0);
  }, 3000); // 等待异步任务完成
}

// 运行研究
runStudy();