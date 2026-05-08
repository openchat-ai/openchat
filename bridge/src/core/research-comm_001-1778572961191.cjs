// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:02:41.192Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

console.log('=== 实例间通讯方式研究：检测姐妹状态 ===\n');

// 1. TCP Socket 方式
function demonstrateTCPSocket() {
    console.log('1. TCP Socket 方式:');
    console.log('   - 优点: 可靠、有序、点对点');
    console.log('   - 应用: 心跳检测、状态上报');
    console.log('   - 示例: 实例通过TCP连接交换状态信息\n');
}

// 2. UDP 广播/组播方式
function demonstrateUDP() {
    console.log('2. UDP 广播/组播方式:');
    console.log('   - 优点: 低延迟、广播发现');
    console.log('   - 应用: 服务发现、广播心跳');
    console.log('   - 示例: 发送广播消息发现集群节点\n');
}

// 3. 文件系统通知
function demonstrateFileWatch() {
    console.log('3. 文件系统通知:');
    console.log('   - 优点: 简单、跨进程');
    console.log('   - 应用: 状态文件轮询、锁文件');
    console.log('   - 示例: 实例写入状态文件，其他实例监视\n');
    
    const statusFile = path.join(__dirname, 'sister-status.json');
    fs.writeFileSync(statusFile, JSON.stringify({ 
        pid: process.pid, 
        timestamp: Date.now(),
        status: 'alive'
    }));
    console.log('   - 已创建状态文件:', statusFile);
}

// 4. IPC (进程间通信)
function demonstrateIPC() {
    console.log('\n4. IPC (进程间通信):');
    console.log('   - 优点: 高效、本地通信');
    console.log('   - 应用: 主进程与子进程通信');
    console.log('   - 示例: 使用 process.send() 或 socketpair\n');
}

// 5. 消息队列
function demonstrateMessageQueue() {
    console.log('\n5. 消息队列方式:');
    console.log('   - 优点: 解耦、可靠传输');
    console.log('   - 应用: Redis pub/sub, RabbitMQ, Kafka');
    console.log('   - 示例: 实例订阅状态主题，收发心跳\n');
}

// 6. 共享内存
function demonstrateSharedMemory() {
    console.log('6. 共享内存:');
    console.log('   - 优点: 极低延迟');
    console.log('   - 应用: 高性能状态共享');
    console.log('   - 示例: 使用 shm 模块（Linux）\n');
}

// 实际演示UDP广播发现
function demoUDPDiscovery() {
    return new Promise((resolve) => {
        const client = dgram.createSocket('udp4');
        const PORT = 50055;
        
        client.on('message', (msg, rinfo) => {
            console.log('   [UDP] 收到来自', rinfo.address + ':' + rinfo.port, '的消息:', msg.toString());
        });
        
        client.on('listening', () => {
            const address = client.address();
            console.log('   [UDP] 监听中:', address.address + ':' + address.port);
            
            // 模拟发送广播
            setTimeout(() => {
                const buf = Buffer.from(JSON.stringify({
                    type: 'sister-heartbeat',
                    pid: process.pid,
                    timestamp: Date.now()
                }));
                client.setBroadcast(true);
                client.send(buf, 0, buf.length, PORT, '255.255.255.255', (err) => {
                    if (!err) {
                        console.log('   [UDP] 已发送广播心跳包');
                    }
                    client.close();
                    resolve();
                });
            }, 100);
        });
        
        client.bind(PORT);
    });
}

// 运行演示
(async () => {
    demonstrateTCPSocket();
    demonstrateUDP();
    demonstrateFileWatch();
    demonstrateIPC();
    demonstrateMessageQueue();
    demonstrateSharedMemory();
    
    console.log('=== 实际演示: UDP 广播发现 ===');
    await demoUDPDiscovery();
    
    // 清理状态文件
    const statusFile = path.join(__dirname, 'sister-status.json');
    try {
        fs.unlinkSync(statusFile);
        console.log('\n=== 清理完成 ===');
    } catch (e) {}
    
    console.log('\n=== 总结 ===');
    console.log('常用的实例间通讯方式:');
    console.log('1. TCP Socket - 点对点可靠通信');
    console.log('2. UDP Broadcast - 服务发现');
    console.log('3. Redis Pub/Sub - 消息通知');
    console.log('4. 文件共享 - 简单状态检测');
    console.log('5. gRPC/Protobuf - 结构化RPC调用');
    console.log('6. WebSocket - 实时双向通信');
})();