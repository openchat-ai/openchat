// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:01:13.589Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

console.log('=== 实例间通讯方式研究 ===\n');

// 1. TCP Socket 连接（TCP Ping）
function tcpPing(host, port, callback) {
    const startTime = Date.now();
    const socket = new net.Socket();
    
    socket.setTimeout(3000);
    socket.connect(port, host, () => {
        const latency = Date.now() - startTime;
        socket.destroy();
        callback(null, { status: 'online', latency, method: 'TCP Socket' });
    });
    
    socket.on('error', (err) => {
        callback({ status: 'offline', error: err.message, method: 'TCP Socket' });
    });
    
    socket.on('close', () => {});
}

// 2. UDP 广播探测
function udpBroadcast(message, callback) {
    const client = dgram.createSocket('udp4');
    const startTime = Date.now();
    
    client.on('message', (msg, rinfo) => {
        const latency = Date.now() - startTime;
        console.log(`[UDP] 收到来自 ${rinfo.address}:${rinfo.port} 的响应: ${msg.toString()}`);
        client.close();
        callback(null, { status: 'responded', address: rinfo.address, latency });
    });
    
    client.on('listening', () => {
        const address = client.address();
        console.log(`[UDP] 监听中 ${address.address}:${address.port}`);
        client.broadcast(message, 9000, '255.255.255.255', () => {
            setTimeout(() => client.close(), 2000);
        });
    });
    
    client.on('error', (err) => {
        console.error(`[UDP] 错误: ${err.message}`);
        client.close();
        callback(err);
    });
    
    client.bind(9000);
}

// 3. 文件系统监视 (通过共享文件状态)
function fileWatcher(filePath, callback) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify({ status: 'offline', timestamp: Date.now() }));
    }
    
    fs.watch(filePath, (eventType, filename) => {
        if (filename) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                callback(null, data);
            } catch (e) {}
        }
    });
    
    // 定期更新状态文件
    const interval = setInterval(() => {
        const status = {
            status: 'online',
            timestamp: Date.now(),
            pid: process.pid
        };
        fs.writeFileSync(filePath, JSON.stringify(status));
    }, 2000);
    
    return () => clearInterval(interval);
}

// 4. 共享事件总线 (模拟)
class SharedEventBus extends EventEmitter {
    static instance = new SharedEventBus();
    
    emit(event, data) {
        console.log(`[EventBus] 发布: ${event}`, data);
        super.emit(event, data);
    }
}

// 5. Redis风格发布订阅 (简化版)
class SimplePubSub {
    constructor() {
        this.channels = {};
    }
    
    subscribe(channel, callback) {
        if (!this.channels[channel]) this.channels[channel] = [];
        this.channels[channel].push(callback);
    }
    
    publish(channel, data) {
        if (this.channels[channel]) {
            this.channels[channel].forEach(cb => cb(data));
        }
    }
}

// 运行演示
async function runDemo() {
    console.log('1. TCP Socket 连接测试:');
    tcpPing('localhost', 3000, (result) => {
        console.log('  结果:', result);
    });
    
    console.log('\n2. UDP 广播探测:');
    udpBroadcast('hello from instance', (err, result) => {
        if (err) console.error('  错误:', err.message);
        else console.log('  结果:', result);
    });
    
    console.log('\n3. 文件系统监视:');
    const statusFile = path.join(__dirname, 'instance-status.json');
    const stopWatcher = fileWatcher(statusFile, (err, data) => {
        console.log('  文件状态更新:', data);
    });
    
    // 模拟状态更新
    setTimeout(() => stopWatcher(), 10000);
    
    console.log('\n4. 共享事件总线测试:');
    SharedEventBus.instance.on('status', (data) => {
        console.log('  [监听] 收到状态:', data);
    });
    SharedEventBus.instance.emit('status', { status: 'online', source: 'demo' });
    
    console.log('\n5. Pub/Sub 消息测试:');
    const pubsub = new SimplePubSub();
    pubsub.subscribe('heartbeat', (data) => {
        console.log('  [订阅] 收到心跳:', data);
    });
    pubsub.publish('heartbeat', { status: 'alive', timestamp: Date.now() });
    
    console.log('\n=== 总结 ===');
    console.log('可用的实例间通讯方式:');
    console.log('  - TCP Socket 连接');
    console.log('  - UDP 广播/组播');
    console.log('  - 文件系统共享');
    console.log('  - 事件发布订阅');
    console.log('  - 消息队列 (Redis, RabbitMQ)');
    console.log('  - WebSocket');
    console.log('  - gRPC');
    console.log('  - 共享内存 (IPC)');
    console.log('  - 数据库轮询');
}

runDemo();