// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:24:24.873Z

// 引入必要的Node.js模块
const net = require('net');

// 设置服务器监听的端口号
const PORT = 9000;

// 创建服务器实例
const server = net.createServer((socket) => {
    // 接收到客户端连接时执行的回调函数
    console.log('客户端连接成功！');
    
    // 与客户端进行简单通信，发送消息到客户端
    socket.write('姐妹状态检测中...');

    // 监听客户端消息事件
    socket.on('data', (data) => {
        console.log('接收到客户端消息：', data.toString());
    });

    // 监听客户端关闭连接事件
    socket.on('end', () => {
        console.log('客户端断开连接！');
    });
});

// 监听服务器端口
server.listen(PORT, () => {
    console.log(`服务器正在监听端口 ${PORT}...`);
});

// 简单的客户端测试代码
const client = net.connect(PORT, 'localhost', () => {
    console.log('客户端连接到服务器');
    // 发送消息到服务器
    client.write('我是姐妹1，状态正常！');
});

// 监听客户端关闭连接事件
client.on('end', () => {
    console.log('客户端断开连接');
});

// 演示如何再次连接服务器发送消息
setTimeout(() => {
    const client2 = net.connect(PORT, 'localhost', () => {
        console.log('客户端2连接到服务器');
        // 发送消息到服务器
        client2.write('我是姐妹2，状态正常！');
    });

    // 监听客户端关闭连接事件
    client2.on('end', () => {
        console.log('客户端2断开连接');
    });
}, 5000); // 5秒后再次连接

// 输出研究结果
console.log('研究结果：通过Node.js的net模块，我们实现了姐妹进程间的通讯。除了HTTP ping，还可以使用TCP协议进行实时状态检测。客户端和服务器通过socket对象进行数据的发送和接收，从而实现状态信息的交互。');