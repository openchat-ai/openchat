// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:41:31.347Z

// 引入必要的node.js模块
const net = require('net');

// 设置目标节点的IP地址和端口号
const targetIp = '127.0.0.1';
const targetPort = 8080;

// 创建客户端实例
const client = new net.Socket();

// 连接目标节点
client.connect(targetPort, targetIp, () => {
    console.log(`已连接到 ${targetIp}:${targetPort}`);
    
    // 发送检测信息
    client.write('PING');

    // 记录开始时间
    const startTime = new Date().getTime();

    // 监听服务器响应
    client.on('data', (data) => {
        // 输出接收到的数据
        console.log(`接收到的数据: ${data}`);
        
        // 计算响应时间
        const endTime = new Date().getTime();
        const responseTime = endTime - startTime;
        
        // 输出响应时间
        console.log(`响应时间: ${responseTime}ms`);

        // 关闭客户端连接
        client.destroy();
    });

    // 监听错误事件
    client.on('error', (err) => {
        console.error('发生错误:', err);
        client.destroy();
    });
});

// 监听客户端关闭事件
client.on('close', () => {
    console.log('客户端已关闭');
});