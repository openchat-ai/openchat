// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:31:43.381Z

// 实例间通讯方式研究：TCP、UDP、文件系统、Redis 等方式检测姐妹状态
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const redis = require('redis');

console.log('=== 实例间通讯方式研究 ===\n');

// 1. TCP Socket 心跳检测
function tcpHeartbeat() {
    return new Promise((resolve) => {
        const client = new net.Socket();
        const startTime = Date.now();
        
        client.setTimeout(1000);
        client.connect(9001, 'localhost', () => {
            client.write('HEARTBEAT');
        });
        
        client.on('data', (data) => {
            const latency = Date.now() - startTime;
            client.destroy();
            resolve({ method: 'TCP Socket', status: 'reachable', latency: `${latency}ms` });
        });
        
        client.on('error', () => {
            client.destroy();
            resolve({ method: 'TCP Socket', status: 'unreachable', latency: '-' });
        });
    });
}

// 2. UDP 广播检测
function udpBroadcast() {
    return new Promise((resolve) => {
        const client = dgram.createSocket('udp4');
        const startTime = Date.now();
        
        client.on('message', (msg) => {
            const latency = Date.now() - startTime;
            client.close();
            resolve({ method: 'UDP Broadcast', status: 'reachable', latency: `${latency}ms` });
        });
        
        client.on('listening', () => {
            client.setBroadcast(true);
            client.send('PING', 9002, '255.255.255.255', () => {
                setTimeout(() => {
                    if (!client.closed) {
                        client.close();
                        resolve({ method: 'UDP Broadcast', status: 'timeout', latency: '-' });
                    }
                }, 1000);
            });
        });
        
        client.on('error', () => {
            client.close();
            resolve({ method: 'UDP Broadcast', status: 'error', latency: '-' });
        });
    });
}

// 3. 文件系统检测（共享文件）
function fileSystemCheck() {
    return new Promise((resolve) => {
        const stateFile = path.join(__dirname, '.peer_state');
        try {
            if (fs.existsSync(stateFile)) {
                const stats = fs.statSync(stateFile);
                const age = Date.now() - stats.mtimeMs;
                resolve({ 
                    method: 'File System', 
                    status: age < 5000 ? 'alive' : 'stale', 
                    latency: `${Math.round(age)}ms`,
                    note: '依赖共享文件更新时间'
                });
            } else {
                resolve({ method: 'File System', status: 'not_found', latency: '-' });
            }
        } catch (e) {
            resolve({ method: 'File System', status: 'error', latency: '-' });
        }
    });
}

// 4. Redis PubSub 检测
async function redisPubSub() {
    try {
        const publisher = redis.createClient({ host: 'localhost', port: 6379 });
        const subscriber = redis.createClient({ host: 'localhost', port: 6379 });
        
        let resolved = false;
        const startTime = Date.now();
        
        subscriber.on('message', () => {
            if (!resolved) {
                const latency = Date.now() - startTime;
                publisher.quit();
                subscriber.quit();
                resolved = true;
                return { method: 'Redis PubSub', status: 'reachable', latency: `${latency}ms` };
            }
        });
        
        await new Promise(resolve => subscriber.on('ready', resolve));
        await new Promise(resolve => publisher.on('ready', resolve));
        
        subscriber.subscribe('peer_check');
        publisher.publish('peer_check', 'PING');
        
        setTimeout(() => {
            if (!resolved) {
                publisher.quit();
                subscriber.quit();
                resolved = true;
                console.log({ method: 'Redis PubSub', status: 'timeout', latency: '-' });
            }
        }, 1000);
        
    } catch (e) {
        console.log({ method: 'Redis PubSub', status: 'error', latency: '-', error: e.message });
    }
}

// 5. 进程信号（模拟）
function processSignal() {
    console.log({ 
        method: 'Process Signal', 
        status: 'simulated', 
        latency: '-',
        note: '通过发送信号给目标进程PID'
    });
}

// 运行测试
async function runTests() {
    console.log('正在测试各种实例间通讯方式...\n');
    
    const results = await Promise.allSettled([
        tcpHeartbeat(),
        udpBroadcast(),
        fileSystemCheck(),
        // redisPubSub() // 需要 Redis 服务
    ]);
    
    console.log('\n=== 测试结果 ===');
    results.forEach(r => {
        if (r.status === 'fulfilled' && r.value) {
            console.log(r.value);
        }
    });
    
    processSignal();
    
    console.log('\n=== 总结 ===');
    console.log('可用方法：');
    console.log('1. TCP Socket - 低延迟、可靠，但需要端口监听');
    console.log('2. UDP Broadcast - 广播发现，适合局域网');
    console.log('3. 文件系统 - 跨平台，依赖共享存储');
    console.log('4. Redis PubSub - 解耦、可扩展，需中间件');
    console.log('5. 进程信号 - 单机多进程，Linux/macOS');
    console.log('6. WebSocket - 长连接双向通信');
    console.log('7. 共享内存 (IPC) - 高性能单机通信');
}

runTests();