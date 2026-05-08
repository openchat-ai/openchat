// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:57:44.331Z

// 实例间通讯方式研究：检测姐妹状态的非 HTTP ping 方式

// 引入必要的 Node.js 模块
const net = require('net');
const childProcess = require('child_process');

// 创建一个简单的 TCP 服务器，用于接收和响应信号
const server = net.createServer((socket) => {
    console.log('收到连接');

    // 处理客户端发送的数据
    socket.on('data', (data) => {
        console.log(`接收到数据：${data}`);
        socket.end('已收到信号');
    });

    // 处理连接关闭事件
    socket.on('close', () => {
        console.log('连接已关闭');
    });
});

// 绑定服务器监听
server.listen(3000, () => {
    console.log('TCP 服务器启动在端口 3000');
});

// 创建子进程作为实例，用于向服务器发送信号
const child = childProcess.fork('./instance.js');

// 在 5 秒后向服务器发送信号
setTimeout(() => {
    const client = net.connect(3000);
    client.write('发送信号\n');
    client.end();
    console.log('已向服务器发送信号');
}, 5000);

// 实例.js 文件内容（与主文件在同一目录下）
// 这个文件将作为姐妹实例，向 TCP 服务器发送信号
console.log('实例启动，开始检测状态');

const client = net.connect(3000);
client.on('ready', () => {
    console.log('已连接到服务器');
    client.write('检测状态\n');
});

client.on('end', () => {
    console.log('信号已发送，等待服务器响应');
});

client.on('close', () => {
    console.log('连接已关闭，实例停止');
});