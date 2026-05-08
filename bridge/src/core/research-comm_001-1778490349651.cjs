// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:05:49.651Z

const net = require('net');
const dgram = require('dgram');
const redis = require('redis');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

console.log('=== 实例间通信方式研究 ===\n');

// 1. TCP Socket 心跳检测
function createTCPHeartbeat() {
    console.log('1. TCP Socket 心跳检测:');
    
    const server = net.createServer((socket) => {
        socket.on('data', (data) => {
            if (data.toString() === 'PING') {
                socket.write('PONG');
                console.log('   收到PING，返回PONG');
            }
        });
    });
    
    server.listen(9001, () => {
        console.log('   TCP服务器监听9001端口...');
        
        // 客户端检测
        const client = new net.Socket();
        client.connect(9001, () => {
            client.write('PING');
            console.log('   已发送PING给姐妹实例');
        });
        
        client.on('data', (data) => {
            console.log('   收到来自姐妹的响应:', data.toString());
            server.close();
            client.destroy();
        });
    });
}

// 2. UDP 广播检测
function createUDPDiscovery() {
    console.log('\n2. UDP 广播发现:');
    
    const server = dgram.createSocket('udp4');
    const PORT = 9002;
    
    server.on('message', (message, remote) => {
        console.log(`   收到来自 ${remote.address}:${remote.port} 的消息:`, message.toString());
    });
    
    server.bind(PORT, () => {
        server.setBroadcast(true);
        console.log(`   UDP服务器监听${PORT}端口...`);
        
        // 模拟发送广播
        setTimeout(() => {
            const buf = Buffer.from('HEARTBEAT');
            server.send(buf, 0, buf.length, PORT, '255.255.255.255', (err) => {
                console.log('   已广播心跳包');
            });
        }, 500);
    });
}

// 3. 文件系统通知
function createFileWatch() {
    console.log('\n3. 文件系统通知:');
    
    const watchFile = '/tmp/instance_status.txt';
    
    // 创建监视器
    fs.watch(path.dirname(watchFile), (eventType, filename) => {
        if (filename === path.basename(watchFile)) {
            const status = fs.readFileSync(watchFile, 'utf8');
            console.log('   姐妹实例状态更新:', status);
        }
    });
    
    // 模拟写入状态
    setTimeout(() => {
        fs.writeFileSync(watchFile, JSON.stringify({
            instance: 'sister-1',
            status: 'alive',
            timestamp: Date.now()
        }));
        console.log('   已写入实例状态文件');
    }, 1000);
}

// 4. 共享内存检测 (使用Buffer模拟)
function createSharedMemoryCheck() {
    console.log('\n4. 共享内存检测:');
    
    try {
        // 在Unix系统上可以使用shm
        const shmName = '/node_instance_shm';
        console.log('   共享内存区段:', shmName);
        console.log('   功能: 实例可通过共享内存交换状态信息');
    } catch (e) {
        console.log('   共享内存初始化失败:', e.message);
    }
}

// 5. WebSocket 双向通信
async function createWebSocketServer() {
    console.log('\n5. WebSocket 双向通信:');
    
    const wss = new WebSocket.Server({ port: 8080 });
    
    wss.on('connection', (ws) => {
        console.log('   新实例连接...');
        ws.send(JSON.stringify({ type: 'status', data: 'alive' }));
        
        ws.on('message', (message) => {
            console.log('   收到消息:', message.toString());
        });
    });
    
    setTimeout(() => {
        console.log('   WebSocket服务器启动在8080端口');
    }, 100);
}

// 6. Redis Pub/Sub
async function createRedisPubSub() {
    console.log('\n6. Redis Pub/Sub 通知:');
    
    try {
        const publisher = redis.createClient();
        const subscriber = redis.createClient();
        
        await Promise.all([
            publisher.connect(),
            subscriber.connect()
        ]);
        
        subscriber.subscribe('instance-channel', (message) => {
            console.log('   收到姐妹实例通知:', message);
        });
        
        setTimeout(() => {
            publisher.publish('instance-channel', JSON.stringify({
                instance: 'sister-2',
                status: 'alive',
                timestamp: Date.now()
            }));
            console.log('   已发布状态到Redis频道');
        }, 1500);
    } catch (e) {
        console.log('   Redis连接失败:', e.message);
    }
}

// 主执行函数
async function main() {
    console.log('开始研究实例间通信方式...\n');
    
    createTCPHeartbeat();
    createUDPDiscovery();
    createFileWatch();
    createSharedMemoryCheck();
    await createWebSocketServer();
    await createRedisPubSub();
    
    // 总结
    setTimeout(() => {
        console.log('\n=== 研究总结 ===');
        console.log('实例间通信方式总结:');
        console.log('1. TCP Socket: 低延迟，点对点可靠');
        console.log('2. UDP 广播: 适合发现局域网节点');
        console.log('3. 文件系统: 简单可靠，跨平台');
        console.log('4. 共享内存: 最快，但平台相关');
        console.log('5. WebSocket: 双向实时，Web友好');
        console.log('6. Redis Pub/Sub: 分布式系统首选');
        console.log('\n每种方式都有其适用场景！');
    }, 3000);
}

main().catch(console.error);