// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:51:02.926Z

// 引入必要的模块
const WebSocket = require('ws');

// 创建WebSocket服务器
const wss = new WebSocket.Server({ port: 8080 });

// 存储所有连接的WebSocket实例
const clients = new Set();

// 当有客户端连接时
wss.on('connection', (ws) => {
    console.log('有客户端连接');

    // 将新的WebSocket实例添加到客户端集合中
    clients.add(ws);

    // 当客户端发送消息时
    ws.on('message', (message) => {
        console.log('收到消息:', message);
        
        // 遍历所有客户端，除了发送消息的客户端
        clients.forEach((client) => {
            if (client !== ws) {
                // 发送消息给其他所有客户端
                client.send('姐妹状态检测消息');
            }
        });
    });

    // 当客户端关闭连接时
    ws.on('close', () => {
        console.log('客户端已断开连接');
        
        // 从客户端集合中移除该客户端
        clients.delete(ws);
    });

    // 处理错误
    ws.on('error', (error) => {
        console.error('WebSocket错误:', error);
    });
});

// 打印研究结果
console.log('姐妹状态检测方式研究结果:');
console.log('1. 使用WebSocket进行实时通讯，可以检测到姐妹状态。');
console.log('2. WebSocket允许多个客户端之间进行消息传递，从而实现状态的实时检测。');
console.log('3. 除了HTTP ping，WebSocket提供了一个更强大和实时的通讯方式。');