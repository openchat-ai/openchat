// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:32:26.571Z

/**
 * 实例间通讯方式研究
 * 探索除了HTTP ping之外的姐妹状态检测方法
 */

const net = require('net');
const dgram = require('dgram');
const redis = require('redis');

// 模拟的姐妹节点列表
const SISTER_NODES = [
    { id: 'node-1', host: 'localhost', port: 3001 },
    { id: 'node-2', host: 'localhost', port: 3002 },
    { id: 'node-3', host: 'localhost', port: 3003 }
];

console.log('=== 实例间通讯方式研究 ===\n');

// 1. TCP Socket 连接检测
function testTCPConnection(node) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const timeout = 2000;
        
        socket.setTimeout(timeout);
        
        socket.connect(node.port, node.host, () => {
            socket.destroy();
            resolve({ nodeId: node.id, status: 'alive', method: 'TCP' });
        });
        
        socket.on('error', () => {
            socket.destroy();
            resolve({ nodeId: node.id, status: 'dead', method: 'TCP' });
        });
        
        socket.on('timeout', () => {
            socket.destroy();
            resolve({ nodeId: node.id, status: 'timeout', method: 'TCP' });
        });
    });
}

// 2. UDP 心跳包检测
function testUDPHeartbeat(node) {
    return new Promise((resolve) => {
        const client = dgram.createSocket('udp4');
        const message = Buffer.from(JSON.stringify({ type: 'ping', from: 'monitor' }));
        let received = false;
        
        const timeout = setTimeout(() => {
            client.close();
            if (!received) {
                resolve({ nodeId: node.id, status: 'no_response', method: 'UDP' });
            }
        }, 2000);
        
        client.on('message', (msg) => {
            received = true;
            clearTimeout(timeout);
            client.close();
            resolve({ nodeId: node.id, status: 'alive', method: 'UDP' });
        });
        
        client.on('error', () => {
            clearTimeout(timeout);
            client.close();
            resolve({ nodeId: node.id, status: 'error', method: 'UDP' });
        });
        
        client.send(message, node.port, node.host);
    });
}

// 3. Redis Pub/Sub 状态检测
async function testRedisPubSub() {
    try {
        const publisher = redis.createClient({ host: 'localhost', port: 6379 });
        const subscriber = redis.createClient({ host: 'localhost', port: 6379 });
        
        await Promise.all([
            new Promise(resolve => publisher.on('ready', resolve)),
            new Promise(resolve => subscriber.on('ready', resolve))
        ]);
        
        const channel = 'sister-status';
        let responseReceived = false;
        
        subscriber.subscribe(channel);
        
        const timeout = setTimeout(() => {
            subscriber.unsubscribe(channel);
            publisher.publish(channel, JSON.stringify({ type: 'status_check' }));
            setTimeout(() => {
                publisher.quit();
                subscriber.quit();
                console.log('Redis Pub/Sub: No response from sister nodes');
            }, 500);
        }, 1000);
        
        subscriber.on('message', (chan, message) => {
            if (chan === channel && !responseReceived) {
                responseReceived = true;
                clearTimeout(timeout);
                const data = JSON.parse(message);
                console.log(`Redis Pub/Sub: Received status from ${data.from}: ${data.status}`);
                publisher.quit();
                subscriber.quit();
            }
        });
        
        publisher.publish(channel, JSON.stringify({ type: 'status_check' }));
    } catch (error) {
        console.log('Redis Pub/Sub: Connection failed -', error.message);
    }
}

// 4. 文件锁/共享状态检测（模拟）
function testFileLockDetection() {
    const fs = require('fs');
    const path = require('path');
    
    const lockDir = '/tmp/sister-nodes';
    
    try {
        if (!fs.existsSync(lockDir)) {
            fs.mkdirSync(lockDir, { recursive: true });
        }
        
        // 检查锁文件是否存在来判断节点状态
        const nodes = ['node-1', 'node-2', 'node-3'];
        const results = [];
        
        nodes.forEach(nodeId => {
            const lockFile = path.join(lockDir, `${nodeId}.lock`);
            const exists = fs.existsSync(lockFile);
            const stats = exists ? fs.statSync(lockFile) : null;
            const age = stats ? Date.now() - stats.mtime.getTime() : Infinity;
            
            results.push({
                nodeId,
                status: exists && age < 5000 ? 'alive' : 'dead',
                method: 'FileLock',
                lastUpdate: stats ? stats.mtime.toISOString() : 'never'
            });
        });
        
        console.log('\nFile Lock Detection Results:');
        results.forEach(r => console.log(`  ${r.nodeId}: ${r.status} (last update: ${r.lastUpdate})`));
    } catch (error) {
        console.log('File Lock Detection: Error -', error.message);
    }
}

// 运行所有检测方法
async function runAllTests() {
    console.log('1. TCP Socket Connection Tests:');
    for (const node of SISTER_NODES) {
        const result = await testTCPConnection(node);
        console.log(`   ${result.nodeId}: ${result.status} (${result.method})`);
    }
    
    console.log('\n2. UDP Heartbeat Tests:');
    for (const node of SISTER_NODES) {
        const result = await testUDPHeartbeat(node);
        console.log(`   ${result.nodeId}: ${result.status} (${result.method})`);
    }
    
    console.log('\n3. Redis Pub/Sub Test:');
    await testRedisPubSub();
    
    console.log('\n4. File Lock Detection:');
    testFileLockDetection();
    
    console.log('\n=== 研究总结 ===');
    console.log('检测方式比较:');
    console.log('- TCP Socket: 可靠但需要建立连接，开销较大');
    console.log('- UDP Heartbeat: 轻量但不可靠，可能丢包');
    console.log('- Redis Pub/Sub: 适合分布式系统，需要额外依赖');
    console.log('- File Lock: 简单但只适用于共享文件系统环境');
}

runAllTests().catch(console.error);