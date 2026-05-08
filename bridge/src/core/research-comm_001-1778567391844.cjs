// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:29:51.844Z

const axios = require('axios');
const WebSocket = require('ws');

// 使用Redis作为实例间通讯的中间件
const redis = require('redis');
const client = redis.createClient();

// 创建WebSocket服务器
const wss = new WebSocket.Server({ port: 8081 });

// 使用HTTP ping进行状态检测
const httpPing = async () => {
    try {
        const response = await axios.get('http://localhost:8080/ping');
        console.log('HTTP ping:', response.data);
    } catch (error) {
        console.log('HTTP ping error:', error.message);
    }
};

// 使用WebSocket进行状态检测
const wsCheckStatus = (ws) => {
    ws.on('message', (message) => {
        console.log('WebSocket message:', message);
        if (message === 'ping') {
            ws.send('pong');
        }
    });
};

// 使用Redis进行状态检测
const redisCheckStatus = async () => {
    try {
        const status = await client.get('instance_status');
        console.log('Redis status:', status);
    } catch (error) {
        console.log('Redis check error:', error.message);
    }
};

// 端口监听
const server = require('http').createServer(httpPing);
server.listen(8080, () => console.log('HTTP server running on port 8080'));

wss.on('connection', ws => {
    wsCheckStatus(ws);
});

// 检测所有通讯方式
setInterval(() => {
    httpPing();
    redisCheckStatus();
    wss.clients.forEach(client => {
        client.ping('ping');
    });
}, 5000);

// Redis设置实例状态
client.set('instance_status', 'running');