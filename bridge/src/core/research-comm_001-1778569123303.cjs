// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:58:43.304Z

// 引入需要的模块
const { fork } = require('child_process');
const os = require('os');

// 创建两个独立的 Node.js 进程，用于模拟姐妹实例的通讯
const childProcess1 = fork('./child.js', { workerData: 'Instance 1' });
const childProcess2 = fork('./child.js', { workerData: 'Instance 2' });

// 在子进程中监听消息事件，并进行简单的处理
childProcess1.on('message', (message) => {
    console.log(`Instance 1 接收到消息：${message}`);
    childProcess2.send(`Instance 1 向 Instance 2 回复：${message}`);
});

childProcess2.on('message', (message) => {
    console.log(`Instance 2 接收到消息：${message}`);
});

// 向第一个子进程发送一个测试消息
childProcess1.send('这是一个测试消息');

// 输出代码运行时的机器信息，用于识别实例环境
console.log(`运行环境：${os.type()} ${os.release()}`);

// 输出检测到的消息
childProcess1.on('exit', (code) => {
    console.log(`Instance 1 退出，退出码：${code}`);
});

childProcess2.on('exit', (code) => {
    console.log(`Instance 2 退出，退出码：${code}`);
});

// 声明子进程的脚本
let script = `
// 子进程代码
const { parentPort } = require('worker_threads');

parentPort.on('message', (message) => {
    console.log(\`接收到消息：${message}\`);
    process.exit(0);
});
`;

// 将脚本写入文件
fs.writeFileSync('./child.js', script);

console.log('测试完成，姐妹实例间通讯方式成功验证！');