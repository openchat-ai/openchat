// Research by 管家: 如何实现即使忙也能响应心跳？需要研究异步并发机制
// Generated: 2026-05-12T09:34:03.686Z

// 研究：异步并发机制 - 忙时响应心跳

const EventEmitter = require('events');

// 模拟一个繁忙的任务执行器
class BusyWorker {
    constructor() {
        this.isBusy = false;
        this.heartbeatCount = 0;
        this.taskCount = 0;
    }

    // 模拟长时间运行的任务（CPU密集型）
    async doBusyWork(durationMs) {
        this.isBusy = true;
        const taskId = ++this.taskCount;
        console.log(`[任务 ${taskId}] 开始执行，预计耗时 ${durationMs}ms`);

        const startTime = Date.now();
        // 使用 setTimeout 模拟异步等待，但实际业务可以是任何异步操作
        await new Promise(resolve => {
            // 这里模拟一个会阻塞事件循环的任务
            const checkInterval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                if (elapsed >= durationMs) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 50);
        });

        this.isBusy = false;
        console.log(`[任务 ${taskId}] 执行完成`);
        return taskId;
    }

    // 心跳函数 - 即使忙也要能响应
    async sendHeartbeat() {
        const heartbeatId = ++this.heartbeatCount;
        console.log(`[心跳 ${heartbeatId}] 发送于 ${new Date().toISOString()}, 当前忙状态: ${this.isBusy}`);
        
        // 模拟心跳处理（比如发送网络请求）
        await new Promise(resolve => setTimeout(resolve, 100));
        
        console.log(`[心跳 ${heartbeatId}] 完成处理`);
        return heartbeatId;
    }
}

// 研究不同的并发策略
class HeartbeatManager {
    constructor(worker) {
        this.worker = worker;
        this.strategies = {};
        this.results = [];
    }

    // 策略1: 使用 setInterval 定时检查（传统方式）
    strategySetInterval(intervalMs) {
        console.log('\n=== 策略1: setInterval 定时心跳 ===');
        let counter = 0;
        const timer = setInterval(async () => {
            counter++;
            console.log(`\n--- 定时器触发 #${counter} ---`);
            await this.worker.sendHeartbeat();
            
            // 限制测试次数
            if (counter >= 3) {
                clearInterval(timer);
                console.log('策略1 测试完成\n');
            }
        }, intervalMs);
        
        return timer;
    }

    // 策略2: 使用微任务和宏任务的优先级
    async strategyMicroMacro() {
        console.log('\n=== 策略2: 微任务/宏任务优先级 ===');
        
        // 模拟一个紧急的心跳请求
        const heartbeatPromise = new Promise(resolve => {
            // 使用 process.nextTick 让心跳优先执行
            process.nextTick(async () => {
                console.log('[微任务] 心跳请求被提升优先级');
                await this.worker.sendHeartbeat();
                resolve();
            });
        });

        // 同时执行一个耗时任务
        const taskPromise = this.worker.doBusyWork(1000apse);
        
        await Promise.all([heartbeatPromise, taskPromise]);
        console.log('策略2 测试完成\n');
    }

    // 策略3: 使用 WebWorker 或子进程（实际多线程）
    async strategyWorkerThread() {
        console.log('\n=== 策略3: 分离心跳到独立线程 ===');
        
        const { Worker } = require('worker_threads');
        
        // 创建一个工作线程专门处理心跳
        const heartbeatWorker = new Worker(`
            const { parentPort } = require('worker_threads');
            let count = 0;
            
            setInterval(() => {
                count++;
                parentPort.postMessage({ type: 'heartbeat', count, time: new Date().toISOString() });
            }, 100);
            
            // 接收主线程消息
            parentPort.on('message', (msg) => {
                if (msg.type === 'stop') {
                    process.exit(0);
                }
            });
        `, { eval: true });

        heartbeatWorker.on('message', (msg) => {
            console.log(`[工作线程] 收到心跳 #${msg.count} 于 ${msg.time}`);
        });

        // 在主线程执行繁忙任务
        console.log('[主线程] 开始执行繁忙任务...');
        await this.worker.doBusyWork(500);
        
        // 停止工作线程
        heartbeatWorker.postMessage({ type: 'stop' });
        console.log('策略3 测试完成\n');
    }

    // 分析结果
    analyzeResults() {
        console.log('\n========== 研究分析 ==========');
        console.log('1. setInterval 策略：');
        console.log('   - 优点：简单直接，适合低负载场景');
        console.log('   - 缺点：如果回调函数执行时间超过间隔，可能导致心跳堆积');
        
        console.log('\n2. 微任务/宏任务策略：');
        console.log('   - 优点：可以控制执行优先级');
        console.log('   - 缺点：仍然受限于单线程，CPU密集型任务仍会阻塞');
        
        console.log('\n3. 工作线程策略：');
        console.log('   - 优点：真正的并发执行，心跳完全不受主线程影响');
        console.log('   - 缺点：实现复杂，需要处理线程间通信');
        
        console.log('\n结论：');
        console.log('对于 Node.js 应用，最佳实践是：');
        console.log('- 将心跳等关键任务放在独立的工作线程或子进程中');
        console.log('- 使用微任务（process.nextTick）提升紧急任务的优先级');
        console.log('- 避免在主线程执行CPU密集型任务');
        console.log('- 使用事件循环监控（如 monitorEventLoopDelay）检测阻塞');
    }
}

// 主程序
async function main() {
    console.log('=== 研究：异步并发机制与心跳响应 ===\n');
    console.log('Node.js 事件循环特性：');
    console.log('- 单线程执行 JavaScript 代码');
    console.log('- 异步操作通过事件循环调度');
    console.log('- CPU 密集型任务会阻塞事件循环\n');

    const worker = new BusyWorker();
    const manager = new HeartbeatManager(worker);

    // 执行不同策略的测试
    try {
        // 策略1: 定时器方式
        manager.strategySetInterval(200);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 策略2: 微任务方式
        await manager.strategyMicroMacro();

        // 策略3: 工作线程方式
        await manager.strategyWorkerThread();

    } catch (error) {
        console.error('测试出错:', error);
    }

    // 分析结果
    manager.analyzeResults();
}

// 运行研究
main().catch(console.error);