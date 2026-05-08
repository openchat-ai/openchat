// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:36:41.311Z

const net = require('net');

// 创建一个TCP服务器
const server = net.createServer((socket) => {
    console.log('新的连接');
    socket.on('data', (data) => {
        console.log('收到数据:', data.toString());
        socket.write('响应数据');
    });
    socket.on('end', () => {
        console.log('连接关闭');
    });
    socket.on('error', (err) => {
        console.error('连接错误:', err);
    });
});

// 监听端口
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`TCP服务器正在监听端口 ${PORT}`);
});

// 创建一个客户端
const client = new net.Socket();
client.connect(PORT, '127.0.0.1', () => {
    console.log('客户端已连接');
    client.write('测试消息');
});

client.on('data', (data) => {
    console.log('从服务器收到:', data.toString());
    client.destroy(); // 关闭连接
});

client.on('end', () => {
    console.log('客户端连接已关闭');
});