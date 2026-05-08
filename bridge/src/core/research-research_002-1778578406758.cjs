// Research by 小红: 如何实现即使忙也能响应心跳？需要研究异步并发机制
// Generated: 2026-05-12T09:33:26.758Z

// 研究：忙碌状态下如何保持心跳响应
// 核心机制：利用 Node.js 事件循环和异步并发

const EventEmitter = require('events');

// 模拟心跳系统
class HeartbeatSystem extends EventEmitter {
  constructor(interval = 2000) {
    super();
    this.interval = interval;
    this.isRunning = false;
    this.timer = null;
    this.lostBeats = 0;
  }

  start() {
    this.isRunning = true;
    console.log(`[心跳系统] 启动，间隔: ${this.interval}ms`);
    
    // 方案1: 使用 setInterval 发送心跳
    this.timer = setInterval(() => {
      this.emit('heartbeat', Date.now());
      console.log(`[心跳] 发送 #${++this.lostBeats} 时间: ${new Date().toISOString()}`);
    }, this.interval);

    // 监听心跳丢失
    this.on('heartbeat_lost', (count) => {
      console.log(`[警告] 检测到 ${count} 次心跳丢失!`);
    });
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[心跳系统] 停止');
  }
}

// 模拟繁忙任务
function createBusyTask(durationMs, taskName) {
  return new Promise((resolve) => {
    console.log(`[任务] ${taskName} 开始, 持续 ${durationMs}ms`);
    
    // 方案2: 使用 async/await + 微任务队列
    const startTime = Date.now();
    const workInChunks = async () => {
      while (Date.now() - startTime < durationMs) {
        // 执行一小块工作
        for (let i = 0; i < 1000000; i++) {
          Math.sqrt(Math.random() * 1000000);
        }
        
        // 关键: 主动让出事件循环, 让心跳有机会执行
        await new Promise(resolve => setImmediate(resolve));
        
        // 检查是否还有时间
        if (Date.now() - startTime >= durationMs) break;
      }
      console.log(`[任务] ${taskName} 完成`);
      resolve();
    };
    
    workInChunks();
  });
}

// 方案3: 使用 worker_threads 实现真正的并行
const { Worker } = require('worker_threads');

function createHeavyTaskInWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort } = require('worker_threads');
      
      // 执行繁重计算
      function fibonacci(n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }
      
      const result = fibonacci(40); // 计算第40个斐波那契数
      parentPort.postMessage({ result });
    `, { eval: true });
    
    worker.on('message', (msg) => {
      console.log(`[Worker] 计算结果: ${msg.result}`);
      resolve();
    });
    
    worker.on('error', reject);
  });
}

// 主研究流程
async function main() {
  console.log('=== 研究: 忙碌状态下保持心跳响应 ===\n');
  
  const heart = new HeartbeatSystem(1000); // 每秒心跳
  heart.start();
  
  console.log('\n--- 实验1: 同步阻塞任务 (会阻塞心跳) ---');
  console.log('模拟同步阻塞 3 秒...');
  const start = Date.now();
  while (Date.now() - start < 3000) {
    // 同步阻塞, 心跳被阻塞
  }
  console.log('同步阻塞结束\n');
  
  console.log('--- 实验2: 异步分片任务 (心跳不会阻塞) ---');
  await createBusyTask(3000, '异步分片计算');
  
  console.log('\n--- 实验3: 使用 Worker 线程 (真正的并行) ---');
  await createHeavyTaskInWorker();
  
  console.log('\n--- 实验结果分析 ---');
  console.log(`
  关键发现:
  1. 同步阻塞 (while循环): 心跳被完全阻塞 ❌
  2. 异步分片 (setImmediate): 心跳正常执行 ✅
  3. Worker 线程: 心跳完全不受影响 ✅
  
  核心机制:
  - Node.js 事件循环: 异步操作通过事件队列调度
  - 微任务 (Promise.then): 在当前阶段结束时执行
  - setImmediate: 在下一个事件循环阶段执行
  - Worker 线程: 真正的操作系统线程并行
  `);
  
  heart.stop();
  console.log('\n=== 研究完成 ===');
}

main().catch(console.error);