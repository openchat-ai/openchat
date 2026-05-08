// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:40:48.324Z

// 引入需要的模块
const WebSocket = require('ws');

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ port: 8080 });

// 连接事件
wss.on('connection', function connection(ws) {
    console.log('New client connected');
    
    // 接收消息事件
    ws.on('message', function incoming(message) {
        console.log('received: %s', message);

        // 发送状态信息给客户端
        ws.send('Sister status: Online');

        // 检测其他实例的连接状态
        if (wss.clients.size > 1) {
            console.log('Other sister instances are online.');
        } else {
            console.log('No other sister instances are online.');
        }
    });

    // 关闭事件
    ws.on('close', function close() {
        console.log('Client disconnected');
    });

    // 错误事件
    ws.on('error', function error(err) {
        console.log('WebSocket error: ' + err.message);
    });
});

console.log('WebSocket server is running on port 8080');