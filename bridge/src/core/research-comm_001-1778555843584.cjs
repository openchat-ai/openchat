// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:17:23.584Z

// 这段代码将探索Node.js环境中共享内存和进程间通信（IPC）的几种方式，
// 以检测和维护多个实例之间的状态同步。

const { fork } = require('child_process');
const { parentPort } = require('worker_threads');

// 创建一个子进程，用于模拟另一个实例
const child = fork('./child.js');

// 子进程的脚本（child.js）
process.on('message', (message) => {
  console.log(`子进程收到消息：${message}`);
  child.send(`子进程回复：${message}已被处理`);
});

// 主进程发送消息给子进程
child.send('主进程发送的消息');

// 监听子进程的退出事件
child.on('exit', (code) => {
  console.log(`子进程退出，码为 ${code}`);
});

// 主进程的脚本，用于模拟另一个实例
console.log('主进程启动');

// 模拟子进程发送的消息
setTimeout(() => {
  child.send('子进程发送的消息');
}, 1000);

// 监听父进程的消息
parentPort.on('message', (message) => {
  console.log(`父进程收到消息：${message}`);
});

// 主进程关闭
setTimeout(() => {
  child.kill(); // 关闭子进程
  console.log('主进程已关闭');
}, 5000);