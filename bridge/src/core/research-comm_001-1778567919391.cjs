// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:38:39.392Z

// 引入需要的模块
const WebSocket = require('ws');
const http = require('http');
const cluster = require('cluster');
const os = require('os');

// 创建HTTP服务器
const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end(`Hello from Node.js server ${process.pid}\n`);
});

// 监听端口
const PORT = 8080;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// 创建WebSocket服务器
const wss = new WebSocket.Server({ server });

// WebSocket连接处理
wss.on('connection', (ws) => {
    console.log('WebSocket connection established');

    // 发送心跳消息
    ws.send(JSON.stringify({ type: 'ping', data: 'Hello from WebSocket' }));

    // 监听客户端消息
    ws.on('message', (message) => {
        console.log(`Received message from WebSocket: ${message}`);
        // 回复客户端
        ws.send(JSON.stringify({ type: 'pong', data: 'Hello from WebSocket' }));
    });
});

// 检测服务器是否在线
const detectServer = () => {
    const options = {
        hostname: 'localhost',
        port: PORT,
        path: '/',
        method: 'GET'
    };

    const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            console.log(`Server ${data.trim()} is online`);
        });
    });

    req.on('error', (e) => {
        console.log(`Error: ${e.message}`);
    });

    req.end();
};

// 检测WebSocket连接
const detectWs = () => {
    const ws = new WebSocket('ws://localhost:8080');
    ws.on('open', () => {
        console.log('WebSocket connection established');
        ws.send(JSON.stringify({ type: 'ping', data: 'Hello from WebSocket' }));
    });

    ws.on('message', (message) => {
        console.log(`Received message from WebSocket: ${message}`);
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
    });

    ws.on('error', (error) => {
        console.log(`WebSocket error: ${error.message}`);
    });
};

// 检测集群模式下是否在线
if (cluster.isMaster) {
    console.log('Master Node.js is running');

    // 创建工作进程
    for (let i = 0; i < os.cpus().length; i++) {
        cluster.fork();
    }

    // 监听子进程退出
    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died`);
        // 重新启动退出的进程
        cluster.fork();
    });

    // 检测集群模式下的服务器是否在线
    setTimeout(detectServer, 5000);
    setTimeout(detectWs, 5000);
} else {
    // 子进程
    console.log(`Worker ${process.pid} is running`);
    // 检测集群模式下的服务器是否在线
    setTimeout(detectServer, 5000);
    setTimeout(detectWs, 5000);
}