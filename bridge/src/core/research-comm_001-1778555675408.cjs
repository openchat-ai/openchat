// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:14:35.408Z

// 引入需要的模块
const { fork } = require('child_process');
const EventEmitter = require('events');

// 创建一个事件发射器
const eventEmitter = new EventEmitter();

// 定义一个函数来检测姐妹状态
function detectSisterStatus() {
    // 通过 fork 创建一个新的 Node.js 进程
    const childProcess = fork('./child.js');

    // 监听 child.js 进程的 'message' 事件
    childProcess.on('message', (data) => {
        // 如果接收到的数据包含 'sisterStatus'
        if (data === 'sisterStatus') {
            // 通过事件发射器发送消息
            eventEmitter.emit('sisterStatusDetected', 'Sister status detected!');
        }
    });

    // 监听事件发射器的 'sisterStatusDetected' 事件
    eventEmitter.on('sisterStatusDetected', (message) => {
        // 输出检测到的信息
        console.log(message);
    });

    // 发送消息给 child.js 进程，请求检测姐妹状态
    childProcess.send('detectSisterStatus');
}

// 调用检测姐妹状态的函数
detectSisterStatus();

// child.js 进程的脚本
// 创建一个事件发射器
const eventEmitter = new EventEmitter();

// 监听 'message' 事件
process.on('message', (data) => {
    // 如果接收到的是 'detectSisterStatus' 消息
    if (data === 'detectSisterStatus') {
        // 模拟检测姐妹状态的操作
        setTimeout(() => {
            // 发送 'sisterStatus' 消息给主进程
            process.send('sisterStatus');
        }, 1000);
    }
});

// 注意：在实际应用中，需要更复杂的逻辑来模拟检测姐妹状态
// 例如，可以使用网络通信、数据库查询等方式来检测姐妹状态
// 本示例仅用于演示实例间通讯方式