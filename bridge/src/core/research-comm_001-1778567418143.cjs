// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:30:18.143Z

const cluster = require('cluster');
const http = require('http');
const redis = require('redis');
const WebSocket = require('ws');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const process = require('process');

// 研究实例间通讯方式
async function researchInterInstanceCommunication() {
    const results = {
        methods: [],
        pros: [],
        cons: []
    };

    console.log('=== 实例间通讯方式研究 ===\n');

    // 方法1: Redis Pub/Sub
    console.log('1. Redis Pub/Sub 通信');
    try {
        const publisher = redis.createClient();
        const subscriber = redis.createClient();
        
        await Promise.all([
            publisher.connect().catch(() => null),
            subscriber.connect().catch(() => null)
        ]);

        let redisWorks = false;
        subscriber.on('message', (channel, message) => {
            console.log(`   [Redis] 收到来自其他实例的消息: ${message}`);
            redisWorks = true;
        });

        await subscriber.subscribe('instance_status', () => {
            publisher.publish('instance_status', `实例 ${process.pid} 上线了`);
            console.log('   [Redis] 发布状态消息');
        });

        results.methods.push('Redis Pub/Sub - 实时消息广播');
        results.pros.push('Redis: 低延迟、支持多实例广播');
        results.cons.push('Redis: 新增依赖、需保证可用');
        
        setTimeout(() => {
            publisher.quit();
            subscriber.quit();
        }, 2000);
    } catch (e) {
        console.log('   [Redis] 未启用 (需要安装 redis 和启动 Redis 服务)');
        results.methods.push('Redis Pub/Sub (不可用)');
    }

    // 方法2: WebSocket 实时通信
    console.log('\n2. WebSocket 实时通信');
    if (cluster.isWorker) {
        const wsServer = new WebSocket.Server({ port: 8080 });
        wsServer.on('connection', (ws) => {
            ws.send(JSON.stringify({
                type: 'status',
                pid: process.pid,
                timestamp: Date.now(),
                status: 'healthy'
            }));
        });
        results.methods.push('WebSocket - 实时双向通信');
        results.pros.push('WebSocket: 即时通信、支持心跳');
        results.cons.push('WebSocket: 端口占用、需维护连接');
    }

    // 方法3: UDP 广播发现
    console.log('\n3. UDP 广播探测');
    const udpSocket = dgram.createSocket('udp4');
    const UDP_PORT = 9999;
    
    udpSocket.on('message', (msg, rinfo) => {
        console.log(`   [UDP] 收到来自 ${rinfo.address}:${rinfo.port} 的探测: ${msg}`);
    });

    udpSocket.bind(() => {
        udpSocket.setBroadcast(true);
        udpSocket.broadcast(`实例 ${process.pid} 存活`, UDP_PORT);
        console.log('   [UDP] 发送广播探测');
    });

    results.methods.push('UDP Broadcast - 轻量发现');
    results.pros.push('UDP: 无连接、资源低');
    results.cons.push('UDP: 不可靠、防火墙限制');

    // 方法4: 文件锁状态共享
    console.log('\n4. 文件锁机制');
    const lockFile = path.join('/tmp', `instance_${process.pid}.lock`);
    try {
        fs.writeFileSync(lockFile, JSON.stringify({
            pid: process.pid,
            timestamp: Date.now(),
            status: 'running'
        }));
        console.log(`   [File] 创建状态文件: ${lockFile}`);
        results.methods.push('文件锁 - 状态共享');
        results.pros.push('文件: 简单、跨进程');
        results.cons.push('文件: I/O 开销、需清理');
    } catch (e) {
        console.log('   [File] 文件锁不可用');
    }

    // 方法5: 进程信号
    console.log('\n5. 进程信号通信');
    if (cluster.isWorker) {
        // 模拟主进程监听worker状态
        cluster.on('message', (worker, msg) => {
            console.log(`   [Signal] 收到Worker ${worker.id} 消息:`, msg);
        });
        
        // 发送状态给主进程
        process.send && process.send({ type: 'heartbeat', pid: process.pid });
        results.methods.push('进程信号 - 父子通信');
        results.pros.push('信号: 轻量、内置');
        results.cons.push('信号: 仅限父子关系');
    }

    // 方法6: HTTP 轮询 (补充)
    console.log('\n6. HTTP 轮询检测');
    results.methods.push('HTTP Polling - 状态API');
    results.pros.push('HTTP: 简单、通用');
    results.cons.push('HTTP: 频繁请求、延迟高');

    // 总结
    console.log('\n=== 研究总结 ===');
    console.log('可用通信方式:', results.methods);
    console.log('优点:', results.pros);
    console.log('缺点:', results.cons);
    console.log('\n推荐方案:');
    console.log('- 生产环境: Redis Pub/Sub + HTTP API');
    console.log('- 轻量环境: UDP 广播 + 文件状态');
    console.log('- 集群内: 进程信号 + IPC');

    // 清理
    try {
        fs.unlinkSync(lockFile);
    } catch (e) {}
    udpSocket.close();
}

// 运行研究
if (cluster.isMaster) {
    console.log('主进程启动...');
    // 启动多个worker模拟实例
    for (let i = 0; i < 2; i++) {
        cluster.fork();
    }
    
    setTimeout(() => {
        console.log('\n研究完成，退出...');
        process.exit(0);
    }, 5000);
} else {
    researchInterInstanceCommunication().catch(console.error);
}