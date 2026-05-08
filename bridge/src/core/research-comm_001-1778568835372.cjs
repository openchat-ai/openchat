// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:53:55.372Z

// 引入net模块，用于创建本地套接字
const net = require('net');

// 创建一个服务器类实例，用于监听本地端口
class Server {
    constructor(port) {
        this.port = port;
        this.server = null;
    }

    // 开始监听本地端口
    start() {
        this.server = net.createServer((socket) => {
            // 当有连接到来时，打印连接信息
            console.log(`连接到来: ${socket.remoteAddress}:${socket.remotePort}`);

            // 监听数据事件，打印接收到的数据
            socket.on('data', (data) => {
                console.log(`接收到数据: ${data}`);
                // 向客户端发送一个回复
                socket.write(`收到的数据是: ${data}`);
            });

            // 监听结束事件，打印断开连接的信息
            socket.on('end', () => {
                console.log(`连接结束: ${socket.remoteAddress}:${socket.remotePort}`);
            });
        });

        // 监听错误事件，打印错误信息
        this.server.on('error', (err) => {
            console.log(`错误: ${err.message}`);
        });

        // 监听服务器关闭事件，打印关闭信息
        this.server.on('close', () => {
            console.log('服务器关闭');
        });

        // 监听服务器关闭事件，然后关闭服务器
        this.server.on('listening', () => {
            console.log(`服务器正在监听端口: ${this.port}`);
        });

        // 开始监听本地端口
        this.server.listen(this.port);
    }
}

// 创建一个客户端类实例，用于连接服务器
class Client {
    constructor(port, host = 'localhost') {
        this.port = port;
        this.host = host;
        this.socket = null;
    }

    // 连接到服务器
    connect() {
        // 创建一个套接字，连接到服务器
        this.socket = new net.Socket({
            host: this.host,
            port: this.port
        });

        // 监听数据事件，打印接收到的数据
        this.socket.on('data', (data) => {
            console.log(`接收到的数据: ${data}`);
        });

        // 监听错误事件，打印错误信息
        this.socket.on('error', (err) => {
            console.log(`错误: ${err.message}`);
        });

        // 监听连接事件，打印连接信息
        this.socket.on('connect', () => {
            console.log(`连接到: ${this.host}:${this.port}`);
            // 向服务器发送一个数据
            this.socket.write('我是客户端');
        });

        // 监听结束事件，打印断开连接的信息
        this.socket.on('end', () => {
            console.log('连接结束');
        });

        // 连接到服务器
        this.socket.connect(this.port, this.host);
    }
}

// 创建一个服务器实例，监听本地端口8000
const server = new Server(8000);
server.start();

// 创建一个客户端实例，连接到本地服务器
const client = new Client(8000);
client.connect();