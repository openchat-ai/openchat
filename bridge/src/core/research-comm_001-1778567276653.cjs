// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:27:56.653Z

// 引入需要的模块
const net = require('net');
const { promisify } = require('util');

// 设置通信参数
const serverPort = 8080;
const serverAddress = '127.0.0.1'; // 当前机器的IP地址
const clientPort = 8081;
const clientAddress = '127.0.0.1'; // 当前机器的IP地址
const serverSocket = net.createServer();

// 服务器端的钩子函数
serverSocket.on('connection', (socket) => {
    console.log('服务器收到连接');
    socket.setTimeout(30000);
    socket.setNoDelay(true);
    socket.on('data', (data) => {
        console.log(`服务器收到数据: ${data}`);
        socket.write(`收到数据: ${data}`);
    });
    socket.on('end', () => {
        console.log('服务器连接结束');
    });
});

// 客户端的钩子函数
const clientSocket = net.createConnection({ port: clientPort, host: clientAddress }, () => {
    console.log('客户端连接成功');
    clientSocket.setTimeout(30000);
    clientSocket.setNoDelay(true);
    clientSocket.on('data', (data) => {
        console.log(`客户端收到数据: ${data}`);
    });
    clientSocket.on('error', (err) => {
        console.log('客户端连接错误:', err);
        clientSocket.end();
    });
    clientSocket.on('end', () => {
        console.log('客户端连接结束');
    });
});

// 检测连接
async function checkConnection() {
    try {
        // 服务器端检测
        serverSocket.listen(serverPort, () => {
            console.log(`服务器监听成功: ${serverAddress}:${serverPort}`);
        });
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 等待2秒
        serverSocket.destroy(); // 关闭服务器监听

        // 客户端检测
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 等待2秒
        clientSocket.connect(clientPort, clientAddress, () => {
            console.log(`客户端连接成功: ${clientAddress}:${clientPort}`);
        });
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 等待2秒
        clientSocket.destroy(); // 关闭客户端连接
    } catch (err) {
        console.error('连接检测失败:', err);
    }
}

// 执行检测
checkConnection();

// 打印研究结果
console.log('研究结果:');
console.log('1. 服务器监听: 使用 net.createServer() 监听指定端口');
console.log('2. 客户端连接: 使用 net.createConnection() 连接到指定地址和端口');
console.log('3. 通讯机制: 使用 TCP 协议进行数据传输');
console.log('4. 状态检测: 通过监听连接和数据流事件来检测状态');
console.log('5. 错误处理: 使用 error 事件处理连接错误');