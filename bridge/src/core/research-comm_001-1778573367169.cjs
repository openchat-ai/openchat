// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:09:27.169Z

// 引入需要的模块
const net = require('net');
const EventEmitter = require('events');

// 定义一个EventEmitter的子类，用于处理与另一个实例的通讯
class InstanceCommunicator extends EventEmitter {
    constructor(port, host = 'localhost') {
        super();
        this.options = { port, host };
        this.socket = null;
    }

    connect() {
        this.socket = new net.Socket();
        this.socket.connect(this.options.port, this.options.host, () => {
            console.log(`连接到实例成功：${this.options.host}:${this.options.port}`);
            this.socket.setNoDelay(true);
            this.socket.setKeepAlive(true, 1000 * 60); // 设置心跳
        });

        this.socket.on('error', (err) => {
            console.error(`连接到实例失败：${this.options.host}:${this.options.port}，错误：${err.message}`);
        });

        this.socket.on('end', () => {
            console.log(`与实例的连接已断开：${this.options.host}:${this.options.port}`);
        });
    }

    send(data) {
        if (!this.socket || !this.socket.writable) {
            console.error(`无法向实例发送数据到：${this.options.host}:${this.options.port}`);
            return;
        }
        this.socket.write(data, 'utf-8');
    }

    close() {
        if (this.socket) {
            this.socket.end();
            this.socket = null;
            console.log(`与实例的连接已关闭：${this.options.host}:${this.options.port}`);
        }
    }
}

// 创建两个实例通讯对象
const communicator1 = new InstanceCommunicator(3000);
const communicator2 = new InstanceCommunicator(3001);

// 启动实例通讯对象
communicator1.connect();
communicator2.connect();

// 模拟实例间通讯
setTimeout(() => {
    communicator1.send('Instance 1 is alive!');
    console.log('Instance 1 向 Instance 2 发送消息...');
}, 1000);

setTimeout(() => {
    communicator2.send('Instance 2 received message from Instance 1!');
    console.log('Instance 2 向 Instance 1 发送回消息...');
}, 2000);

// 假设实例间通讯成功，监听消息
communicator1.on('data', (data) => {
    console.log(`Instance 1 接收到的消息：${data}`);
});

communicator2.on('data', (data) => {
    console.log(`Instance 2 接收到的消息：${data}`);
});

// 假设实例通讯成功，实例1断开连接
setTimeout(() => {
    console.log('Instance 1 正在关闭连接...');
    communicator1.close();
}, 3000);

// 假设实例通讯成功，实例2断开连接
setTimeout(() => {
    console.log('Instance 2 正在关闭连接...');
    communicator2.close();
}, 4000);