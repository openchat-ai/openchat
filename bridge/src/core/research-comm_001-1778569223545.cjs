// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:00:23.545Z

// 引入必要的Node.js核心模块
const net = require('net');

// 创建一个名为'myServer'的服务器实例
const myServer = net.createServer((socket) => {
    console.log('一个新客户端连接到服务器');
    
    // 发送连接信息到客户端
    socket.write('你已连接到服务器！');
    
    // 监听客户端消息
    socket.on('data', (data) => {
        console.log(`接收到客户端发送的信息: ${data.toString()}`);
        
        // 如果接收到的是一条ping消息，回复客户端
        if(data.toString() === 'ping') {
            socket.write('pong');
        }
    });
    
    // 监听客户端断开连接
    socket.on('end', () => {
        console.log('客户端已断开连接');
    });
});

// 监听服务器端口
myServer.listen(3000, () => {
    console.log('服务器正在运行，监听端口3000...');
});

// 定义一个函数，用于尝试与服务器建立连接并发送ping请求
function testConnection() {
    const client = net.connect(3000, '127.0.0.1', () => {
        console.log('客户端尝试连接服务器...');
        
        // 发送ping消息到服务器
        client.write('ping');
        
        // 监听服务器回复
        client.on('data', (data) => {
            console.log(`服务器回复: ${data.toString()}`);
            
            // 关闭客户端连接
            client.destroy();
        });
        
        // 监听客户端错误
        client.on('error', (err) => {
            console.error(`客户端连接错误: ${err}`);
            client.destroy();
        });
        
        // 监听客户端断开
        client.on('close', () => {
            console.log('客户端已断开连接');
        });
    });
}

// 定期测试连接
setInterval(testConnection, 5000);

// 如果运行此脚本，则启动服务器
if(require.main === module) {
    myServer.listen(3000, () => {
        console.log('服务器启动成功，已监听端口3000');
    });
}