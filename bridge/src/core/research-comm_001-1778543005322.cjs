// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:43:25.322Z

// 引入需要的模块
const { fork } = require('child_process');
const { exec } = require('child_process');

// 创建一个主进程，用于管理子进程
const master = fork('./child.js');

// 主进程启动后，打印信息
console.log('主进程启动，开始创建子进程');

// 创建3个子进程，用于模拟实例间通讯
for (let i = 0; i < 3; i++) {
    // 创建子进程，并将i作为参数传递给子进程
    const child = fork('./child.js', [i]);
    console.log(`子进程${i}启动`);

    // 监听子进程的标准输出
    child.on('message', (msg) => {
        console.log(`子进程${msg.pid}发送消息：${msg}`);
    });

    // 监听子进程的错误
    child.on('error', (err) => {
        console.error(`子进程${msg.pid}发生错误：${err}`);
    });

    // 监听子进程的退出
    child.on('exit', (code) => {
        console.log(`子进程${msg.pid}退出，代码：${code}`);
    });
}

// 子进程.js
const { parentPort } = require('worker_threads');

// 模拟工作，让子进程在1秒后发送消息
setTimeout(() => {
    parentPort.postMessage(`子进程${process.pid}发送消息：Hello, Master!`);
}, 1000);

// 模拟错误，让子进程在2秒后发送错误消息
setTimeout(() => {
    parentPort.emit('error', new Error('子进程发生错误'));
}, 2000);

// 模拟完成工作，让子进程在3秒后发送完成消息
setTimeout(() => {
    parentPort.postMessage(`子进程${process.pid}工作完成`);
}, 3000);