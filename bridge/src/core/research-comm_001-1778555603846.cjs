// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:13:23.846Z

// 研究代码：探索实例间通讯的多种方式
// 除了HTTP PING，会尝试使用MQTT或WebSocket等方式

const http = require('http');
const WebSocket = require('ws');

// 创建简单的WebSocket服务器，用于模拟状态通讯
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', function connection(ws) {
    console.log('新连接已建立');

    // 模拟发送消息给所有连接的实例
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send('状态更新：通过WebSocket通讯');
        }
    });
});

console.log('WebSocket服务器已启动，监听8080端口...');

// 示意客户端可以通过WebSocket连接获取状态更新
// 可通过'ws://localhost:8080'连接并监听消息

// 基础案例：使用HTTP Ping进行状态检测
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('HTTP Ping检测成功');
});

server.listen(3000, () => {
    console.log('HTTP服务器已启动，监听端口3000');
});