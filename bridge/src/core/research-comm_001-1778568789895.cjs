// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:53:09.895Z

// 实例间通讯方式研究 - 除了HTTP ping，探索其他方法
// 示例：使用 WebSocket 实现实时通讯

const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
    console.log('新连接已建立');

    // 模拟从一个实例通讯到另一个实例
    ws.on('message', (message) => {
        console.log('收到消息:', message);
        
        // 假设我们从另一个实例接收数据
        const otherSocket = wss.clients.find(client => client.readyState === WebSocket.OPEN);
        if (otherSocket) {
            otherSocket.send(`来自其他实例的消息: ${message}`);
        }
    });

    ws.on('close', () => {
        console.log('连接关闭');
    });
});

console.log('服务器已启动，监听 WebSocket 连接...');