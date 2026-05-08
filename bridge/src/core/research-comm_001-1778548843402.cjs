// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:20:43.402Z

// 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
const net = require('net');
const dgram = require('dgram');
const EventEmitter = require('events');

console.log('=== 实例间通讯方式研究 ===\n');

// 1. TCP Socket 连接方式
function tcpSocketExample() {
    console.log('1. TCP Socket 连接方式：');
    console.log('   - 姐妹实例通过TCP建立持久连接');
    console.log('   - 发送心跳包或状态消息');
    console.log('   - 连接断开即表示对方不可用');
    console.log('   - 优点：可靠、有序、实时');
    console.log('   - 缺点：需要维护连接池\n');
}

// 2. UDP 广播/组播方式
function udpBroadcastExample() {
    console.log('2. UDP 广播/组播方式：');
    console.log('   - 实例通过UDP广播声明自己的存在');
    console.log('   - 其他实例监听广播消息进行发现');
    console.log('   - 缺点：不可靠，可能丢包');
    console.log('   - 适用于局域网内的服务发现\n');
}

// 3. 消息队列方式 (模拟)
class MessageQueue extends EventEmitter {
    constructor() {
        super();
        this.channels = new Map();
    }
    
    subscribe(channel, callback) {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, []);
        }
        this.channels.get(channel).push(callback);
    }
    
    publish(channel, message) {
        if (this.channels.has(channel)) {
            this.channels.get(channel).forEach(cb => cb(message));
        }
    }
}

function messageQueueExample() {
    console.log('3. 消息队列方式 (以Redis Pub/Sub模拟)：');
    const mq = new MessageQueue();
    
    // 实例A订阅状态频道
    mq.subscribe('instance-status', (msg) => {
        console.log(`   [实例A接收] 收到姐妹状态: ${msg}`);
    });
    
    // 实例B定期发送状态
    setInterval(() => {
        const status = { id: 'Instance-B', status: 'alive', timestamp: Date.now() };
        mq.publish('instance-status', JSON.stringify(status));
    }, 3000);
    
    console.log('   - 实例通过消息队列发布/订阅状态');
    console.log('   - 解耦性好，支持多对多通讯');
    console.log('   - 可用于分布式系统\n');
}

// 4. 文件系统监控方式
const fs = require('fs');
const path = require('path');

function fileWatchExample() {
    console.log('4. 文件系统监控方式：');
    console.log('   - 实例通过写入共享目录的文件表示状态');
    console.log('   - 其他实例监控文件变更');
    console.log('   - 适用于单机多进程场景');
    console.log('   - 缺点：需要文件系统支持\n');
}

// 5. 共享内存方式
function sharedMemoryExample() {
    console.log('5. 共享内存方式：');
    console.log('   - 实例之间共享同一块内存空间');
    console.log('   - 通过读写内存标志来通信');
    console.log('   - 高效但平台相关');
    console.log('   - 适用于单机多进程\n');
}

// 6. WebSocket 长连接
function websocketExample() {
    console.log('6. WebSocket 长连接方式：');
    console.log('   - 建立持久的WebSocket连接');
    console.log('   - 双向实时通信');
    console.log('   - 支持心跳检测和状态上报');
    console.log('   - 优点：低延迟、全双工\n');
}

// 7. gRPC 或 Thrift 等 RPC 框架
function rpcFrameworkExample() {
    console.log('7. RPC 框架方式 (gRPC/Thrift)：');
    console.log('   - 定义服务协议');
    console.log('   - 提供标准化的调用接口');
    console.log('   - 内置负载均衡和容错');
    console.log('   - 适合微服务架构\n');
}

// 8. 数据库通知方式
function databaseNotificationExample() {
    console.log('8. 数据库通知方式：');
    console.log('   - 实例通过数据库表来通知状态');
    console.log('   - 定期查询数据库获取其他实例状态');
    console.log('   - 利用数据库的事务特性');
    console.log('   - 适合并行部署\n');
}

// 运行所有示例
tcpSocketExample();
udpBroadcastExample();
messageQueueExample();
fileWatchExample();
sharedMemoryExample();
websocketExample();
rpcFrameworkExample();
databaseNotificationExample();

// 总结
console.log('=== 总结 ===');
console.log('不同通讯方式的适用场景：');
console.log('- TCP Socket: 点对点可靠通信');
console.log('- UDP 广播: 局域网服务发现');
console.log('- 消息队列: 解耦的分布式通信');
console.log('- 文件监控: 单机进程间通信');
console.log('- 共享内存: 高性能单机通信');
console.log('- WebSocket: 实时双向通信');
console.log('- RPC框架: 标准化微服务调用');
console.log('- 数据库: 持久化状态同步');

// 模拟演示TCP Socket服务器
const server = net.createServer((socket) => {
    console.log('\n[TCP服务器] 收到新的连接');
    socket.write(JSON.stringify({ type: 'status', data: 'alive' }));
    
    socket.on('data', (data) => {
        console.log('[TCP服务器] 收到消息:', data.toString());
    });
});

server.listen(9999, () => {
    console.log('\n[演示] TCP Socket 服务器已启动，监听 9999 端口');
});

// 5秒后关闭服务器
setTimeout(() => {
    server.close(() => {
        console.log('\n[演示] TCP Socket 服务器已关闭');
    });
}, 5000);