// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:20:22.697Z

// 引入需要的模块
const { createServer } = require('http');
const { v4: uuidv4 } = require('uuid');

// 创建一个服务器
const server = createServer();

// 用于存储实例状态的字典
const instances = {};

// 随机生成一个UUID作为实例ID
const instanceId = uuidv4();

// 服务器监听请求
server.on('request', (req, res) => {
    // 如果请求是HTTP ping，则输出实例状态作为响应
    if (req.method === 'GET' && req.url === '/ping') {
        console.log(`实例 ${instanceId} 已经在线`);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('PONG');
    }

    // 如果请求是其他类型，则提示不支持
    else {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
    }
});

// 开始监听请求
server.listen(3000, () => {
    console.log(`实例 ${instanceId} 启动成功，监听在端口 3000`);
    
    // 模拟其他实例检测当前实例状态
    setTimeout(() => {
        console.log(`实例 ${instanceId} 正在被其他实例检测状态...`);
        const otherId = uuidv4();
        
        // 检测状态逻辑：向其他实例发送HTTP请求
        fetch(`http://localhost:3000/ping`, { method: 'GET' })
            .then(response => response.text())
            .then(data => {
                console.log(`实例 ${otherId} 检测到实例 ${instanceId} 状态正常`);
                // 其他处理逻辑
            })
            .catch(error => {
                console.log(`实例 ${otherId} 无法检测到实例 ${instanceId} 状态`);
                // 其他处理逻辑
            });
    }, 5000);
});