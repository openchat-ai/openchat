// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:08:20.684Z

// nodejs 文件名: sisterCheck.js
// 引入需要的模块
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ port: 8080 });

// 存储所有连接的姐妹节点
const sisters = new Set();

// WebSocket 事件监听
wss.on('connection', (ws) => {
    // 输出连接信息
    console.log('有姐妹节点连接了');

    // 将新连接的姐妹节点加入集合
    sisters.add(ws);

    // 发送欢迎信息
    ws.send(JSON.stringify({
        type: 'welcome',
        message: '欢迎加入姐妹节点网络'
    }));

    // 监听消息事件
    ws.on('message', (message) => {
        // 处理消息
        const data = JSON.parse(message);
        console.log(`收到姐妹节点 ${data.id} 的消息: ${data.message}`);

        // 如果是心跳检测消息，则响应
        if (data.type === 'ping') {
            ws.send(JSON.stringify({
                type: 'pong',
                id: data.id,
                message: '收到心跳'
            }));
        }
    });

    // 监听关闭事件
    ws.on('close', () => {
        // 输出关闭信息
        console.log('姐妹节点已断开');

        // 从集合中移除该姐妹节点
        sisters.delete(ws);
    });

    // 监听错误事件
    ws.on('error', (error) => {
        console.error(`姐妹节点 ${ws.id} 发生错误: ${error}`);
    });
});

// 定期发送心跳检测消息给所有姐妹节点
const heartbeat = setInterval(() => {
    sisters.forEach((ws) => {
        ws.send(JSON.stringify({
            type: 'ping',
            id: uuidv4(),
            message: '心跳检测'
        }));
    });
}, 5000);

// 执行此脚本时，输出连接信息
if (require.main === module) {
    console.log('姐妹节点检测服务已启动');
}

// 定期发送心跳检测消息
setInterval(() => {
    console.log('正在发送心跳检测消息...');
}, 5000);