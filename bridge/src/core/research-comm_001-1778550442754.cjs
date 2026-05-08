// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:47:22.754Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const redis = require('redis');

// 模拟配置
const HEARTBEAT_FILE = path.join(__dirname, 'heartbeat.json');
const REDIS_CONFIG = { host: 'localhost', port: 6379 };

console.log('=== 实例间通讯方式研究 ===\n');

// 1. TCP Port 检测 (最基础的状态探测)
function checkTCPPort(host, port, callback) {
    const socket = new net.Socket();
    const startTime = Date.now();
    
    socket.setTimeout(3000);
    socket.connect(port, host, () => {
        socket.destroy();
        callback(null, { 
            status: 'online', 
            latency: Date.now() - startTime,
            method: 'TCP Port Check'
        });
    });
    
    socket.on('error', (err) => {
        callback({ 
            status: 'offline', 
            error: err.message,
            method: 'TCP Port Check'
        }, null);
    });
}

// 2. UDP 广播探测 (轻量级发现)
function udpDiscovery(callback) {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from('PING');
    const startTime = Date.now();
    
    client.on('message', (msg, rinfo) => {
        callback(null, {
            status: 'online',
            source: rinfo.address,
            latency: Date.now() - startTime,
            method: 'UDP Discovery'
        });
    });
    
    client.on('listening', () => {
        const address = client.address();
        client.send(message, 9090, address.address, address.port, (err) => {
            if (err) callback({ error: err.message, method: 'UDP Discovery' }, null);
        });
    });
    
    client.bind(9091);
}

// 3. 文件系统 Heartbeat (共享存储)
function fileHeartbeat(instanceId, callback) {
    const heartbeatPath = HEARTBEAT_FILE;
    const heartbeat = { id: instanceId, timestamp: Date.now() };
    
    try {
        fs.writeFileSync(heartbeatPath, JSON.stringify(heartbeat));
        const data = fs.readFileSync(heartbeatPath, 'utf8');
        const info = JSON.parse(data);
        callback(null, {
            status: 'online',
            lastUpdate: info.timestamp,
            age: Date.now() - info.timestamp,
            method: 'File Heartbeat'
        });
    } catch (err) {
        callback({ error: err.message, method: 'File Heartbeat' }, null);
    }
}

// 4. Redis Pub/Sub (分布式通讯)
async function redisPubSub(instanceId, callback) {
    try {
        const publisher = redis.createClient(REDIS_CONFIG);
        const subscriber = redis.createClient(REDIS_CONFIG);
        
        await Promise.all([
            publisher.connect(),
            subscriber.connect()
        ]);
        
        subscriber.subscribe('instance_status', (message) => {
            callback(null, {
                status: 'online',
                message: message,
                method: 'Redis Pub/Sub'
            });
        });
        
        setInterval(() => {
            publisher.publish('instance_status', JSON.stringify({
                id: instanceId,
                timestamp: Date.now()
            }));
        }, 2000);
        
        publisher.publish('instance_status', JSON.stringify({
            id: instanceId,
            timestamp: Date.now()
        }));
    } catch (err) {
        callback({ error: err.message, method: 'Redis Pub/Sub' }, null);
    }
}

// 运行测试
async function runTests() {
    const testHost = 'localhost';
    const testPort = 3000;
    const instanceId = `instance-${process.pid}`;
    
    console.log('1. TCP Port 检测:');
    checkTCPPort(testHost, testPort, (err, result) => {
        if (err) console.log(`   失败: ${err.error} (${err.method})`);
        else console.log(`   成功: ${result.status} (${result.latency}ms) - ${result.method}`);
    });
    
    console.log('\n2. UDP 广播探测:');
    udpDiscovery((err, result) => {
        if (err) console.log(`   失败: ${err.error} (${err.method})`);
        else console.log(`   结果: ${result.status} 来自 ${result.source} - ${result.method}`);
    });
    
    console.log('\n3. 文件系统 Heartbeat:');
    fileHeartbeat(instanceId, (err, result) => {
        if (err) console.log(`   失败: ${err.error} (${err.method})`);
        else console.log(`   成功: 最后更新 ${result.lastUpdate} (${result.age}ms前) - ${result.method}`);
    });
    
    console.log('\n4. Redis Pub/Sub:');
    redisPubSub(instanceId, (err, result) => {
        if (err) console.log(`   跳过: ${err.error} (${err.method})`);
        else console.log(`   结果: ${result.status} - ${result.method}`);
    });
    
    setTimeout(() => {
        console.log('\n=== 研究总结 ===');
        console.log('实例间通讯方式：');
        console.log('1. TCP: 准确率高，延迟可测');
        console.log('2. UDP:  lightweight，但不可靠');
        console.log('3. File: 简单但不适合分布式');
        console.log('4. Redis: 适合集群，实时通讯');
    }, 3000);
}

runTests();