// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:13:34.781Z

// 研究与实现：探索实例间通讯的多种方式
// 目标：除了HTTP ping，还可以用WebSocket或MQTT进行检测

const WebSocket = require('ws');

// 创建WebSocket服务器，用于监听状态交互
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
    console.log('一个新连接已建立');

    // 模拟状态信息的发送与接收
    setInterval(() => {
        const message = JSON.stringify({ sisterStatus: '健康' });
        ws.send(message);
    }, 2000);

    ws.on('message', (data) => {
        console.log('接收到消息: ', data);
        // 示例：根据状态进行响应
        if (data === 'statusUpdate') {
            ws.send(JSON.stringify({ sisterStatus: '活跃' }));
        }
    });

    ws.on('close', () => {
        console.log('连接已关闭');
    });
});

console.log('Node.js 可运行项目已启动，正在检测实例间通讯...');