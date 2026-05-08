// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:37:39.560Z

// 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？

// 导入必要的模块
const WebSocket = require('ws');

// 创建WebSocket服务器
const wss = new WebSocket.Server({ port: 8080 });

console.log('WebSocket服务器已启动，端口：8080');

// 连接处理函数
wss.on('connection', function connection(ws) {
    console.log('有新客户端连接');

    // 接收消息函数
    const receiveMessage = function(data) {
        console.log(`接收到消息：${data}`);
        // 可以在这里处理消息，例如转发给其他客户端
    };

    // 发送消息函数
    const sendMessage = function(message) {
        ws.send(message);
    };

    // 为客户端设置监听器，接收来自服务器的消息
    ws.on('message', receiveMessage);

    // 为客户端设置心跳检测，每5秒发送一次心跳
    const interval = setInterval(() => {
        ws.send(JSON.stringify({ type: 'ping' }));
    }, 5000);

    // 客户端断开连接时
    ws.on('close', () => {
        clearInterval(interval);
        console.log('客户端已断开连接');
    });

    // 客户端错误处理
    ws.on('error', (error) => {
        console.error(`客户端错误：${error}`);
    });
});

console.log('WebSocket服务器准备就绪，可以开始检测姐妹状态了！');