// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:18:14.675Z

// 引入必要的库
const { fork } = require('child_process');
const net = require('net');

// 创建一个父子进程来模拟实例间通讯
function testIPC() {
    const child = fork('./ipcWorker.js');

    // 监听子进程的message事件
    child.on('message', (msg) => {
        console.log(`子进程回复: ${msg}`);
    });

    // 发送测试消息给子进程
    child.send('ping');
}

// 模拟网络通讯测试
function testNetworkCommunication() {
    const server = net.createServer((socket) => {
        console.log('客户端已连接');

        // 接收数据
        socket.on('data', (data) => {
            console.log(`接收到数据: ${data.toString()}`);
            socket.destroy(); // 关闭连接
        });

        // 监听错误
        socket.on('error', (err) => {
            console.error(`发生错误: ${err.message}`);
            socket.destroy(); // 关闭连接
        });

        // 监听结束
        socket.on('end', () => {
            console.log('客户端已断开连接');
        });
    });

    // 监听服务器错误
    server.on('error', (err) => {
        console.error(`服务器发生错误: ${err.message}`);
    });

    // 监听服务器结束
    server.on('close', () => {
        console.log('服务器已关闭');
    });

    // 监听服务器关闭错误
    server.on('listening', () => {
        console.log('服务器已启动');
    });

    // 绑定端口
    server.listen(3000, '127.0.0.1', () => {
        console.log('服务器已启动在端口 3000');
    });

    // 测试客户端连接
    const client = net.createConnection(3000, '127.0.0.1');
    client.setTimeout(1000, () => {
        console.log('客户端超时');
        client.destroy();
    });

    client.on('connect', () => {
        console.log('客户端已连接');
    });

    client.on('error', (err) => {
        console.error(`客户端发生错误: ${err.message}`);
        client.destroy();
    });

    client.on('end', () => {
        console.log('客户端已断开连接');
    });
}

// ipcWorker.js 文件内容（需要与主文件在同一目录下）
// 这个文件将作为子进程运行，用于测试进程间通讯
process.on('message', (msg) => {
    if (msg === 'ping') {
        process.send('pong');
        console.log('子进程已响应');
    }
});

// 忽略未捕获的异常
process.on('uncaughtException', (err) => {
    console.error(`未捕获的异常: ${err.message}`);
});

// 调用测试函数
testIPC(); // 测试进程间通讯
setTimeout(testNetworkCommunication, 1000); // 延迟测试网络通讯