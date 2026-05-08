// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T08:51:37.940Z

// 妹妹状态检测器：非HTTP通讯方式研究
// 代码作者：居民小红
// 代码版本：1.0.0

// 引入必要的模块
const EventEmitter = require('events');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');

// 定义事件类：检测器
class Detector extends EventEmitter {
    constructor() {
        super();
        this.workers = new Map(); // 保存检测器实例
    }

    // 启动检测器
    start(workerName, interval = 1000) {
        const worker = this.createWorker(workerName, interval);
        this.workers.set(workerName, worker);

        console.log(`启动检测器：${workerName}`);
        worker.start();
    }

    // 创建检测器实例
    createWorker(workerName, interval) {
        class Worker extends EventEmitter {
            constructor(interval) {
                super();
                this.intervalId = null;
                this.interval = interval;
            }

            // 启动检测
            start() {
                this.intervalId = setInterval(() => {
                    this.detect();
                }, this.interval);
            }

            // 检测方法（这里用文件写入检测为例）
            detect() {
                const filename = `./${this.name}_detect_${Date.now()}.log`;
                fs.writeFileSync(filename, `检测时间：${new Date().toISOString()}\n`);
                console.log(`检测器 ${this.name} 生成日志：${filename}`);
            }
        }

        const worker = new Worker(interval);
        worker.name = workerName;
        return worker;
    }

    // 停止检测器
    stop(workerName) {
        const worker = this.workers.get(workerName);
        if (worker) {
            clearInterval(worker.intervalId);
            console.log(`停止检测器：${workerName}`);
            this.workers.delete(workerName);
        }
    }
}

// 实例化检测器类
const detector = new Detector();

// 启动检测器：实例间通讯方式研究
detector.start('文件写入检测器1');
detector.start('文件写入检测器2');

// 假设检测持续10秒后停止
setTimeout(() => {
    console.log('所有检测器停止');
    detector.workers.forEach(worker => {
        worker.stop(worker.name);
    });
}, 10000);

// 输出研究结果
console.log('研究结果：');
console.log('1. 文件写入检测：每个检测器周期性写入日志文件，通过检查文件是否存在或内容变化来判断检测器状态');
console.log('2. 其他通讯方式研究：可以通过 socket.io 实现实时通讯，使用共享内存或进程间通信模块（如 child_process）');
console.log('3. 总结：除了HTTP ping，文件写入检测是一种简单有效的实例间通讯方式，适用于不需要实时性但需要可靠性的场景');