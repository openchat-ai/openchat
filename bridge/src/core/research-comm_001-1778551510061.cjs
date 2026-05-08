// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T02:05:10.062Z

// 引入必要的模块
const net = require('net');

// 创建一个名为 'sisterProbe' 的事件发射器
const sisterProbe = require('events').EventEmitter;

// 假设我们有一个名为 'SisterInstance' 的类，用于表示姐妹进程
// 这里我们只是简单地定义一个类，实际使用时需要根据实际情况实现
class SisterInstance {
    constructor(name) {
        this.name = name;
        this.isAlive = false;
    }

    start() {
        // 这里模拟启动姐妹进程
        console.log(`启动 ${this.name} 进程...`);
        this.isAlive = true;
    }

    stop() {
        // 这里模拟停止姐妹进程
        console.log(`停止 ${this.name} 进程...`);
        this.isAlive = false;
    }

    isAliveInstance() {
        return this.isAlive;
    }
}

// 创建一个姐妹进程实例
const sisterInstance = new SisterInstance('sisterInstance');

// 创建一个事件监听器，用于处理姐妹进程的状态变化
sisterProbe.on('sisterStatus', (isAlive) => {
    console.log(`姐妹进程状态: ${isAlive ? '存活' : '已停止'}`);
});

// 检测姐妹进程状态的函数
function checkSisterStatus(instance, port = 8000) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();

        client.setTimeout(1000, () => {
            client.destroy();
            reject(new Error('超时，未检测到姐妹进程'));
        });

        client.connect(port, '127.0.0.1', () => {
            if (!client.destroyed) {
                client.write('PING');
                client.removeListener('error', reject);
                client.on('data', (data) => {
                    if (data.toString().toUpperCase().includes('PONG')) {
                        client.destroy();
                        resolve(instance.isAliveInstance());
                    } else {
                        client.destroy();
                        reject(new Error('响应错误，未检测到姐妹进程'));
                    }
                });
            }
        });

        client.on('error', reject);
    });
}

// 模拟启动姐妹进程
setTimeout(async () => {
    try {
        sisterInstance.start();
        console.log(`开始检测 ${sisterInstance.name} 进程状态...`);
        const status = await checkSisterStatus(sisterInstance);
        console.log(`检测结果: ${status ? '存活' : '已停止'}`);
    } catch (error) {
        console.error(error.message);
    } finally {
        sisterInstance.stop();
    }
}, 1000);

// 模拟停止姐妹进程
setTimeout(async () => {
    try {
        sisterInstance.stop();
        console.log(`开始检测 ${sisterInstance.name} 进程状态...`);
        const status = await checkSisterStatus(sisterInstance);
        console.log(`检测结果: ${status ? '存活' : '已停止'}`);
    } catch (error) {
        console.error(error.message);
    }
}, 5000);