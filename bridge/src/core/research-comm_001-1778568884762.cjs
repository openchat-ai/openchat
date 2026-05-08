// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:54:44.762Z

// 引入必要的模块
const EventEmitter = require('events');
const net = require('net');

// 创建一个EventEmitter的实例，用于实现实例间的通讯
const instanceCommunicator = new EventEmitter();

// 用于检测网络连接状态的超时设置
const timeout = 1000; // 1秒超时

// 实例间通讯的函数，尝试使用多种方式进行检测
async function detectInstanceStatus() {
    console.log("开始检测姐妹状态...");

    // 1. 使用HTTP ping检测
    const http = require('http');
    const httpRequest = new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost', // 替换为你想要检测的实例地址
            port: 8080, // 替换为你想要检测的实例端口
            path: '/',
            method: 'GET'
        };

        const req = http.request(options, res => {
            res.setEncoding('utf8');
            let responseBody = '';
            res.on('data', chunk => responseBody += chunk);
            res.on('end', () => {
                console.log(`HTTP ping响应: ${responseBody}`);
                resolve(responseBody);
            });
        });

        req.on('error', reject);
        req.end();
    });

    // 2. 使用TCP检测
    const tcpRequest = new Promise((resolve, reject) => {
        const client = new net.Socket();
        client.setTimeout(timeout, () => { client.destroy(); });
        client.connect(8081, 'localhost', () => { // 替换为你想要检测的实例地址和端口
            client.end(() => {
                client.destroy();
                const status = client._socket._hasError ? '连接失败' : '连接成功';
                console.log(`TCP检测: ${status}`);
                resolve(status);
            });
        });
    });

    // 3. 使用WebSocket检测
    const WebSocket = require('ws');
    const wsRequest = new Promise((resolve, reject) => {
        const socket = new WebSocket('ws://localhost:8082'); // 替换为你想要检测的实例地址和端口
        socket.onopen = () => {
            console.log('WebSocket连接已打开');
            socket.close();
            resolve('WebSocket连接已关闭');
        };
        socket.onerror = err => {
            console.error('WebSocket错误:', err);
            reject(err);
        };
        socket.onclose = () => {
            console.log('WebSocket连接已关闭');
            resolve('WebSocket连接已关闭');
        };
    });

    // 同时执行HTTP、TCP和WebSocket检测，并等待所有请求完成后输出结果
    const results = await Promise.all([
        httpRequest,
        tcpRequest,
        wsRequest
    ]);

    console.log("姐妹状态检测完成，结果如下:");
    results.forEach((result, index) => {
        console.log(`方式${index + 1}: ${result}`);
    });
}

// 执行检测
detectInstanceStatus().catch(error => console.error("检测过程中出现错误:", error));